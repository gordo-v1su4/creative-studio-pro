import { z } from 'zod';

/**
 * Prep (V1S-374): the step before shots where the references an episode needs are listed, given source images
 * and made, each from an approved reference spec, to the ONE SHOT standard (ADR 0003). Characters come first,
 * then each scene's locations; props only when added. Entries come from the series' references and the scenes'
 * named characters and locations; the state of each (source images, spec, prompt, result) is kept per project.
 */

export type PrepKind = 'character' | 'location' | 'prop';
const KIND_ORDER: Record<PrepKind, number> = { character: 0, location: 1, prop: 2 };

export interface PrepReference { page_id: string; name: string; kind: string; role: string; scene_ids: string[] }
export interface PrepScene { page_id: string; title: string; number: number; location: string; characters: string[]; reference_ids?: string[] }

export interface PrepEntry {
	/** Stable key: the Notion reference page id, else `<kind>:<name>`. */
	key: string;
	kind: PrepKind;
	/** The exact name used on the sheet and in every prompt. */
	name: string;
	role: string;
	/** The series' Notion References row, when there is one (needed to land in the References drawer). */
	reference_page_id: string | null;
	/** Scenes of this episode that use it, in scene order. */
	scenes: Array<{ page_id: string; title: string }>;
}

const bare = (id: string) => id.replace(/-/g, '');
export const kindOf = (kind: string): PrepKind | null => {
	const k = kind.trim().toLowerCase();
	return k.startsWith('char') ? 'character' : k.startsWith('loc') ? 'location' : k.startsWith('prop') ? 'prop' : null;
};
/** Names compared on letters and digits, so `Kai "Hoodie" Santana` matches `Kai Hoodie Santana`. */
const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
/** Walk-on roles, not people to make a sheet for. */
const WALK_ONS = new Set(['customer', 'customers', 'student', 'students', 'guest', 'guests', 'partyguest', 'partyguests', 'volunteer', 'sophomore', 'freshman', 'freshmen', 'crowd', 'extras', 'bartender', 'cashier', 'driver', 'nurse', 'cop', 'officer']);
/** A named person or place (not "the freshmen", "party guests" or a walk-on like "Customer"). */
const isNamed = (name: string) => /^[A-Z]/.test(name.trim()) && !/^(the|a|an)\s/i.test(name.trim()) && !WALK_ONS.has(squash(name));
/** "Video Haven — back room / counter" → "Video Haven"; "Veridian Avenue → Video Haven exterior" → "Veridian Avenue". */
export const placeName = (location: string) => location.split(/\s+[—–-]\s+|\s*\/\s*|\s*\(\s*|\s*→\s*/)[0].trim();

/** Does this scene name `reference` (by its first name, its full name, or a link)? */
function sceneUses(scene: PrepScene, reference: PrepReference): boolean {
	if (reference.scene_ids.map(bare).includes(bare(scene.page_id)) || (scene.reference_ids ?? []).map(bare).includes(bare(reference.page_id))) return true;
	const full = squash(reference.name);
	const first = squash(reference.name.split(/\s+/)[0] ?? '');
	if (kindOf(reference.kind) === 'location') return squash(scene.location).includes(full);
	return scene.characters.some((name) => squash(name) === full || squash(name) === first || full.includes(squash(name)) && squash(name).length > 3);
}

/** The episode's Prep list: characters (most scenes first), then locations (scene order), then props. */
export function prepEntries(scenes: PrepScene[], references: PrepReference[], extraProps: string[] = []): PrepEntry[] {
	const ordered = scenes.toSorted((a, b) => a.number - b.number);
	const entries: PrepEntry[] = [];
	const covered = new Set<string>();
	for (const reference of references) {
		const kind = kindOf(reference.kind);
		if (!kind) continue;
		const used = ordered.filter((scene) => sceneUses(scene, reference));
		if (!used.length) continue;
		entries.push({ key: reference.page_id, kind, name: reference.name, role: reference.role, reference_page_id: reference.page_id, scenes: used.map((scene) => ({ page_id: scene.page_id, title: scene.title })) });
		covered.add(`${kind}:${squash(reference.name)}`);
		if (kind === 'character') covered.add(`character:${squash(reference.name.split(/\s+/)[0] ?? '')}`);
	}
	// Named characters and places the scenes mention that have no reference yet.
	const loose = new Map<string, PrepEntry>();
	const add = (kind: PrepKind, name: string, scene: PrepScene) => {
		const id = `${kind}:${squash(name)}`;
		if (!squash(name) || covered.has(id)) return;
		const entry = loose.get(id) ?? { key: `${kind}:${name}`, kind, name, role: '', reference_page_id: null, scenes: [] };
		if (!entry.scenes.some((s) => s.page_id === scene.page_id)) entry.scenes.push({ page_id: scene.page_id, title: scene.title });
		loose.set(id, entry);
	};
	for (const scene of ordered) {
		for (const name of scene.characters) {
			if (!isNamed(name)) continue;
			// "Kai Santana" next to a "Kai …" reference is the same person.
			if (covered.has(`character:${squash(name.split(/\s+/)[0] ?? '')}`)) continue;
			add('character', name.trim(), scene);
		}
		let place = placeName(scene.location);
		// "Video Haven rear exit" is still Video Haven when that place is already listed.
		const known = [...loose.values(), ...entries].find((entry) => entry.kind === 'location' && squash(place).startsWith(squash(entry.name)));
		if (known) place = known.name;
		if (place && isNamed(place) && !(known?.reference_page_id)) add('location', place, scene);
	}
	for (const prop of extraProps) if (prop.trim()) entries.push({ key: `prop:${prop.trim()}`, kind: 'prop', name: prop.trim(), role: '', reference_page_id: null, scenes: [] });
	return [...entries, ...loose.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.kind === 'character' ? b.scenes.length - a.scenes.length : 0) || scenes.findIndex((s) => s.page_id === a.scenes[0]?.page_id) - scenes.findIndex((s) => s.page_id === b.scenes[0]?.page_id));
}

