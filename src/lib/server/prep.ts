import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import type { Project } from '$lib/domain/schemas';
import {
	emptyPrep, emptyState, factsGaps, handOffLine, identityGaps, notesOf, prepAspect, prepEntries, prepFileSchema, referenceSpecSchema, sheetFileName, templateFor,
	type PrepEntry, type PrepFile, type PrepState, type ReferenceSpec, type ScaleCheck
} from '$lib/domain/prep';
import type { StillApproval } from '$lib/domain/stills';
import { IMAGE_MODELS, type ImageModelId } from '$lib/domain/image-models';
import { generateStructured, type AgentModelClient, type ModelImage } from './model-provider';
import { readAgentSkill, readPromptingGuide } from './agent-skills';
import { quoteStill, sendStill, settleStill, type StillDeps } from './stills';
import { cachedReference, uploadReference, type ReferenceFileDeps } from './reference-files';
import type { NotionApi } from './notion';
import type { SeriesRecord, SeriesStore } from './series';

/**
 * Prep (V1S-374): list what an episode needs, take source images, let the Agent draft each reference spec with
 * the app's ONE SHOT skill, write the prompt from the approved spec, make the sheet through the approval card
 * (GPT Image 2.5, 2K), stamp the exact name on it and land it in the series' `_References` (the References
 * drawer). A sheet made outside the app with the skill can be attached instead. State lives in
 * `<project>/prep.json`; source images and sheets under `<project>/files/prep/`.
 */

export interface PrepDeps extends StillDeps {
	series: SeriesStore;
	/** The Agent's model for this project; null when none is configured. */
	agent: (project: Project) => Promise<AgentModelClient | null>;
	references: ReferenceFileDeps | null;
	notion: NotionApi | null;
	/** Prints the exact name along the bottom of a sheet; returns the stamped copy's path. */
	stamp: (file: string, name: string, out: string) => Promise<string>;
	/** Builds a visual comparison of original pixels and the generated front, using uniform scaling only. */
	scaleCheck?: (sheet: string, out: string, reference?: string) => Promise<{ ok: boolean; stretch?: number; zoom?: number; fit?: number; width_ratio: number; feet_offset: number; verdict: string }>;
}
type Failure = { ok: false; status: number; message: string; reasons?: string[] };
const fail = (status: number, message: string, reasons?: string[]): Failure => ({ ok: false, status, message, ...(reasons ? { reasons } : {}) });

// ---- store ----
const prepPath = (root: string, projectId: string) => join(root, projectId, 'prep.json');
export async function readPrep(root: string, projectId: string): Promise<PrepFile> {
	try { return prepFileSchema.parse(JSON.parse(await readFile(prepPath(root, projectId), 'utf8'))); } catch { return emptyPrep(); }
}
async function writePrep(root: string, projectId: string, prep: PrepFile): Promise<PrepFile> {
	const valid = prepFileSchema.parse(prep);
	await writeFile(prepPath(root, projectId), JSON.stringify(valid, null, '\t'), 'utf8');
	return valid;
}
async function update(root: string, projectId: string, key: string, change: (state: PrepState) => PrepState): Promise<PrepFile> {
	const prep = await readPrep(root, projectId);
	return writePrep(root, projectId, { ...prep, entries: { ...prep.entries, [key]: change(prep.entries[key] ?? emptyState()) } });
}

// ---- the list ----
export interface PrepView { entry: PrepEntry; state: PrepState; template: string; current: { url: string } | null }

export async function prepView(deps: Pick<PrepDeps, 'projectRoot' | 'series'>, project: Project): Promise<{ ok: true; items: PrepView[]; props: string[] } | Failure> {
	if (!project.series) return fail(400, 'Prep is for an episode imported from a series');
	const record = await deps.series.read(project.series.series_id);
	const prep = await readPrep(deps.projectRoot, project.project_id);
	const entries = prepEntries(project.series.scenes, record?.references?.items ?? [], prep.props);
	const items = entries.map((entry) => {
		const state = prep.entries[entry.key] ?? emptyState();
		const file = entry.reference_page_id ? record?.reference_files?.[entry.reference_page_id] : undefined;
		return { entry, state, template: templateFor(entry.kind, state.sources.length > 0), current: file && record ? { url: `/api/series/${record.series_id}/references?page_id=${entry.reference_page_id}` } : null };
	});
	return { ok: true, items, props: prep.props };
}

async function findEntry(deps: Pick<PrepDeps, 'projectRoot' | 'series'>, project: Project, key: string): Promise<{ ok: true; view: PrepView; record: SeriesRecord | null } | Failure> {
	const listed = await prepView(deps, project);
	if (!listed.ok) return listed;
	const view = listed.items.find((item) => item.entry.key === key);
	if (!view) return fail(404, 'That entry is not on the Prep list');
	return { ok: true, view, record: await deps.series.read(project.series!.series_id) };
}

