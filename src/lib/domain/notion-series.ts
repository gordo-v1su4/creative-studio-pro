/**
 * A series in Notion (the template every series follows): a root page holding a Story page and three linked
 * databases, Episodes → Scenes → Shots. This module reads Notion API objects (pages and data-source schemas)
 * into plain records, checks a root against the template, and turns one episode into board content: a group
 * per scene (named with its act) and a beat per shot. Notion stays the source; nothing here writes to it.
 */

// ---------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------

type PropType = 'title' | 'rich_text' | 'number' | 'select' | 'multi_select' | 'relation' | 'status' | 'checkbox';
interface PropSpec { name: string; type: PropType | PropType[]; required: boolean }

export const SERIES_TEMPLATE: Record<'episodes' | 'scenes' | 'shots', { title: string; props: PropSpec[] }> = {
	episodes: {
		title: 'Episodes',
		props: [
			{ name: 'Title', type: 'title', required: true },
			{ name: 'Episode #', type: 'number', required: true },
			{ name: 'Summary', type: 'rich_text', required: true },
			{ name: 'Scenes', type: 'relation', required: true },
			{ name: 'Status', type: ['select', 'status'], required: false },
			{ name: 'Act', type: 'select', required: false },
			{ name: 'Season', type: 'number', required: false },
			{ name: 'Mid-Episode Twist', type: 'rich_text', required: false },
			{ name: 'Cliffhanger', type: 'rich_text', required: false },
			// Template v3 (V1S-323): the outline is the writer's; the codes are written by the app (ADR 0002).
			{ name: 'Episode outline', type: 'rich_text', required: false },
			{ name: 'Show code', type: 'rich_text', required: false },
			{ name: 'Episode code', type: 'rich_text', required: false },
			{ name: 'Locked', type: 'checkbox', required: false }
		]
	},
	scenes: {
		title: 'Scenes',
		props: [
			{ name: 'Scene', type: 'title', required: true },
			{ name: 'Scene #', type: ['number', 'rich_text'], required: true }, // v3: text "010" so Notion shows the padding
			{ name: 'Episode', type: 'relation', required: true },
			{ name: 'Summary', type: 'rich_text', required: true },
			{ name: 'Action', type: 'rich_text', required: false }, // template v3; v1/v2 called it "Story Beats"
			{ name: 'Dialogue', type: 'rich_text', required: false },
			{ name: 'References', type: 'relation', required: false },
			{ name: 'Scene code', type: 'rich_text', required: false },
			{ name: 'Locked', type: 'checkbox', required: false },
			{ name: 'Section', type: 'select', required: false }, // template v2: Teaser / Act 1… / Tag; else the act comes from Timecode
			{ name: 'Timecode', type: 'rich_text', required: false },
			{ name: 'Location', type: 'rich_text', required: false },
			{ name: 'Characters', type: 'multi_select', required: false },
			{ name: 'INT/EXT', type: 'select', required: false },
			{ name: 'Time of Day', type: 'select', required: false },
			{ name: 'Status', type: ['select', 'status'], required: false }
		]
	},
	shots: {
		title: 'Shots',
		props: [
			{ name: 'Shot', type: 'title', required: true },
			{ name: 'Scene', type: 'relation', required: true },
			{ name: 'Description', type: 'rich_text', required: true },
			{ name: 'Duration (s)', type: 'number', required: true },
			{ name: 'Video Prompt (Seedance 2.5)', type: 'rich_text', required: true },
			{ name: 'Shot #', type: ['number', 'rich_text'], required: false }, // v3: text "0010"
			{ name: 'Image Prompt (Keyframe)', type: 'rich_text', required: false },
			{ name: 'Seedance Refs', type: 'rich_text', required: false },
			{ name: 'Dialogue / VO', type: 'rich_text', required: false },
			{ name: 'Audio / SFX', type: 'rich_text', required: false },
			{ name: 'Shot Size', type: 'select', required: false },
			{ name: 'Lens', type: 'select', required: false },
			{ name: 'Camera Movement', type: 'select', required: false },
			{ name: 'Angle', type: 'select', required: false },
			{ name: 'Characters', type: 'multi_select', required: false },
			{ name: 'Status', type: ['select', 'status'], required: false },
			{ name: 'Shot code', type: 'rich_text', required: false },
			{ name: 'Locked', type: 'checkbox', required: false }
		]
	}
};