/** Which ONE SHOT template makes this reference (oneshot-image-prompts/references/templates.md). */
export function templateFor(kind: PrepKind, hasSources: boolean): 'T1' | 'T5a' | 'W3' | 'W8' | 'W6' {
	if (kind === 'character') return hasSources ? 'T5a' : 'T1';
	if (kind === 'location') return hasSources ? 'W8' : 'W3';
	return 'W6';
}

/** Characters render as a wide three-panel sheet; location sheets and prop sheets are landscape too. */
export const prepAspect = (kind: PrepKind) => (kind === 'prop' ? '4:3' : '16:9');

/**
 * The facts a reference is made from (glossary: Reference spec): only what the pictures cannot say. The prompt
 * writer looks at the source images itself, gives each one its job and writes the prompt in one pass, so the
 * spec never describes the pictures (a description of them goes stale the moment the images change).
 */
export const referenceSpecSchema = z.object({
	name: z.string().trim().min(1).max(200),
	kind: z.enum(['character', 'location', 'prop']),
	template: z.enum(['T1', 'T5a', 'W3', 'W8', 'W6']),
	/** The operator's notes: changes from the pictures (wardrobe, dry hair…), or for a place or prop, what it is. */
	notes: z.string().trim().max(3000).default(''),
	/** Older specs only (description, must hold, from sources): kept so they parse, never used for characters. */
	description: z.string().trim().max(3000).default(''),
	must_hold: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
	from_sources: z.string().trim().max(1000).default(''),
	/** Characters: who they are, field by field (every character has an age and a height). */
	identity: z.object({
		sex: z.string().trim().max(40).default(''),
		age: z.number().int().min(1).max(120).nullable().default(null),
		height_cm: z.number().int().min(50).max(250).nullable().default(null),
		build: z.string().trim().max(120).default(''),
		face: z.string().trim().max(240).default(''),
		eyes: z.string().trim().max(120).default(''),
		hair: z.string().trim().max(160).default(''),
		marks: z.string().trim().max(240).default('')
	}).optional(),
	/** The ONE SHOT hand-off parts (settings-and-qc.md, File 11): what the character owns across every shot. */
	owned_element: z.string().trim().max(160).default(''),
	owned_colour: z.object({ name: z.string().trim().max(60).default(''), hex: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/).or(z.literal('')).default('') }).optional(),
	powers: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
	/** One sentence: what the owned element always looks like and what it is never mistaken for. */
	ownership_lock: z.string().trim().max(400).default('')
});
export type ReferenceSpec = z.infer<typeof referenceSpecSchema>;

const cm = (value: number) => `${value} cm`;

/** A place or prop's notes; an older spec's description stands in until notes are written. */
export const notesOf = (spec: ReferenceSpec) => spec.notes || (spec.kind === 'character' ? '' : spec.description);

/** Whether the facts are complete enough to write the prompt from. */
export function factsGaps(spec: ReferenceSpec | null, kind: PrepKind, preserveBody = false): string[] {
	if (!spec) return ['the facts (Draft facts)'];
	if (kind === 'character') return identityGaps(spec, preserveBody);
	return notesOf(spec) ? [] : ['notes: what it is'];
}

/** What a character spec still needs before its sheet can be made (age and height above all). */
export function identityGaps(spec: ReferenceSpec, preserveBody = false): string[] {
	if (spec.kind !== 'character') return [];
	const id = spec.identity;
	const gaps: string[] = [];
	if (!id?.age) gaps.push('age');
	if (!preserveBody && !id?.height_cm) gaps.push('height (cm)');
	if (!id?.sex) gaps.push('sex');
	if (!preserveBody && !id?.build) gaps.push('build');
	return gaps;
}

