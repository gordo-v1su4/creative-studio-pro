import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { Project } from '$lib/domain/schemas';
import {
	emptyPrep, emptyState, prepAspect, prepEntries, prepFileSchema, referenceSpecSchema, sheetFileName, templateFor,
	type PrepEntry, type PrepFile, type PrepState, type ReferenceSpec
} from '$lib/domain/prep';
import type { StillApproval } from '$lib/domain/stills';
import { generateStructured, type AgentModelClient, type ModelImage } from './model-provider';
import { readAgentSkill } from './agent-skills';
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
		// New sources change the spec's template (T1 → T5a): the spec and prompt are redrafted.
		spec: null, spec_approved_at: null, prompt: null, prompt_edited: false
	}));
	return { ok: true, prep };
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
	const [skill, templates, look] = await Promise.all([
		readAgentSkill('oneshot-image-prompts'),
		readAgentSkill('oneshot-image-prompts', 'references/templates.md'),
		readAgentSkill('oneshot-image-prompts', 'references/house-look.md')
	]);
	return `You are the reference maker inside Creative Studio Pro. Follow this skill exactly; it is the one standard for every reference.\n\n${skill}\n\n# Templates\n\n${templates}\n\n# House look\n\n${look}`;
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
	for (const source of state.sources.slice(0, 3)) {
		const ext = extname(source.file).toLowerCase();
		try { out.push({ data: new Uint8Array(await readFile(source.file)), mediaType: ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg' }); } catch { /* a missing file is skipped */ }
	}
	return out;
}

/** The Agent drafts the reference spec (fields only, no prompt); the operator edits and approves it. */
export async function draftSpec(deps: PrepDeps, project: Project, key: string): Promise<{ ok: true; spec: ReferenceSpec; prep: PrepFile } | Failure> {
	const found = await findEntry(deps, project, key);
	if (!found.ok) return found;
	const client = await deps.agent(project);
	if (!client) return fail(503, 'No Agent model is set up for this project (Settings)');
	const { view } = found;
	const ask = `${entryContext(view, project, found.record)}\n\nDraft the REFERENCE SPEC for this reference: the fields it will be made from, not the prompt. Return only JSON:\n{"name": "${view.entry.name}", "kind": "${view.entry.kind}", "template": "${view.template}", "description": "one plain paragraph: who or what it is and how it looks", "must_hold": ["each detail that must hold in every shot"], "from_sources": "which source images to lean on and how (empty if none)"}\nUse the exact name as given. Night unless the story says otherwise. Never use the word "neon".`;
	const parse = (value: unknown) => {
		const spec = referenceSpecSchema.parse(value);
		return { ...spec, name: view.entry.name, kind: view.entry.kind, template: view.template as ReferenceSpec['template'] };
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

/** The operator's edits to the spec, and their approval (approving clears an old prompt). */
export async function saveSpec(deps: Pick<PrepDeps, 'projectRoot' | 'series'>, project: Project, key: string, input: { spec: ReferenceSpec; approve: boolean }): Promise<{ ok: true; prep: PrepFile } | Failure> {
	const found = await findEntry(deps, project, key);
	if (!found.ok) return found;
	const spec = referenceSpecSchema.parse({ ...input.spec, name: found.view.entry.name, kind: found.view.entry.kind, template: found.view.template });
	const prep = await update(deps.projectRoot, project.project_id, key, (state) => ({ ...state, spec, spec_approved_at: input.approve ? new Date().toISOString() : null, prompt: null, prompt_edited: false }));
	return { ok: true, prep };
}

/** QC on a reference prompt before the approval card (V1S-374). */
export function prepQc(prompt: string, view: PrepView): string[] {
	const out: string[] = [];
	if (!prompt.includes(view.entry.name)) out.push(`The prompt must call it by its exact name, "${view.entry.name}"`);
	if (/\bneon\b/i.test(prompt)) out.push('The prompt uses the word "neon"; describe the light another way');
	if (view.entry.kind === 'character' && !/straight-on|face square to the camera/i.test(prompt)) out.push('The first panel must be a straight-on, forward-facing face close-up (the T1 wording)');
	if (view.entry.kind === 'character' && /three-quarter[^.]*first panel|first panel[^.]*three-quarter/i.test(prompt)) out.push('The first panel is three-quarter; it must face the camera');
	for (const [i, source] of view.state.sources.entries()) if (!new RegExp(`\\bimage ${i + 1}\\b`, 'i').test(prompt) && view.state.sources.length) { out.push(`Source image ${i + 1} (${source.name}) is attached but the prompt never names "image ${i + 1}"`); break; }
	return out;
}

/** The prompt, written from the approved spec with the skill's template; then the approval card. */
export async function writePrompt(deps: PrepDeps, project: Project, key: string): Promise<{ ok: true; prep: PrepFile } | Failure> {
	const found = await findEntry(deps, project, key);
	if (!found.ok) return found;
	const { view } = found;
	if (!view.state.spec || !view.state.spec_approved_at) return fail(400, 'Approve the reference spec first');
	const client = await deps.agent(project);
	if (!client) return fail(503, 'No Agent model is set up for this project (Settings)');
	const ask = `${entryContext(view, project, found.record)}\n\nAPPROVED REFERENCE SPEC (write from this, change nothing in it):\n${JSON.stringify(view.state.spec, null, 2)}\n\nWrite the finished image prompt with template ${view.template}, exactly as the skill's output format says, for GPT Image 2.5. Call it by its exact name. ${view.state.sources.length ? `The source images are attached in this order: ${view.state.sources.map((s, i) => `image ${i + 1}`).join(', ')}; refer to them as "image 1", "image 2"… exactly.` : 'No images are attached.'}${view.entry.kind === 'character' ? ' The first (left) panel is the straight-on face close-up: face square to the camera, looking into the lens, never three-quarter.' : ''} Never use the word "neon", not even in the AVOID line. Return only JSON: {"prompt": "the whole prompt"}`;
	const { prompt } = await generateStructured(client, { system: await skillSystem(), prompt: ask, maxOutputTokens: 3000, timeoutMs: 180_000 }, (value) => {
		const text = String((value as { prompt?: unknown })?.prompt ?? '').trim();
		if (text.length < 80) throw new Error('prompt: too short');
		return { prompt: text };
	});
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
	const named = prompt?.match(/^SETTINGS:[^\n]*?\b(\d{1,2}:\d{1,2})\b/m)?.[1];
	return named && ASPECTS.has(named) ? named : prepAspect(kind);
}
const stillInput = (view: PrepView) => ({
	prompt: view.state.prompt ?? '',
	attached: view.state.sources.map((source, i) => ({ name: `${view.entry.name} — source image ${i + 1} (${source.name})`, file: source.file, url: source.url })),
	aspect_ratio: aspectOf(view.state.prompt, view.entry.kind),
	blocked: view.state.prompt ? prepQc(view.state.prompt, view) : ['Write the prompt from the approved spec first']
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
	return update(deps.projectRoot, project.project_id, view.entry.key, (state) => ({ ...state, job: null, result: { file: stamped, url, made_at: new Date().toISOString(), outside, uploaded, note } }));
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

/** `uv run scripts/stamp_reference_name.py` (the existing stamper): a dark band with the exact name. */
export function uvStamper(repoRoot: string): PrepDeps['stamp'] {
	return (file, name, out) => new Promise((resolve, reject) => {
		execFile('uv', ['run', join(repoRoot, 'scripts', 'stamp_reference_name.py'), file, name, '--out', out], { timeout: 120_000, windowsHide: true }, (error, stdout, stderr) => {
			if (error) return reject(new Error((stderr || stdout || error.message).trim().split('\n').slice(-2).join(' ')));
			resolve(stdout.trim().split('\n').at(-1) || out);
		});
	});
}
