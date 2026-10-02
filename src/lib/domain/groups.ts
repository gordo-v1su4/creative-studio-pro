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
	segments: Array<{ index: number; start_seconds: number; end_seconds: number; duration_seconds: number; clip_path: string; label?: string }>;
}

export interface SplitShot { index: number; in_s: number; out_s: number; clip_path: string; file_name: string }

/** The shots a manifest describes, in order, with file names for their downloaded clips. */
export function shotsOf(manifest: SplitterManifest): SplitShot[] {
	return [...manifest.segments]
		.sort((a, b) => a.start_seconds - b.start_seconds)
		.filter((segment) => segment.end_seconds - segment.start_seconds > 0.04)
		.map((segment, i) => ({
			index: i + 1,
			in_s: Math.round(segment.start_seconds * 1000) / 1000,
			out_s: Math.round(segment.end_seconds * 1000) / 1000,
			clip_path: segment.clip_path,
			file_name: `${String(i + 1).padStart(2, '0')}-shot.mp4`
		}));
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
