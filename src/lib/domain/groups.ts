import type { ProductionAsset, ProductionState, StoryCard } from './schemas';
import type { TakeResult } from './takes';
import { defaultLinks } from './spine';

/**
 * Board groups (V1S-131): sets of beats the board switches between, e.g.
 * "Trailer review", "V6 20s trailer — shots". Every beat belongs to one
 * group; beats without one are in Main. A long take can be split into a
 * group of shot beats by scene detection (the splitter service).
 */

export const MAIN_GROUP = 'main';
export interface BoardGroup { group_id: string; name: string; count: number }

export const groupOf = (card: Pick<StoryCard, 'group_id'>) => card.group_id ?? MAIN_GROUP;

/** Main first, then the project's groups in creation order, each with its beat count. */
export function groupsOf(production: ProductionState): BoardGroup[] {
	const count = (id: string) => production.cards.filter((card) => groupOf(card) === id).length;
	return [{ group_id: MAIN_GROUP, name: 'Main', count: count(MAIN_GROUP) }, ...(production.groups ?? []).map((g) => ({ group_id: g.group_id, name: g.name, count: count(g.group_id) }))];
}

/**
 * Cut views: the board can also show the shots of a cut, wherever their groups are, in the order the cut
 * first plays them. A view never moves a beat; it is `cut:<cut_id>` in place of a group id.
 */
export const CUT_VIEW = 'cut:';
export const isCutView = (id: string) => id.startsWith(CUT_VIEW);

/** The shots a cut uses, once each, in the order they first play. */
export function cutShots(production: ProductionState, cutId: string): StoryCard[] {
	const cut = (production.cuts ?? []).find((entry) => entry.cut_id === cutId);
	if (!cut) return [];
	const seen = new Set<string>();
	const shots: StoryCard[] = [];
	for (const entry of cut.entries) {
		if (seen.has(entry.card_id)) continue;
		seen.add(entry.card_id);
		const card = production.cards.find((c) => c.card_id === entry.card_id);
		if (card) shots.push(card);
	}
	return shots;
}

/** Cuts worth opening on the board: edits of more than one clip (a single finished render is not an edit), newest first. */
export function cutViews(production: ProductionState): BoardGroup[] {
	return (production.cuts ?? []).filter((cut) => cut.entries.length > 1).toReversed()
		.map((cut) => ({ group_id: `${CUT_VIEW}${cut.cut_id}`, name: cut.name, count: cutShots(production, cut.cut_id).length }));
}

/**
 * Assemblies: scenes dropped on their own canvas, one node per scene. The reading order of the scene nodes
 * (rows top to bottom, left to right) is the scene order; playing them runs each scene's shots in story order,
 * benched shots skipped. An assembly never moves a shot; it is `asm:<assembly_id>` in place of a group id.
 */
export const ASSEMBLY_VIEW = 'asm:';
export const isAssemblyView = (id: string) => id.startsWith(ASSEMBLY_VIEW);
/** A board view that is not a group: its shots stay in their own scenes and its positions are not shot places. */
export const isBoardView = (id: string) => isCutView(id) || isAssemblyView(id);

type AssemblyScene = { group_id: string; x: number; y: number };
const sceneExists = (production: ProductionState, groupId: string) => (production.groups ?? []).some((g) => g.group_id === groupId);

/** A scene's shots in story order (their board order). */
export function sceneShots(production: ProductionState, groupId: string): StoryCard[] {
	return production.cards.filter((card) => card.group_id === groupId).toSorted((a, b) => a.order - b.order);
}

/** Up to `count` shots spread over a scene, first and last included (how it opens, develops and ends). */
export function sceneGlimpse<T>(shots: T[], count = 4): T[] {
	if (shots.length <= count) return shots;
	return Array.from({ length: count }, (_, i) => shots[Math.round((i * (shots.length - 1)) / (count - 1))]);
}

const cardExists = (production: ProductionState, cardId: string) => production.cards.some((c) => c.card_id === cardId);