/**
 * The CHARACTER hand-off line in the ONE SHOT format, built from the fields so it reads the same for everyone:
 * CHARACTER KAI — identity: male, 18, lean wiry free-runner, 178 cm, baby-faced with freckles, amber eyes, …;
 * costume as sheet; owned element: …; owned colour: amber #D98A2B; powers: …. <ownership lock>
 * Locations: LOCATION [NAME] — the description's first sentence.
 */
export function handOffLine(spec: ReferenceSpec, preserveBody = false): string {
	if (spec.kind !== 'character') return `${spec.kind === 'location' ? 'LOCATION' : 'PROP'} ${spec.name.toUpperCase()} — ${notesOf(spec).split(/(?<=\.)\s/)[0]}`;
	const id = spec.identity;
	const first = spec.name.replace(/"[^"]*"\s*/g, '').split(/\s+/)[0].toUpperCase();
	const identity = [id?.sex, id?.age ? String(id.age) : '', preserveBody ? 'body shape and proportions exactly as reference' : id?.build, !preserveBody && id?.height_cm ? cm(id.height_cm) : '', id?.face, id?.eyes, id?.hair, id?.marks].map((part) => (part ?? '').trim()).filter(Boolean).join(', ');
	const colour = spec.owned_colour?.name || spec.owned_colour?.hex ? `${spec.owned_colour?.name ?? ''} ${spec.owned_colour?.hex ?? ''}`.trim() : '';
	const parts = [`CHARACTER ${first} — identity: ${identity || 'to fill'}`, 'costume as sheet'];
	if (spec.owned_element) parts.push(`owned element: ${spec.owned_element}`);
	if (colour) parts.push(`owned colour: ${colour}`);
	if (spec.powers.length) parts.push(`powers: ${spec.powers.join(', ')}`);
	return `${parts.join('; ')}.${spec.ownership_lock ? ` ${spec.ownership_lock}` : ''}`;
}

/**
 * Original-reference comparison: original cutout, generated front, and an overlay of the actual pixels.
 * One scale factor per picture, matched by body width with feet aligned. No automatic anatomy verdict.
 * Legacy measurement fields remain readable but their old checks are not shown in the UI.
 */
export const scaleCheckSchema = z.object({
	/** Only original-front-v1 is a current visual comparison; old numeric checks stay readable on disk. */
	method: z.literal('original-front-v1').optional(),
	ok: z.boolean(),
	stretch: z.number().optional(),
	zoom: z.number().optional(),
	fit: z.number().optional(),
	width_ratio: z.number(),
	feet_offset: z.number(),
	verdict: z.string().max(400),
	/** Original cutout, generated front, and original pixels at 50% opacity over the generated front. */
	overlay_url: z.string().max(1000),
	against: z.enum(['rear', 'source']).default('rear'),
	checked_at: z.string()
});
export type ScaleCheck = z.infer<typeof scaleCheckSchema>;

export const prepSourceSchema =z.object({ name: z.string().min(1).max(300), file: z.string().min(1).max(1000), url: z.string().max(1000), added_at: z.string() });
export const prepStateSchema = z.object({
	image_model: z.enum(['gpt_image_2_5', 'nano_banana_pro']).default('gpt_image_2_5'),
	sources: z.array(prepSourceSchema).max(12).default([]),
	/** Explicit source role: portraits must not silently become body references. */
	body_source_url: z.string().max(1000).nullable().default(null),
	spec: referenceSpecSchema.nullable().default(null),
	/** Older Prep only: specs used to be approved before the prompt; the price card is the one approval now. */
	spec_approved_at: z.string().nullable().default(null),
	/** Written in one pass from the skill, the images and the facts; an edit by hand is kept (prompt_edited). */
	prompt: z.string().max(20_000).nullable().default(null),
	prompt_edited: z.boolean().default(false),
	job: z.object({ job_id: z.string().min(1).max(200), sent_at: z.string() }).nullable().default(null),
	result: z.object({ file: z.string(), source_file: z.string().optional(), url: z.string(), made_at: z.string(), outside: z.boolean().default(false), uploaded: z.boolean().default(false), note: z.string().max(500).default(''), scale: scaleCheckSchema.optional() }).nullable().default(null)
});
export type PrepState = z.infer<typeof prepStateSchema>;
export const prepFileSchema = z.object({ schema_version: z.literal(1), props: z.array(z.string().max(200)).max(50).default([]), entries: z.record(z.string(), prepStateSchema).default({}) });
export type PrepFile = z.infer<typeof prepFileSchema>;
export const emptyPrep = (): PrepFile => ({ schema_version: 1, props: [], entries: {} });
export const emptyState = (): PrepState => prepStateSchema.parse({});

/** Where an entry stands, for the node graph. */
export function prepStage(state: PrepState): 'sources' | 'spec' | 'prompt' | 'sent' | 'made' {
	if (state.result) return 'made';
	if (state.job) return 'sent';
	if (state.prompt) return 'prompt';
	if (state.spec) return 'spec';
	return 'sources';
}

/** The sheet's file name carries the exact name, so the send gate's file-name check passes. */
export const sheetFileName = (name: string) => `${name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}_sheet`;