export async function addProp(deps: Pick<PrepDeps, 'projectRoot'>, projectId: string, name: string): Promise<PrepFile> {
	const prep = await readPrep(deps.projectRoot, projectId);
	const clean = name.trim().slice(0, 200);
	return writePrep(deps.projectRoot, projectId, { ...prep, props: prep.props.includes(clean) ? prep.props : [...prep.props, clean] });
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const safe = (text: string) => text.replace(/[^\w.-]+/g, '_').slice(0, 80);

/** Keep the prompt and references while choosing a different renderer. */
export async function setImageModel(deps: PrepDeps, project: Project, key: string, model: ImageModelId): Promise<{ ok: true; prep: PrepFile } | Failure> {
	const found = await findEntry(deps, project, key);
	if (!found.ok) return found;
	if (found.view.state.job) return fail(409, 'Wait for the current generation before changing its model');
	return { ok: true, prep: await update(deps.projectRoot, project.project_id, key, (state) => ({ ...state, image_model: model })) };
}

/** Choose an existing source as the body baseline, or explicitly design a body from facts. */
export async function setBodySource(deps: Pick<PrepDeps, 'projectRoot'>, projectId: string, key: string, url: string | null): Promise<{ ok: true; prep: PrepFile } | Failure> {
	const prep = await readPrep(deps.projectRoot, projectId);
	const state = prep.entries[key];
	if (!state) return fail(404, 'That Prep entry has no facts or sources yet');
	if (url && !state.sources.some((source) => source.url === url)) return fail(404, 'Choose a source image attached to this character');
	if (state.job) return fail(409, 'Wait for the current generation before changing its body reference');
	return { ok: true, prep: await update(deps.projectRoot, projectId, key, (current) => ({ ...current, body_source_url: url, prompt: null, prompt_edited: false })) };
}

/** A source image dropped onto an entry; kept under files/prep/sources, never attached to shots. */
export async function addSource(deps: Pick<PrepDeps, 'projectRoot'>, projectId: string, key: string, input: { file_name: string; bytes: Uint8Array }): Promise<{ ok: true; prep: PrepFile } | Failure> {
	const ext = extname(input.file_name).toLowerCase();
	if (!IMAGE_EXT.has(ext)) return fail(400, 'A source image is a PNG, JPEG or WebP');
	const folder = join(deps.projectRoot, projectId, 'files', 'prep', 'sources', safe(key));
	await mkdir(folder, { recursive: true });
	const name = `${Date.now().toString(36)}-${safe(input.file_name.replace(/\.[^.]+$/, ''))}${ext}`;
	await writeFile(join(folder, name), input.bytes);
	const url = `/api/projects/${projectId}/files/prep/sources/${safe(key)}/${name}`;
	const prep = await update(deps.projectRoot, projectId, key, (state) => ({
		...state, sources: [...state.sources, { name: input.file_name.slice(0, 300), file: join(folder, name), url, added_at: new Date().toISOString() }].slice(-12),
		body_source_url: state.sources.slice(-11).some((source) => source.url === state.body_source_url) ? state.body_source_url : null,
		// The spec stays (Redraft is there for a fresh one); only the prompt goes, since it numbers the images.
		prompt: null, prompt_edited: false
	}));
	return { ok: true, prep };
}

/** Take one source image off an entry (its copy under files/prep/sources goes too); the spec stays, the prompt is rewritten. */
export async function removeSource(deps: Pick<PrepDeps, 'projectRoot'>, projectId: string, key: string, url: string): Promise<{ ok: true; prep: PrepFile } | Failure> {
	const prep = await readPrep(deps.projectRoot, projectId);
	const source = prep.entries[key]?.sources.find((entry) => entry.url === url);
	if (!source) return fail(404, 'That source image is not on this entry');
	await rm(source.file, { force: true });
	return { ok: true, prep: await update(deps.projectRoot, projectId, key, (state) => ({ ...state, sources: state.sources.filter((entry) => entry.url !== url), body_source_url: state.body_source_url === url ? null : state.body_source_url, prompt: null, prompt_edited: false })) };
}

/** The current reference image (an old sheet) as a source image, so ONE SHOT remakes it to the standard. */
export async function useCurrentAsSource(deps: Pick<PrepDeps, 'projectRoot' | 'series' | 'references'>, project: Project, key: string): Promise<{ ok: true; prep: PrepFile } | Failure> {
	const found = await findEntry(deps, project, key);
	if (!found.ok) return found;
	const pageId = found.view.entry.reference_page_id;
	const file = pageId ? found.record?.reference_files?.[pageId] : undefined;
	if (!file || !deps.references) return fail(404, 'There is no current reference image to use');
	const path = await cachedReference(deps.references, file);
	return addSource(deps, project.project_id, key, { file_name: file.file_name, bytes: new Uint8Array(await readFile(path)) });
}

// ---- the Agent: reference spec, then the prompt ----
async function skillSystem(): Promise<string> {
	const [skill, templates, look, guide] = await Promise.all([
		readAgentSkill('oneshot-image-prompts'),
		readAgentSkill('oneshot-image-prompts', 'references/templates.md'),
		readAgentSkill('oneshot-image-prompts', 'references/house-look.md'),
		readPromptingGuide()
	]);
	return `You are the reference maker inside Creative Studio Pro. Follow this skill exactly; it is the one standard for every reference.\n\n${skill}\n\n# Templates\n\n${templates}\n\n# House look\n\n${look}\n\n${guide}`;
}

function entryContext(view: PrepView, project: Project, record: SeriesRecord | null): string {
	const scenes = project.series!.scenes.filter((scene) => view.entry.scenes.some((s) => s.page_id === scene.page_id));
	const mentions = scenes.map((scene) => {
		const text = [scene.summary, scene.story_beats].join('\n');
		const first = view.entry.name.split(/\s+/)[0];
		const lines = text.split('\n').filter((line) => line.includes(first)).slice(0, 4).join(' ');
		return `- ${scene.title} (${scene.location}): ${lines || scene.summary.slice(0, 300)}`;
	}).join('\n');
	const story = (record?.story?.text ?? '').slice(0, 2500);
	return [
		`Reference: ${view.entry.name} (${view.entry.kind})${view.entry.role ? ` — ${view.entry.role}` : ''}`,
		`Template: ${view.template}`,
		`Source images attached: ${view.state.sources.length ? view.state.sources.map((s, i) => `image ${i + 1} = ${s.name}`).join(', ') : 'none'}`,
		`The season (setting and look):\n${story}`,
		`Scenes in this episode that use it:\n${mentions || '(none listed)'}`
	].join('\n\n');
}

async function sourceImages(state: PrepState): Promise<ModelImage[]> {
	const out: ModelImage[] = [];
	for (const source of state.sources.slice(0, 6)) {
		const ext = extname(source.file).toLowerCase();
		try { out.push({ data: new Uint8Array(await readFile(source.file)), mediaType: ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg' }); } catch { /* a missing file is skipped */ }
	}
	return out;
}

/**
 * The Agent drafts the facts: for a character the identity and hand-off fields, for a place or prop a short note
 * on what it is. Never a description of the pictures; the operator's own notes are kept.
 */
export async function draftSpec(deps: PrepDeps, project: Project, key: string): Promise<{ ok: true; spec: ReferenceSpec; prep: PrepFile } | Failure> {
	const found = await findEntry(deps, project, key);
	if (!found.ok) return found;
	const client = await deps.agent(project);
	if (!client) return fail(503, 'No Agent model is set up for this project (Settings)');
	const { view } = found;
	const character = view.entry.kind === 'character';
	const ask = `${entryContext(view, project, found.record)}\n\nDraft the FACTS this reference is made from: only what the pictures cannot say. Do not describe the pictures; the prompt writer looks at them itself. Return only JSON:\n{"name": "${view.entry.name}", "kind": "${view.entry.kind}", "template": "${view.template}"${character ? IDENTITY_FIELDS : ', "notes": "two or three plain sentences: what this place or thing is in the story, its era and where it stands; sizes in metres"'}}\nUse the exact name as given. Never use the word "neon".${character ? IDENTITY_RULES : ''}`;
	const parse = (value: unknown) => {
		const spec = referenceSpecSchema.parse(value);
		const notes = character ? (view.state.spec?.notes ?? '') : spec.notes;
		return { ...spec, notes, description: '', must_hold: [], from_sources: '', name: view.entry.name, kind: view.entry.kind, template: view.template as ReferenceSpec['template'] };
	};
	const system = await skillSystem();
	const images = await sourceImages(view.state);
	let spec: ReferenceSpec;
	try { spec = await generateStructured(client, { system, prompt: ask, images, maxOutputTokens: 1600, timeoutMs: 120_000 }, parse); }
	catch (cause) {
		// A text-only model refuses images: draft from the names and Notion alone.
		if (!images.length) throw cause;
		spec = await generateStructured(client, { system, prompt: ask, maxOutputTokens: 1600, timeoutMs: 120_000 }, parse);
	}
	const prep = await update(deps.projectRoot, project.project_id, key, (state) => ({ ...state, spec, spec_approved_at: null, prompt: null, prompt_edited: false }));
	return { ok: true, spec, prep };
}

/** For a character spec drafted before identity fields existed: the Agent fills age, height and the hand-off parts, the rest stays. */
export async function fillIdentity(deps: PrepDeps, project: Project, key: string): Promise<{ ok: true; spec: ReferenceSpec; prep: PrepFile } | Failure> {
	const found = await findEntry(deps, project, key);
	if (!found.ok) return found;
	const { view } = found;
	if (view.entry.kind !== 'character' || !view.state.spec) return fail(400, 'Fill identity is for a character with a spec');
	const client = await deps.agent(project);
	if (!client) return fail(503, 'No Agent model is set up for this project (Settings)');
	const ask = `${entryContext(view, project, found.record)}\n\nTHE CURRENT REFERENCE SPEC (keep it; only add what is missing):\n${JSON.stringify(view.state.spec, null, 2)}\n\nFill in this character's identity and hand-off fields. Return only JSON: {${IDENTITY_FIELDS.slice(2)}}${IDENTITY_RULES}`;
	const filled = await generateStructured(client, { system: await skillSystem(), prompt: ask, images: await sourceImages(view.state), maxOutputTokens: 1200, timeoutMs: 120_000 }, (value) =>
		referenceSpecSchema.pick({ identity: true, owned_element: true, owned_colour: true, powers: true, ownership_lock: true }).parse(value));
	const spec = referenceSpecSchema.parse({ ...view.state.spec, ...filled });
	const prep = await update(deps.projectRoot, project.project_id, key, (state) => ({ ...state, spec, spec_approved_at: null, prompt: null, prompt_edited: false }));
	return { ok: true, spec, prep };
}

/** The operator's edits to the spec, and their approval (approving clears an old prompt). */
export async function saveSpec(deps: Pick<PrepDeps, 'projectRoot' | 'series'>, project: Project, key: string, input: { spec: ReferenceSpec; approve: boolean }): Promise<{ ok: true; prep: PrepFile } | Failure> {
	const found = await findEntry(deps, project, key);
	if (!found.ok) return found;
	const spec = referenceSpecSchema.parse({ ...input.spec, name: found.view.entry.name, kind: found.view.entry.kind, template: found.view.template });
	const prep = await update(deps.projectRoot, project.project_id, key, (state) => ({ ...state, spec, spec_approved_at: input.approve ? new Date().toISOString() : null, prompt: null, prompt_edited: false }));
	return { ok: true, prep };
}

/** The identity and hand-off fields a character spec carries (ONE SHOT settings-and-qc.md, File 11). */
const IDENTITY_FIELDS = ', "identity": {"sex": "male|female|…", "age": 19, "height_cm": 178, "build": "lean wiry free-runner", "face": "the face in one clause", "eyes": "amber eyes", "hair": "bleached platinum curls", "marks": "two silver lower-lip rings"}, "owned_element": "what supernatural element is theirs, or empty", "owned_colour": {"name": "amber", "hex": "#D98A2B"}, "powers": ["named powers, stable names"], "ownership_lock": "one sentence: how the element shows physically and what it is never mistaken for"';
/** How the writer splits the attached images (ONE SHOT settings-and-qc: every reference image gets exactly one job, named). */
const IMAGE_JOBS = 'Look at every attached image and give each one exactly one job, named in the prompt as "Image N controls …" (never "combine these naturally"). The image with the closest, sharpest view of the face controls the face; the image that shows the whole body best controls the body: build, muscle, proportions (leg length against torso) and the wardrobe as it sits on the body. Any other image gets its own named job, or is named as not used. Take no background, weather or light from any image.';
const IDENTITY_RULES = '\nEvery character has an age and a height in centimetres: take them from the story, a data card on a source image, or the build you can see; never leave them out. Write face, eyes, hair and marks as short clauses, the way the CHARACTER hand-off line reads.';

/** The look sections every character sheet prompt carries (oneshot-image-prompts output format). */
export const SHEET_SECTIONS = ['GRADE', 'CAMERA', 'REALISM', 'LOCKS', 'AVOID'] as const;

/** QC on a reference prompt before the approval card (V1S-374). */
export function prepQc(prompt: string, view: PrepView): string[] {
	const out: string[] = [];
	const preserveBody = !!view.state.body_source_url;
	if (!prompt.includes(view.entry.name)) out.push(`The prompt must call it by its exact name, "${view.entry.name}"`);
	if (/\bneon\b/i.test(prompt)) out.push('The prompt uses the word "neon"; describe the light another way');
	if (view.entry.kind === 'character' && !/straight-on|face square to the camera/i.test(prompt)) out.push('The first panel must be a straight-on, forward-facing face close-up (the T1 wording)');
	if (view.entry.kind === 'character' && /three-quarter[^.]*first panel|first panel[^.]*three-quarter/i.test(prompt)) out.push('The first panel is three-quarter; it must face the camera');
	if (view.entry.kind === 'character' && !/(near-)?white seamless|white cyclorama|white studio backdrop/i.test(prompt)) out.push('A character sheet sits on the near-white seamless studio backdrop, the same for the whole cast');
	if (view.entry.kind === 'character' && view.state.spec) {
		const gaps = identityGaps(view.state.spec, preserveBody);
		if (gaps.length) out.push(`Fill in the character's ${gaps.join(', ')} in the spec first (Fill identity, or type them in)`);
		const line = handOffLine(view.state.spec, preserveBody);
		if (!gaps.length && !prompt.includes(line)) out.push('The prompt must end with the CHARACTER hand-off line exactly as the spec builds it');
	}
	if (view.entry.kind === 'character') {
		// Everything but the AVOID line: those words may appear there as things to avoid.
		const said = prompt.split('\n').filter((line) => !/^\s*\**AVOID\**\s*:/i.test(line)).join('\n');
		if (/black[- ]and[- ]white|monochrome|greyscale|grayscale|desaturat|faded|washed[- ]out/i.test(said)) out.push('The sheet must be in full natural colour like the rest of the cast; take out "monochrome", "desaturated", "faded" or "black and white" (they may only appear under AVOID)');
		if (!/^\s*\**AVOID\**\s*:.*\bfangs?\b/im.test(prompt)) out.push('Fangs must be listed under AVOID: no vampire teeth on any sheet');
		if (preserveBody) {
			if (/\b\d+(?:\.\d+)?\s*(?:cm|m|metres?|meters?)\b|\b(?:tall|skinny|slim|slender|petite|lean|athletic|muscular|curvy|voluptuous|long-legged)\b/i.test(said)) out.push('A body reference is selected: remove height, build and figure descriptions; match its body shape and proportions exactly');
			if (!/match[^.\n]*body[^.\n]*proportions[^.\n]*exactly|body shape and proportions exactly as reference/i.test(prompt)) out.push('Tell the model to match the original body shape and proportions exactly');
		} else if (!/\b\d{2,3}\s?cm\b/i.test(prompt)) out.push('State the character\'s true height in cm so the full-body panels keep natural proportions');
		if (/\b\d['’]\s?\d{1,2}(["”]|''|\s?in\b)|\b\d+\s?(feet|foot|ft|inch(es)?)\b|\b\d+(?:\.\d+)?\s*(?:m|metres?|meters?)\b/i.test(prompt)) out.push('Height must be in cm only: take out metres, feet and inches');
		if (!/collarbones?/i.test(prompt)) out.push('The frontal full-body panel is cropped at the collarbones (House Rule #1)');
	}
	// The skill's look blocks, each as its own labelled section, so every sheet says how it should look.
	if (view.entry.kind === 'character') for (const section of SHEET_SECTIONS) if (!new RegExp(`^\\s*\\**${section}\\**\\s*:`, 'mi').test(prompt)) out.push(`The ${section} section is missing ("${section}: …" on its own line)`);
	for (const [i, source] of view.state.sources.entries()) if (!new RegExp(`\\bimage ${i + 1}\\b`, 'i').test(prompt) && view.state.sources.length) { out.push(`Source image ${i + 1} (${source.name}) is attached but the prompt never names "image ${i + 1}"`); break; }
	if (view.state.sources.length > 1 && !/\bimage \d+ controls\b/i.test(prompt)) out.push('Give each attached image its one job in the prompt ("Image N controls …")');
	return out;
}

/** The facts the writer gets: identity and hand-off fields for a character, notes for a place or prop. */
function factsText(spec: ReferenceSpec, preserveBody = false): string {
	if (spec.kind !== 'character') return `NOTES: ${notesOf(spec)}`;
	const id = spec.identity;
	return [
		`IDENTITY: ${[id?.sex, id?.age ? `${id.age}` : '', !preserveBody && id?.height_cm ? `${id.height_cm} cm` : '', preserveBody ? '' : id?.build].filter(Boolean).join(', ')}`,
		id?.face || id?.eyes || id?.hair || id?.marks ? `FACE, EYES, HAIR, MARKS (as the story has them; the pictures win on looks): ${[id?.face, id?.eyes, id?.hair, id?.marks].filter(Boolean).join('; ')}` : '',
		spec.owned_element ? `OWNED ELEMENT: ${spec.owned_element}` : '',
		spec.owned_colour?.hex ? `OWNED COLOUR: ${spec.owned_colour.name} ${spec.owned_colour.hex}` : '',
		spec.powers.length ? `POWERS: ${spec.powers.join(', ')}` : '',
		spec.ownership_lock ? `LOCK: ${spec.ownership_lock}` : '',
		spec.notes ? `THE OPERATOR'S NOTES (these override the pictures): ${spec.notes}` : ''
	].filter(Boolean).join('\n');
}

/**
 * The prompt in one pass, as the skill would write it: the skill, the source images themselves (in order) and the
 * facts. The writer gives each image its job; the QC repairs it; then the price card is the approval.
 */
export async function writePrompt(deps: PrepDeps, project: Project, key: string): Promise<{ ok: true; prep: PrepFile } | Failure> {
	const found = await findEntry(deps, project, key);
	if (!found.ok) return found;
	const { view } = found;
	const preserveBody = view.entry.kind === 'character' && !!view.state.body_source_url;
	const bodyIndex = view.state.sources.findIndex((source) => source.url === view.state.body_source_url) + 1;
	if (preserveBody && !bodyIndex) return fail(400, 'The selected body reference is no longer attached');
	const gaps = factsGaps(view.state.spec, view.entry.kind, preserveBody);
	if (!view.state.spec || gaps.length) return fail(400, `Fill in ${gaps.join(', ')} first`);
	const bodyInstructions = preserveBody
		? `BODY REFERENCE: image ${bodyIndex} is the sole body baseline. Match the body shape and proportions exactly like image ${bodyIndex}. Do not describe height, weight, build, figure, muscle, limb lengths or body ratios anywhere in the prompt, including SUBJECT and the CHARACTER hand-off. Do not read or repeat physique labels from text printed on the reference. Keep the front figure at full-person scale and its original vertical placement; omit the head above the collarbones without enlarging the body or moving it upward to fill the panel. Leave empty background above the shoulders. Use a shared full-person scale and foot baseline for front and rear as layout only; the original source controls anatomy. The generated rear is never the baseline. This rule overrides any body descriptions or zoom-to-fill instructions in the skill, story, notes or other images.`
		: 'NO BODY REFERENCE: the attached images, if any, control the face or wardrobe only. Create a detailed coherent body from the facts: height in centimetres, build and natural proportions. Use the same full-person scale and foot baseline for front and rear; omit the front head above the collarbones without enlarging or moving the body upward, leaving empty background above the shoulders. Do not pretend an unseen body is being preserved.';
	const client = await deps.agent(project);
	if (!client) return fail(503, 'No Agent model is set up for this project (Settings)');
	const ask = `${entryContext(view, project, found.record)}\n\nTHE FACTS (what the pictures cannot say):\n${factsText(view.state.spec, preserveBody)}\n\nWrite the finished image prompt with template ${view.template}, exactly as the skill's output format says, for ${IMAGE_MODELS[view.state.image_model].label} at 2K${view.state.image_model === 'gpt_image_2_5' ? ', high quality' : ''}. Call it by its exact name. ${view.state.sources.length ? `${view.state.sources.length} source image${view.state.sources.length > 1 ? 's are' : ' is'} attached, in this order: ${view.state.sources.map((s, i) => `image ${i + 1}`).join(', ')}; refer to them as "image 1", "image 2"… exactly. ${IMAGE_JOBS}` : 'No images are attached.'}${view.entry.kind === 'character' ? ` The first (left) panel is the straight-on face close-up: face square to the camera, looking into the lens, never three-quarter. Every character sheet sits on the house near-white seamless studio backdrop, the same for the whole cast: never a location, a night exterior or a dark studio (the season look is for shots, not sheets). Give the look as its own labelled sections, each on its own line: GRADE:, CAMERA:, REALISM:, LOCKS: and AVOID:. GRADE is muted natural colour like the rest of the cast: true skin tones and real clothing colours, gently muted. ${bodyInstructions} Mouth closed. Keep AVOID short; it lists fangs and leg lengthening. The SUBJECT takes age from the facts and its looks from the images. When a body reference is selected, omit all body descriptions and measurements. End the prompt with this CHARACTER hand-off line, word for word, on its own line: ${handOffLine(view.state.spec, preserveBody)}` : ''} Never use the word "neon", not even in the AVOID line. Return only JSON: {"prompt": "the whole prompt"}`;
	const system = await skillSystem();
	const parse = (value: unknown) => {
		// The skill's output format puts the prompt in a "copy box"; the fences are not part of the prompt.
		const text = String((value as { prompt?: unknown })?.prompt ?? '').replace(/^\s*```[\w-]*\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
		if (text.length < 80) throw new Error('prompt: too short');
		return { prompt: text };
	};
	// The writer sees the images themselves: that is how it gives each one its job.
	const images = await sourceImages(view.state);
	let { prompt } = await generateStructured(client, { system, prompt: ask, images, maxOutputTokens: 3000, timeoutMs: 180_000 }, parse);
	// The QC runs before the operator sees the card; the Agent fixes what it finds itself (up to two rounds).
	for (let round = 0, issues = prepQc(prompt, view); issues.length && round < 2; round++, issues = prepQc(prompt, view)) {
		const repair = `${ask}\n\nYOUR PROMPT:\n${prompt}\n\nTHE QC FOUND (fix every one, change nothing else):\n${issues.map((issue) => `- ${issue}`).join('\n')}\n\nReturn only JSON: {"prompt": "the whole corrected prompt"}`;
		({ prompt } = await generateStructured(client, { system, prompt: repair, images, maxOutputTokens: 3000, timeoutMs: 180_000 }, parse));
	}
	const prep = await update(deps.projectRoot, project.project_id, key, (state) => ({ ...state, prompt, prompt_edited: false }));
	return { ok: true, prep };
}

/** A hand edit of the prompt; kept and marked. */
export async function editPrompt(deps: Pick<PrepDeps, 'projectRoot'>, projectId: string, key: string, prompt: string): Promise<PrepFile> {
	return update(deps.projectRoot, projectId, key, (state) => ({ ...state, prompt: prompt.trim().slice(0, 20_000), prompt_edited: true }));
}

// ---- make it: approval card, send, settle ----
const ASPECTS = new Set(['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', '4:5', '5:4']);
/** The skill's output ends with a SETTINGS line naming the aspect ("GPT Image 2.5, 3:2 landscape"); else the kind's default. */
export function aspectOf(prompt: string | null, kind: PrepView['entry']['kind']): string {
	// Every character sheet is 16:9, so the drawer's headshot (the left third) is the same frame for everyone.
	if (kind === 'character') return '16:9';
	const named = prompt?.match(/^SETTINGS:[^\n]*?\b(\d{1,2}:\d{1,2})\b/m)?.[1];
	return named && ASPECTS.has(named) ? named : prepAspect(kind);
}
const stillInput = (view: PrepView) => ({
	model: view.state.image_model,
	prompt: view.state.prompt ?? '',
	attached: view.state.sources.map((source, i) => ({ name: `${view.entry.name} — source image ${i + 1} (${source.name})`, file: source.file, url: source.url })),
	aspect_ratio: aspectOf(view.state.prompt, view.entry.kind),
	blocked: view.state.prompt ? prepQc(view.state.prompt, view) : ['Write the prompt first']
});

export async function quotePrep(deps: PrepDeps, project: Project, key: string): Promise<{ ok: true; approval: StillApproval } | Failure> {
	const found = await findEntry(deps, project, key);
	if (!found.ok) return found;
	return { ok: true, approval: await quoteStill(deps, project, stillInput(found.view)) };
}

export async function sendPrep(deps: PrepDeps, project: Project, key: string, approved: { approval_key: string; confirmed_credits: number }): Promise<{ ok: true; job_id: string; prep: PrepFile } | Failure> {
	const found = await findEntry(deps, project, key);
	if (!found.ok) return found;
	const sent = await sendStill(deps, { ...stillInput(found.view), project_id: project.project_id, purpose: 'reference', ...approved });
	if (!sent.ok) return sent;
	const prep = await update(deps.projectRoot, project.project_id, key, (state) => ({ ...state, job: { job_id: sent.job_id, sent_at: new Date().toISOString() } }));
	return { ok: true, job_id: sent.job_id, prep };
}

/** Land a finished sheet: stamp its exact name, upload it to `_References`, tick Name on sheet in Notion. */
async function land(deps: PrepDeps, project: Project, view: PrepView, file: string, outside: boolean): Promise<PrepFile> {
	const name = sheetFileName(view.entry.name);
	const stamped = await deps.stamp(file, view.entry.name, join(deps.projectRoot, project.project_id, 'files', 'prep', 'references', `${name}.png`));
	const url = `/api/projects/${project.project_id}/files/prep/references/${name}.png`;
	let uploaded = false;
	let note = '';
	const pageId = view.entry.reference_page_id;
	if (!pageId) note = `Add a "${view.entry.name}" row to the series' References in Notion (Kind ${view.entry.kind}) and re-sync; then attach this sheet to put it in the drawer.`;
	else if (!deps.references) note = 'Review Room is not configured, so the sheet stays here.';
	else {
		const result = await uploadReference(deps.references, project.series!.series_id, { page_id: pageId, file_name: `${name}.png`, bytes: new Uint8Array(await readFile(stamped)) });
		if (!result.ok) note = result.message;
		else {
			uploaded = true;
			// The app printed the exact name on the sheet itself, so it ticks Name on sheet (ADR 0005).
			if (deps.notion) {
				try {
					await deps.notion.updatePage(pageId, { 'Name on sheet': { checkbox: true }, 'File name': { rich_text: [{ type: 'text', text: { content: `${name}.png` } }] } });
					const record = await deps.series.read(project.series!.series_id);
					if (record?.references) await deps.series.write({ ...record, references: { ...record.references, items: record.references.items.map((item) => (item.page_id === pageId ? { ...item, name_on_sheet: true, file_name: `${name}.png` } : item)) } });
				} catch (cause) { note = `In the drawer; Notion's Name on sheet could not be ticked: ${cause instanceof Error ? cause.message : 'Notion refused'}`; }
			}
		}
	}
	const bodySource = view.state.sources.find((source) => source.url === view.state.body_source_url);
	const scale = view.entry.kind === 'character' && bodySource ? await checkScale(deps, project, view, stamped, bodySource.file) : undefined;
	return update(deps.projectRoot, project.project_id, view.entry.key, (state) => ({ ...state, job: null, result: { file: stamped, url, made_at: new Date().toISOString(), outside, uploaded, note, ...(scale ? { scale } : {}) } }));
}

/** The scale check on a character sheet; a failure to run it never stops a sheet from landing. */
async function checkScale(deps: PrepDeps, project: Project, view: PrepView, sheet: string, reference?: string): Promise<ScaleCheck | undefined> {
	if (!deps.scaleCheck || !reference) return undefined;
	const name = `${sheetFileName(view.entry.name)}-scale${reference ? '-source' : ''}.png`;
	const out = join(deps.projectRoot, project.project_id, 'files', 'prep', 'checks', name);
	await mkdir(dirname(out), { recursive: true });
	try {
		const result = await deps.scaleCheck(sheet, out, reference);
		return { ...result, method: 'original-front-v1', overlay_url: `/api/projects/${project.project_id}/files/prep/checks/${name}?t=${Date.now().toString(36)}`, against: 'source', checked_at: new Date().toISOString() };
	} catch { return undefined; }
}

/** Compare the landed front with an explicitly selected original source; never a generated rear panel. */
export async function rerunScaleCheck(deps: PrepDeps, project: Project, key: string, sourceUrl?: string): Promise<{ ok: true; prep: PrepFile } | Failure> {
	const found = await findEntry(deps, project, key);
	if (!found.ok) return found;
	const result = found.view.state.result;
	if (!result) return fail(400, 'No sheet has landed for this entry yet');
	if (found.view.entry.kind !== 'character') return fail(400, 'The scale check is for character sheets');
	if (!sourceUrl) return fail(400, 'Choose the original full-body source image to compare');
	const source = found.view.state.sources.find((s) => s.url === sourceUrl);
	if (sourceUrl && !source) return fail(404, 'That source image is not on this entry');
	const scale = await checkScale(deps, project, found.view, result.file, source?.file);
	if (!scale) return fail(422, 'Could not isolate a full body from this source. Choose a front full-body reference on a plain background, or upload a crop of that panel.');
	return { ok: true, prep: await update(deps.projectRoot, project.project_id, key, (state) => ({ ...state, result: state.result ? { ...state.result, scale } : null })) };
}

export async function settlePrep(deps: PrepDeps, project: Project, key: string): Promise<{ ok: true; pending: true } | { ok: true; pending: false; prep: PrepFile } | Failure> {
	const found = await findEntry(deps, project, key);
	if (!found.ok) return found;
	const job = found.view.state.job;
	if (!job) return fail(400, 'Nothing is being made for this entry');
	const settled = await settleStill(deps, { project_id: project.project_id, job_id: job.job_id, folder: 'prep/made', name: `${sheetFileName(found.view.entry.name)}-${job.job_id.slice(0, 8)}` });
	if (!settled.ok) { await update(deps.projectRoot, project.project_id, key, (state) => ({ ...state, job: null })); return settled; }
	if (settled.pending) return settled;
	return { ok: true, pending: false, prep: await land(deps, project, found.view, settled.file, false) };
}

/** A sheet made outside the app with the ONE SHOT skill, attached instead of run. */
export async function attachOutside(deps: PrepDeps, project: Project, key: string, input: { file_name: string; bytes: Uint8Array }): Promise<{ ok: true; prep: PrepFile } | Failure> {
	const found = await findEntry(deps, project, key);
	if (!found.ok) return found;
	const ext = extname(input.file_name).toLowerCase();
	if (!IMAGE_EXT.has(ext)) return fail(400, 'A sheet is a PNG, JPEG or WebP');
	const folder = join(deps.projectRoot, project.project_id, 'files', 'prep', 'made');
	await mkdir(folder, { recursive: true });
	const file = join(folder, `${sheetFileName(found.view.entry.name)}-outside-${Date.now().toString(36)}${ext}`);
	await writeFile(file, input.bytes);
	try { return { ok: true, prep: await land(deps, project, found.view, file, true) }; }
	catch (cause) { return fail(400, cause instanceof Error ? cause.message : 'Could not use that sheet'); }
}

/** `uv run scripts/panel_scale_check.py`: prints comparison metadata and writes the original/front/overlay image. */
export function uvScaleCheck(repoRoot: string): NonNullable<PrepDeps['scaleCheck']> {
	return (sheet, out, reference) => new Promise((resolve, reject) => {
		execFile('uv', ['run', '-q', join(repoRoot, 'scripts', 'panel_scale_check.py'), sheet, out, ...(reference ? ['--reference', reference] : [])], { timeout: 180_000, windowsHide: true }, (error, stdout, stderr) => {
			if (error) return reject(new Error((stderr || stdout || error.message).trim().split('\n').slice(-2).join(' ')));
			try { resolve(JSON.parse(stdout.trim().split('\n').at(-1) ?? '')); } catch { reject(new Error('The scale check printed no verdict')); }
		});
	});
}

/** `uv run scripts/stamp_reference_name.py` (the existing stamper): a dark band with the exact name. */
export function uvStamper(repoRoot: string): PrepDeps['stamp'] {
	return (file, name, out) => new Promise((resolve, reject) => {
		execFile('uv', ['run', join(repoRoot, 'scripts', 'stamp_reference_name.py'), file, name, '--out', out], { timeout: 120_000, windowsHide: true }, (error, stdout, stderr) => {
			if (error) return reject(new Error((stderr || stdout || error.message).trim().split('\n').slice(-2).join(' ')));
			resolve(stdout.trim().split('\n').at(-1) || out);
		});
	});
}