/** The assemblies as board views, each counting its scenes and single shots still on the project. */
export function assemblyViews(production: ProductionState): BoardGroup[] {
	return (production.assemblies ?? []).map((a) => ({ group_id: `${ASSEMBLY_VIEW}${a.assembly_id}`, name: a.name,
		count: a.scenes.filter((s) => sceneExists(production, s.group_id)).length + (a.shots ?? []).filter((s) => cardExists(production, s.card_id)).length }));
}

/** An assembly item on its canvas: a whole scene, or one shot by reference. */
export type AssemblyItem = { kind: 'scene'; id: string } | { kind: 'shot'; id: string };

/**
 * What selected assembly items play, in the order given (their reading order): a scene plays its shots in story
 * order with benched shots skipped; a single shot plays itself (it was picked on purpose).
 */
export function assemblyPlay(production: ProductionState, items: AssemblyItem[]): string[] {
	return items.flatMap((item) => item.kind === 'scene'
		? sceneShots(production, item.id).filter((card) => !card.benched).map((card) => card.card_id)
		: cardExists(production, item.id) ? [item.id] : []);
}

export function applyCreateAssembly(production: ProductionState, input: { assembly_id: string; name: string }, now: string): TakeResult {
	const assemblies = production.assemblies ?? [];
	if (assemblies.some((a) => a.assembly_id === input.assembly_id)) return { ok: false, message: `Assembly ${input.assembly_id} already exists` };
	if (assemblies.some((a) => a.name.toLowerCase() === input.name.trim().toLowerCase())) return { ok: false, message: `There is already an assembly called ${input.name.trim()}` };
	return { ok: true, production: { ...production, assemblies: [...assemblies, { assembly_id: input.assembly_id, name: input.name.trim(), created_at: now, scenes: [] }] } };
}

/** Rename an assembly or set its scenes and their places; each scene at most once, and only real scenes. */
export function applyUpdateAssembly(production: ProductionState, input: { assembly_id: string; name?: string; scenes?: AssemblyScene[]; shots?: Array<{ card_id: string; x: number; y: number }> }): TakeResult {
	const assemblies = production.assemblies ?? [];
	const current = assemblies.find((a) => a.assembly_id === input.assembly_id);
	if (!current) return { ok: false, message: `Assembly ${input.assembly_id} not found` };
	if (input.name !== undefined && assemblies.some((a) => a.assembly_id !== input.assembly_id && a.name.toLowerCase() === input.name!.trim().toLowerCase())) return { ok: false, message: `There is already an assembly called ${input.name.trim()}` };
	if (input.scenes) {
		const ids = input.scenes.map((s) => s.group_id);
		if (new Set(ids).size !== ids.length) return { ok: false, message: 'A scene can be in an assembly only once' };
		const unknown = ids.find((id) => !sceneExists(production, id));
		if (unknown) return { ok: false, message: `Scene ${unknown} not found` };
	}
	if (input.shots) {
		const ids = input.shots.map((s) => s.card_id);
		if (new Set(ids).size !== ids.length) return { ok: false, message: 'A shot can be in an assembly only once' };
		const unknown = ids.find((id) => !cardExists(production, id));
		if (unknown) return { ok: false, message: `Shot ${unknown} not found` };
	}
	const next = { ...current, ...(input.name !== undefined ? { name: input.name.trim() } : {}), ...(input.scenes ? { scenes: input.scenes.map((s) => ({ ...s })) } : {}), ...(input.shots ? { shots: input.shots.map((s) => ({ ...s })) } : {}) };
	return { ok: true, production: { ...production, assemblies: assemblies.map((a) => (a.assembly_id === input.assembly_id ? next : a)) } };
}

export function applyRemoveAssembly(production: ProductionState, assemblyId: string): TakeResult {
	const assemblies = production.assemblies ?? [];
	if (!assemblies.some((a) => a.assembly_id === assemblyId)) return { ok: false, message: `Assembly ${assemblyId} not found` };
	return { ok: true, production: { ...production, assemblies: assemblies.filter((a) => a.assembly_id !== assemblyId) } };
}

