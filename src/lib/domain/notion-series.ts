/**
 * A series in Notion (the template every series follows): a root page holding a Story page and three linked
 * databases, Episodes → Scenes → Shots. This module reads Notion API objects (pages and data-source schemas)
 * into plain records, checks a root against the template, and turns one episode into board content: a group
 * per scene (named with its act) and a beat per shot. Notion stays the source; nothing here writes to it.
 */

// ---------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------

type PropType = 'title' | 'rich_text' | 'number' | 'select' | 'multi_select' | 'relation' | 'status';
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
			{ name: 'Cliffhanger', type: 'rich_text', required: false }
		]
	},
	scenes: {
		title: 'Scenes',
		props: [
			{ name: 'Scene', type: 'title', required: true },
			{ name: 'Scene #', type: 'number', required: true },
			{ name: 'Episode', type: 'relation', required: true },
			{ name: 'Summary', type: 'rich_text', required: true },
			{ name: 'Story Beats', type: 'rich_text', required: false },
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
			{ name: 'Shot #', type: 'number', required: false },
			{ name: 'Image Prompt (Keyframe)', type: 'rich_text', required: false },
			{ name: 'Seedance Refs', type: 'rich_text', required: false },
			{ name: 'Dialogue / VO', type: 'rich_text', required: false },
			{ name: 'Audio / SFX', type: 'rich_text', required: false },
			{ name: 'Shot Size', type: 'select', required: false },
			{ name: 'Lens', type: 'select', required: false },
			{ name: 'Camera Movement', type: 'select', required: false },
			{ name: 'Angle', type: 'select', required: false },
			{ name: 'Characters', type: 'multi_select', required: false },
			{ name: 'Status', type: ['select', 'status'], required: false }
		]
	}
};

export type DatabaseKey = keyof typeof SERIES_TEMPLATE;
/** A data source's property schema as the Notion API returns it: name → { type }. */
export type NotionSchema = Record<string, { type: string }>;
export interface TemplateCheck { ok: boolean; missing: string[]; wrongType: string[]; optionalMissing: string[] }

/** Does this database match the template? Required properties must exist with the right type. */
export function checkDatabase(key: DatabaseKey, schema: NotionSchema | null): TemplateCheck {
	const spec = SERIES_TEMPLATE[key];
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
export function relationOf(page: NotionPage, name: string): string[] {
	const prop = page.properties[name];
	return prop?.type === 'relation' ? (prop as { relation: Array<{ id: string }> }).relation.map((rel) => bareId(rel.id)) : [];
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface SeriesEpisode { page_id: string; number: number; title: string; status: string; act: string; season: number | null; summary: string; twist: string; cliffhanger: string; scene_ids: string[] }
export interface SeriesScene { page_id: string; number: number; title: string; summary: string; story_beats: string; timecode: string; location: string; characters: string[]; int_ext: string; time_of_day: string; status: string; episode_ids: string[]; act: string }
export interface SeriesShot { page_id: string; number: number; title: string; description: string; duration_s: number; video_prompt: string; image_prompt: string; refs: string; dialogue: string; audio: string; shot_size: string; lens: string; camera: string; angle: string; characters: string[]; status: string; scene_ids: string[] }

export const toEpisode = (page: NotionPage): SeriesEpisode => ({
	page_id: bareId(page.id), number: numberOf(page, 'Episode #') ?? 0, title: textOf(page, 'Title') || 'Untitled episode',
	status: textOf(page, 'Status'), act: textOf(page, 'Act'), season: numberOf(page, 'Season'), summary: textOf(page, 'Summary'),
	twist: textOf(page, 'Mid-Episode Twist'), cliffhanger: textOf(page, 'Cliffhanger'), scene_ids: relationOf(page, 'Scenes')
});

/** The act a scene belongs to, from its timecode ("Act 2 · ~3:00", "0:00–2:00 (Teaser)", "Tag · ~0:45"). */
export function actOf(timecode: string): string {
	if (/teaser|cold open/i.test(timecode)) return 'Teaser';
	if (/\btag\b/i.test(timecode)) return 'Tag';
	const act = timecode.match(/act\s*(\d+)/i);
	return act ? `Act ${act[1]}` : '';
}

export const toScene = (page: NotionPage): SeriesScene => {
	const timecode = textOf(page, 'Timecode');
	return {
		page_id: bareId(page.id), number: numberOf(page, 'Scene #') ?? 0, title: textOf(page, 'Scene') || 'Untitled scene', summary: textOf(page, 'Summary'),
		story_beats: textOf(page, 'Story Beats'), timecode, location: textOf(page, 'Location'), characters: namesOf(page, 'Characters'),
		int_ext: textOf(page, 'INT/EXT'), time_of_day: textOf(page, 'Time of Day'), status: textOf(page, 'Status'), episode_ids: relationOf(page, 'Episode'), act: actOf(timecode)
	};
};

export const toShot = (page: NotionPage): SeriesShot => ({
	page_id: bareId(page.id), number: numberOf(page, 'Shot #') ?? 0, title: textOf(page, 'Shot') || 'Untitled shot', description: textOf(page, 'Description'),
	duration_s: numberOf(page, 'Duration (s)') ?? 0, video_prompt: textOf(page, 'Video Prompt (Seedance 2.5)'), image_prompt: textOf(page, 'Image Prompt (Keyframe)'),
	refs: textOf(page, 'Seedance Refs'), dialogue: textOf(page, 'Dialogue / VO'), audio: textOf(page, 'Audio / SFX'), shot_size: textOf(page, 'Shot Size'),
	lens: textOf(page, 'Lens'), camera: textOf(page, 'Camera Movement'), angle: textOf(page, 'Angle'), characters: namesOf(page, 'Characters'),
	status: textOf(page, 'Status'), scene_ids: relationOf(page, 'Scene')
});

// ---------------------------------------------------------------------------
// One episode, laid out
// ---------------------------------------------------------------------------

const ACT_ORDER = ['Teaser', 'Act 1', 'Act 2', 'Act 3', 'Act 4', 'Act 5', 'Tag', ''];
const actRank = (act: string) => { const i = ACT_ORDER.indexOf(act); return i < 0 ? ACT_ORDER.length : i; };

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
export interface OutlineScene { page_id: string; number: number; title: string; act: string; summary: string; story_beats: string; timecode: string; location: string; characters: string[]; group_id: string; seconds: number; shot_count: number }
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
	for (const scene of layout.scenes) {
		const group_id = newId();
		groups.push({ group_id, name: clip(scene.act ? `${scene.act} · ${scene.title}` : scene.title, 120), created_at: now });
		outline.push({ page_id: scene.page_id, number: scene.number, title: scene.title, act: scene.act, summary: scene.summary, story_beats: scene.story_beats, timecode: scene.timecode, location: scene.location, characters: scene.characters, group_id, seconds: scene.seconds, shot_count: scene.shots.length });
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