/**
 * Template v2 (V1S-272): the season's story beats, each in one Save the Cat section, linked to the scenes
 * (and episode) where it plays out. Optional, so a v1 series without it still imports.
 */
export const STORY_BEATS_TEMPLATE = {
	title: 'Story Beats',
	props: [
		{ name: 'Beat', type: 'title', required: true },
		{ name: 'Section', type: 'select', required: true },
		{ name: 'Order', type: 'number', required: false },
		{ name: 'Summary', type: 'rich_text', required: false },
		{ name: 'Episode', type: 'relation', required: false },
		{ name: 'Scenes', type: 'relation', required: false }
	] as PropSpec[]
};

/**
 * Template v3 (V1S-323): the named images that lock how a character, location or prop looks. Optional, so
 * older series still import. Name is the exact string printed on the image and used in every prompt.
 */
export const REFERENCES_TEMPLATE = {
	title: 'References',
	props: [
		{ name: 'Name', type: 'title', required: true },
		{ name: 'Kind', type: 'select', required: true },
		{ name: 'Role line', type: 'rich_text', required: false },
		{ name: 'Handles', type: 'rich_text', required: false },
		{ name: 'File name', type: 'rich_text', required: false },
		{ name: 'Name on sheet', type: 'checkbox', required: false },
		{ name: 'Scenes', type: 'relation', required: false }
	] as PropSpec[]
};

export type DatabaseKey = keyof typeof SERIES_TEMPLATE;
/** A data source's property schema as the Notion API returns it: name → { type }. */
export type NotionSchema = Record<string, { type: string }>;
export interface TemplateCheck { ok: boolean; missing: string[]; wrongType: string[]; optionalMissing: string[] }

/** Does this database match the template? Required properties must exist with the right type. */
export function checkDatabase(key: DatabaseKey | 'story_beats' | 'references', schema: NotionSchema | null): TemplateCheck {
	const spec = key === 'story_beats' ? STORY_BEATS_TEMPLATE : key === 'references' ? REFERENCES_TEMPLATE : SERIES_TEMPLATE[key];
	if (!schema) return { ok: false, missing: [`the ${spec.title} database`], wrongType: [], optionalMissing: [] };
	const missing: string[] = [], wrongType: string[] = [], optionalMissing: string[] = [];
	for (const prop of spec.props) {
		const found = schema[prop.name];
		const types = Array.isArray(prop.type) ? prop.type : [prop.type];
		if (!found) (prop.required ? missing : optionalMissing).push(`${spec.title} · ${prop.name}`);
		else if (!types.includes(found.type as PropType)) wrongType.push(`${spec.title} · ${prop.name} is ${found.type}, expected ${types.join(' or ')}`);
	}
	return { ok: missing.length === 0 && wrongType.length === 0, missing, wrongType, optionalMissing };
}

// ---------------------------------------------------------------------------
// Reading page properties
// ---------------------------------------------------------------------------

/** A Notion page as the API returns it (only what is read here). */
export interface NotionPage { id: string; url?: string; properties: Record<string, NotionProp> }
type RichText = Array<{ plain_text?: string }>;
export type NotionProp =
	| { type: 'title'; title: RichText }
	| { type: 'rich_text'; rich_text: RichText }
	| { type: 'number'; number: number | null }
	| { type: 'select'; select: { name: string } | null }
	| { type: 'status'; status: { name: string } | null }
	| { type: 'multi_select'; multi_select: Array<{ name: string }> }
	| { type: 'relation'; relation: Array<{ id: string }> }
	| { type: string; [key: string]: unknown };