/** Delete an empty group (Main stays). It also leaves any assembly it was placed in. Shots are never deleted with it. */
export function applyRemoveGroup(production: ProductionState, groupId: string): TakeResult {
	if (groupId === MAIN_GROUP) return { ok: false, message: 'Main stays' };
	const group = (production.groups ?? []).find((g) => g.group_id === groupId);
	if (!group) return { ok: false, message: `Group ${groupId} not found` };
	const inside = production.cards.filter((card) => card.group_id === groupId).length;
	if (inside) return { ok: false, message: `${group.name} still has ${inside} ${inside === 1 ? 'shot' : 'shots'}; move them out first` };
	return { ok: true, production: { ...production,
		groups: (production.groups ?? []).filter((g) => g.group_id !== groupId),
		...(production.assemblies ? { assemblies: production.assemblies.map((a) => ({ ...a, scenes: a.scenes.filter((s) => s.group_id !== groupId) })) } : {}) } };
}

const exists = (production: ProductionState, groupId: string) => groupId === MAIN_GROUP || (production.groups ?? []).some((g) => g.group_id === groupId);

export function applyCreateGroup(production: ProductionState, group: { group_id: string; name: string }, now: string): TakeResult {
	if (exists(production, group.group_id)) return { ok: false, message: `Group ${group.group_id} already exists` };
	if (groupsOf(production).some((g) => g.name.toLowerCase() === group.name.trim().toLowerCase())) return { ok: false, message: `There is already a group called ${group.name.trim()}` };
	return { ok: true, production: { ...production, groups: [...(production.groups ?? []), { group_id: group.group_id, name: group.name.trim(), created_at: now }] } };
}

export function applyRenameGroup(production: ProductionState, groupId: string, name: string): TakeResult {
	if (groupId === MAIN_GROUP) return { ok: false, message: 'Main keeps its name' };
	if (!exists(production, groupId)) return { ok: false, message: `Group ${groupId} not found` };
	return { ok: true, production: { ...production, groups: (production.groups ?? []).map((g) => (g.group_id === groupId ? { ...g, name: name.trim() } : g)) } };
}

/** Move beats to a group (Main clears the field). Their takes, picks and spine places are untouched. */
export function applyMoveBeats(production: ProductionState, cardIds: string[], groupId: string): TakeResult {
	if (!exists(production, groupId)) return { ok: false, message: `Group ${groupId} not found` };
	const missing = cardIds.find((id) => !production.cards.some((card) => card.card_id === id));
	if (missing) return { ok: false, message: `Beat ${missing} not found` };
	const moving = new Set(cardIds);
	return {
		ok: true,
		production: {
			...production,
			cards: production.cards.map((card) => {
				if (!moving.has(card.card_id)) return card;
				const { group_id: _old, ...rest } = card;
				return groupId === MAIN_GROUP ? rest : { ...rest, group_id: groupId };
			})
		}
	};
}

/** The splitter's result (splitter-pro2 JobManifest), as much of it as a split needs. */
export interface SplitterManifest {
	job_id: string;
	frame_rate: number;
	frame_count: number;
	segment_count: number;
	segments: Array<{ index: number; start_frame: number; end_frame: number; frame_count: number; clip_path: string }>;
}

export interface SplitShot { index: number; in_s: number; out_s: number; clip_path: string; file_name: string }
export interface SplitFrameRange { start_frame: number; end_frame: number; frame_count: number }

/** Validate the splitter's ordered, zero-based, end-exclusive source ranges. */
export function shotsOf(manifest: SplitterManifest, source: { fps: number; frames: number }): Array<SplitShot & SplitFrameRange> {
	if (!manifest || !Array.isArray(manifest.segments) || !manifest.segments.length || manifest.segment_count !== manifest.segments.length) {
		throw new Error('The splitter returned a missing or incomplete segment list');
	}
	if (manifest.frame_count !== source.frames || !Number.isFinite(manifest.frame_rate) || Math.abs(manifest.frame_rate - source.fps) > 0.0001) {
		throw new Error(`The splitter manifest does not match the source (${source.frames} decoded frames at ${source.fps} fps)`);
	}

	const paths = new Set<string>();
	let nextFrame = 0;
	const shots = manifest.segments.map((segment, offset) => {
		const index = offset + 1;
		if (!segment || segment.index !== index || segment.start_frame !== nextFrame ||
			!Number.isSafeInteger(segment.end_frame) || segment.end_frame <= nextFrame || segment.end_frame > source.frames ||
			segment.frame_count !== segment.end_frame - nextFrame) {
			throw new Error(`Split segment ${index} has an invalid or out-of-order frame range; expected frame ${nextFrame}`);
		}
		const { start_frame, end_frame, frame_count, clip_path } = segment;
		if (typeof clip_path !== 'string' || !clip_path.split('/').every((part) => part && part !== '.' && part !== '..' && !part.includes('\\')) || paths.has(clip_path)) {
			throw new Error(`Split segment ${index} has a missing, invalid or repeated clip path`);
		}
		paths.add(clip_path);
		nextFrame = end_frame;
		return {
			index, start_frame, end_frame, frame_count, clip_path,
			in_s: start_frame / source.fps,
			out_s: end_frame / source.fps,
			file_name: `${String(index).padStart(2, '0')}-shot.mp4`
		};
	});
	if (nextFrame !== source.frames) {
		throw new Error(`The split ends at frame ${nextFrame}, before the source end at ${source.frames}`);
	}
	return shots;
}

/**
 * A take split into shots becomes a new group: one beat per shot, each
 * holding that slice as its first take. Each slice remembers its source take
 * and its in/out there, so a finalized 1080p source can be re-split at the
 * same points. Shot beats stay off the main spine.
 */
export function applySplitIntoShots(
	production: ProductionState,
	input: { group_id: string; name: string; source: ProductionAsset; shots: Array<SplitShot & { url: string; width?: number; height?: number }>; ids: () => string },
	now: string
): TakeResult {
	if (!input.shots.length) return { ok: false, message: 'The splitter found no shots' };
	if (production.cards.length + input.shots.length > 200) return { ok: false, message: `That would make ${production.cards.length + input.shots.length} beats; the board holds 200` };
	const created = applyCreateGroup(production, { group_id: input.group_id, name: input.name }, now);
	if (!created.ok) return created;
	const base = created.production;
	let order = base.cards.reduce((max, card) => Math.max(max, card.order + 1), 0);
	const cards: StoryCard[] = [];
	const assets: ProductionAsset[] = [];
	for (const shot of input.shots) {
		const card_id = input.ids();
		const asset_id = input.ids();
		const length = shot.out_s - shot.in_s;
		cards.push({
			card_id, order: order++, title: `${input.name} — shot ${shot.index}`,
			beat: `Shot ${shot.index} of ${input.source.name} (${shot.in_s.toFixed(2)}–${shot.out_s.toFixed(2)}s).`,
			purpose: `Split from ${input.source.name}; swap in a better take of this shot when there is one.`,
			duration_ms: Math.min(120_000, Math.max(1, Math.round(length * 1000))),
			image_prompt: 'None yet (split from a take).', video_prompt: 'None yet (split from a take).',
			status: 'draft', pick_take_id: asset_id, group_id: input.group_id
		});
		assets.push({
			asset_id, card_id, kind: 'video', name: `${input.source.name.replace(/\.[^.]+$/, '')} · shot ${shot.index}.mp4`, mime_type: 'video/mp4', url: shot.url,
			duration_s: Math.round(length * 1000) / 1000, ...(shot.width ? { width: shot.width } : {}), ...(shot.height ? { height: shot.height } : {}),
			source_take: { asset_id: input.source.asset_id, in_s: shot.in_s, out_s: shot.out_s },
			created_at: now
		});
	}
	return {
		ok: true,
		production: { ...base, links: base.links ?? defaultLinks(base.cards), cards: [...base.cards, ...cards], assets: [...base.assets, ...assets] }
	};
}