const plain = (rich: RichText | undefined) => (rich ?? []).map((part) => part.plain_text ?? '').join('').trim();
/** Notion ids come with and without dashes; compare them without. */
export const bareId = (id: string) => id.replace(/-/g, '').toLowerCase();

export function textOf(page: NotionPage, name: string): string {
	const prop = page.properties[name];
	if (!prop) return '';
	if (prop.type === 'title') return plain((prop as { title: RichText }).title);
	if (prop.type === 'rich_text') return plain((prop as { rich_text: RichText }).rich_text);
	if (prop.type === 'select') return (prop as { select: { name: string } | null }).select?.name ?? '';
	if (prop.type === 'status') return (prop as { status: { name: string } | null }).status?.name ?? '';
	if (prop.type === 'number') { const n = (prop as { number: number | null }).number; return n === null ? '' : String(n); }
	return '';
}
export function numberOf(page: NotionPage, name: string): number | null {
	const prop = page.properties[name];
	return prop?.type === 'number' ? (prop as { number: number | null }).number : null;
}
export function namesOf(page: NotionPage, name: string): string[] {
	const prop = page.properties[name];
	return prop?.type === 'multi_select' ? (prop as { multi_select: Array<{ name: string }> }).multi_select.map((option) => option.name) : [];
}
/** An order number kept as a number (v1/v2) or as padded text ("010", template v3); null when empty or not a number. */
export function ordinalOf(page: NotionPage, name: string): number | null {
	const prop = page.properties[name];
	if (prop?.type === 'number') return (prop as { number: number | null }).number;
	const text = textOf(page, name).trim();
	return /^\d+$/.test(text) ? Number(text) : null;
}
export function checkedOf(page: NotionPage, name: string): boolean {
	const prop = page.properties[name];
	return prop?.type === 'checkbox' ? Boolean((prop as { checkbox?: boolean }).checkbox) : false;
}
export function relationOf(page: NotionPage, name: string): string[] {
	const prop = page.properties[name];
	return prop?.type === 'relation' ? (prop as { relation: Array<{ id: string }> }).relation.map((rel) => bareId(rel.id)) : [];
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** The codes as Notion shows them right now (template v3; written by the app, ADR 0002). Empty when the column is missing. */
export interface NotionCodes { show: string; episode: string; scene: string; shot: string; shot_number: number | null; locked: boolean }
const codesOf = (page: NotionPage): NotionCodes => ({
	show: textOf(page, 'Show code'), episode: textOf(page, 'Episode code'), scene: textOf(page, 'Scene code'), shot: textOf(page, 'Shot code'),
	shot_number: ordinalOf(page, 'Shot #'), locked: checkedOf(page, 'Locked')
});

export interface SeriesEpisode { page_id: string; number: number; title: string; status: string; act: string; season: number | null; summary: string; outline: string; twist: string; cliffhanger: string; scene_ids: string[]; notion_codes: NotionCodes }
export interface SeriesScene { page_id: string; number: number; title: string; summary: string; story_beats: string; dialogue: string; reference_ids: string[]; timecode: string; location: string; characters: string[]; int_ext: string; time_of_day: string; status: string; episode_ids: string[]; act: string; notion_codes: NotionCodes }
export interface SeriesShot { page_id: string; number: number; title: string; description: string; duration_s: number; video_prompt: string; image_prompt: string; refs: string; dialogue: string; audio: string; shot_size: string; lens: string; camera: string; angle: string; characters: string[]; status: string; scene_ids: string[]; notion_codes: NotionCodes }

export const toEpisode = (page: NotionPage): SeriesEpisode => ({
	page_id: bareId(page.id), number: numberOf(page, 'Episode #') ?? 0, title: textOf(page, 'Title') || 'Untitled episode',
	status: textOf(page, 'Status'), act: textOf(page, 'Act'), season: numberOf(page, 'Season'), summary: textOf(page, 'Summary'),
	outline: textOf(page, 'Episode outline'), twist: textOf(page, 'Mid-Episode Twist'), cliffhanger: textOf(page, 'Cliffhanger'),
	scene_ids: relationOf(page, 'Scenes'), notion_codes: codesOf(page)
});

/** A reference image row (template v3): exact name, kind, the handles that point at it. */
export interface SeriesReference { page_id: string; name: string; kind: string; role: string; handles: string[]; file_name: string; name_on_sheet: boolean; scene_ids: string[] }
export const toReference = (page: NotionPage): SeriesReference => ({
	page_id: bareId(page.id), name: textOf(page, 'Name'), kind: textOf(page, 'Kind'), role: textOf(page, 'Role line'),
	handles: textOf(page, 'Handles').split(/[,\s]+/).map((handle) => handle.trim()).filter((handle) => /^@\S+$/.test(handle)),
	file_name: textOf(page, 'File name'), name_on_sheet: checkedOf(page, 'Name on sheet'), scene_ids: relationOf(page, 'Scenes')
});

/** The act a scene belongs to, from its timecode ("Act 2 · ~3:00", "0:00–2:00 (Teaser)", "Tag · ~0:45"). */
export function actOf(timecode: string): string {
	if (/teaser|cold open/i.test(timecode)) return 'Teaser';
	if (/\btag\b/i.test(timecode)) return 'Tag';
	const act = timecode.match(/act\s*(\d+)/i);
	return act ? `Act ${act[1]}` : '';
}

/** A season story beat from the Story Beats database (template v2). */
export interface SeriesStoryBeat { page_id: string; title: string; section: string; order: number | null; summary: string; episode_ids: string[]; scene_ids: string[] }
export const toStoryBeat = (page: NotionPage): SeriesStoryBeat => ({
	page_id: bareId(page.id), title: textOf(page, 'Beat') || 'Untitled story beat', section: textOf(page, 'Section'), order: numberOf(page, 'Order'),
	summary: textOf(page, 'Summary'), episode_ids: relationOf(page, 'Episode'), scene_ids: relationOf(page, 'Scenes')
});

export const toScene = (page: NotionPage): SeriesScene => {
	const timecode = textOf(page, 'Timecode');
	// Template v2's Section (Teaser / Act 1… / Tag) wins over the act read from the timecode.
	const section = textOf(page, 'Section');
	return {
		page_id: bareId(page.id), number: ordinalOf(page, 'Scene #') ?? 0, title: textOf(page, 'Scene') || 'Untitled scene', summary: textOf(page, 'Summary'),
		story_beats: textOf(page, 'Action') || textOf(page, 'Story Beats'), dialogue: textOf(page, 'Dialogue'), reference_ids: relationOf(page, 'References'),
		timecode, location: textOf(page, 'Location'), characters: namesOf(page, 'Characters'),
		int_ext: textOf(page, 'INT/EXT'), time_of_day: textOf(page, 'Time of Day'), status: textOf(page, 'Status'), episode_ids: relationOf(page, 'Episode'), act: ACT_ORDER.includes(section) && section ? section : actOf(timecode),
		notion_codes: codesOf(page)
	};
};

export const toShot = (page: NotionPage): SeriesShot => ({
	page_id: bareId(page.id), number: ordinalOf(page, 'Shot #') ?? 0, title: textOf(page, 'Shot') || 'Untitled shot', description: textOf(page, 'Description'),
	duration_s: numberOf(page, 'Duration (s)') ?? 0, video_prompt: textOf(page, 'Video Prompt (Seedance 2.5)'), image_prompt: textOf(page, 'Image Prompt (Keyframe)'),
	refs: textOf(page, 'Seedance Refs'), dialogue: textOf(page, 'Dialogue / VO'), audio: textOf(page, 'Audio / SFX'), shot_size: textOf(page, 'Shot Size'),
	lens: textOf(page, 'Lens'), camera: textOf(page, 'Camera Movement'), angle: textOf(page, 'Angle'), characters: namesOf(page, 'Characters'),
	status: textOf(page, 'Status'), scene_ids: relationOf(page, 'Scene'), notion_codes: codesOf(page)
});

// ---------------------------------------------------------------------------
// One episode, laid out
// ---------------------------------------------------------------------------

const ACT_ORDER = ['Teaser', 'Act 1', 'Act 2', 'Act 3', 'Act 4', 'Act 5', 'Tag', ''];
export const actRank = (act: string) => { const i = ACT_ORDER.indexOf(act); return i < 0 ? ACT_ORDER.length : i; };

export interface EpisodeLayout {
	episode: SeriesEpisode;
	scenes: Array<SeriesScene & { shots: SeriesShot[]; seconds: number }>;
	/** Shots no scene of this episode claims (kept visible, never silently dropped). */
	loose: SeriesShot[];
	seconds: number;
}

/** The episode's scenes in act order, each with its shots in order, and the running time the shots add up to. */
export function layoutEpisode(episode: SeriesEpisode, allScenes: SeriesScene[], allShots: SeriesShot[]): EpisodeLayout {
	const scenes = allScenes
		.filter((scene) => scene.episode_ids.includes(episode.page_id) || episode.scene_ids.includes(scene.page_id))
		.sort((a, b) => actRank(a.act) - actRank(b.act) || a.number - b.number)
		.map((scene) => {
			const shots = allShots.filter((shot) => shot.scene_ids.includes(scene.page_id)).sort((a, b) => a.number - b.number || a.title.localeCompare(b.title));
			return { ...scene, shots, seconds: shots.reduce((sum, shot) => sum + shot.duration_s, 0) };
		});
	const claimed = new Set(scenes.flatMap((scene) => scene.shots.map((shot) => shot.page_id)));
	const sceneIds = new Set(scenes.map((scene) => scene.page_id));
	const loose = allShots.filter((shot) => !claimed.has(shot.page_id) && shot.scene_ids.some((id) => sceneIds.has(id)));
	return { episode, scenes, loose, seconds: scenes.reduce((sum, scene) => sum + scene.seconds, 0) };
}

/** The minutes a scene's timecode plans for it ("Act 1 · ~1:30" → 1.5); null when it gives a range or nothing. */
export function plannedMinutes(timecode: string): number | null {
	const approx = timecode.match(/~\s*(\d+):(\d{2})/);
	if (approx) return Number(approx[1]) + Number(approx[2]) / 60;
	const range = timecode.match(/(\d+):(\d{2})\s*[–-]\s*(\d+):(\d{2})/);
	if (range) return Math.max(0, Number(range[3]) + Number(range[4]) / 60 - (Number(range[1]) + Number(range[2]) / 60));
	return null;
}

/**
 * Each act's share of the episode at a target length: the act's planned minutes (from the scenes' timecodes)
 * scaled to the target, falling back to its shot seconds when the timecodes say nothing.
 */
export function actBudget(layout: EpisodeLayout, targetMinutes: number): Array<{ act: string; planned_min: number; target_s: number; shot_s: number; scenes: number }> {
	const acts = new Map<string, { planned: number; shot: number; scenes: number }>();
	for (const scene of layout.scenes) {
		const entry = acts.get(scene.act) ?? { planned: 0, shot: 0, scenes: 0 };
		entry.planned += plannedMinutes(scene.timecode) ?? scene.seconds / 60;
		entry.shot += scene.seconds;
		entry.scenes += 1;
		acts.set(scene.act, entry);
	}
	const total = [...acts.values()].reduce((sum, act) => sum + act.planned, 0) || 1;
	return [...acts.entries()]
		.sort((a, b) => actRank(a[0]) - actRank(b[0]))
		.map(([act, entry]) => ({ act: act || 'Unassigned', planned_min: Math.round(entry.planned * 10) / 10, target_s: Math.round((entry.planned / total) * targetMinutes * 60), shot_s: Math.round(entry.shot), scenes: entry.scenes }));
}

// ---------------------------------------------------------------------------
// An episode as board content
// ---------------------------------------------------------------------------

/** Where a beat came from in Notion, and the shot details the board card has no field for. */
export interface ShotSource { notion_page_id: string; scene_page_id: string; dialogue?: string; audio?: string; refs?: string; shot_size?: string; lens?: string; camera?: string; angle?: string; characters?: string[] }
export interface OutlineScene { page_id: string; number: number; title: string; act: string; summary: string; story_beats: string; dialogue: string; reference_ids: string[]; timecode: string; location: string; characters: string[]; group_id: string; seconds: number; shot_count: number; code?: string }
export interface ImportedCard { card_id: string; order: number; title: string; beat: string; purpose: string; duration_ms: number; image_prompt: string; video_prompt: string; status: 'draft'; group_id: string; source: ShotSource }

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const orNone = (value: string, none: string) => value.trim() || none;
const keep = (value: string) => value.trim().length > 0;

/**
 * The board for one episode: a group per scene ("Act 1 · P02 — Morning Quad"), a beat per shot in reading
 * order with its prompts, duration and Notion details, and the scene outline the Story tab shows.
 */
export function episodeToBoard(layout: EpisodeLayout, newId: () => string, now: string): { groups: Array<{ group_id: string; name: string; created_at: string }>; cards: ImportedCard[]; outline: OutlineScene[] } {
	const groups: Array<{ group_id: string; name: string; created_at: string }> = [];
	const cards: ImportedCard[] = [];
	const outline: OutlineScene[] = [];
	const codes = new Set<string>();
	for (const scene of layout.scenes) {
		const group_id = newId();
		groups.push({ group_id, name: clip(scene.act ? `${scene.act} · ${scene.title}` : scene.title, 120), created_at: now });
		// A scene code already in Notion (seeded by hand, or written by an earlier sync) is kept when it is valid and free.
		const notionCode = scene.notion_codes.scene.trim().toUpperCase();
		const code = /^[A-Z]{3}$/.test(notionCode) && !codes.has(notionCode) ? notionCode : undefined;
		if (code) codes.add(code);
		outline.push({ page_id: scene.page_id, number: scene.number, title: scene.title, act: scene.act, summary: scene.summary, story_beats: scene.story_beats, dialogue: scene.dialogue, reference_ids: scene.reference_ids, timecode: scene.timecode, location: scene.location, characters: scene.characters, group_id, seconds: scene.seconds, shot_count: scene.shots.length, ...(code ? { code } : {}) });
		for (const shot of scene.shots) {
			const details: ShotSource = { notion_page_id: shot.page_id, scene_page_id: scene.page_id };
			for (const [key, value] of [['dialogue', shot.dialogue], ['audio', shot.audio], ['refs', shot.refs], ['shot_size', shot.shot_size], ['lens', shot.lens], ['camera', shot.camera], ['angle', shot.angle]] as const) if (keep(value)) details[key] = clip(value, 4000);
			if (shot.characters.length) details.characters = shot.characters;
			cards.push({
				card_id: newId(), order: cards.length, title: clip(shot.title, 200),
				beat: clip(orNone(shot.description, `${scene.title}, shot ${shot.number || cards.length + 1}`), 4000),
				purpose: clip(orNone(scene.summary, scene.title), 1000),
				duration_ms: Math.round(Math.min(120, Math.max(0.5, shot.duration_s || 5)) * 1000),
				image_prompt: clip(orNone(shot.image_prompt, 'None yet (from Notion).'), 5000),
				video_prompt: clip(orNone(shot.video_prompt, 'None yet (from Notion).'), 5000),
				status: 'draft', group_id, source: details
			});
		}
	}
	return { groups, cards, outline };
}
