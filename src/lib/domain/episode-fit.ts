import { z } from 'zod';
import type { ProductionState, StoryCard } from '$lib/domain/schemas';
import type { EpisodeOutline, OutlineSceneRow } from '$lib/domain/episode-outline';
import { defaultLinks, type SpineLink } from '$lib/domain/spine';

/**
 * "Fit to length": an imported episode is shorter than its target (EP01 is about 6 min of shots against
 * 10 or 15). For each scene short of its budget, the Agent writes new shots that fill the gap, in the
 * scene's own style; every prompt goes through the lint loop. New beats land right after the scene's last
 * beat (on the spine too), carry a `fit` marker, and can be taken out again while they have no takes.
 */

/** Seedance 2.5 renders 4 s and up; fitted shots stay short like the Notion ones. */
export const FIT_SHOT_MIN_S = 4;
export const FIT_SHOT_MAX_S = 10;
const FIT_SHOT_TYPICAL_S = 6;
/** A scene closer than this to its budget is left alone. */
export const FIT_MIN_GAP_S = FIT_SHOT_MIN_S;
/** At most this many new shots per scene per pass (the Agent writes them in one answer). */
export const FIT_MAX_SHOTS = 12;

export interface FitScene { page_id: string; group_id: string; title: string; gap_s: number; shots_wanted: number }

/** The scenes to fill (all short ones, or only those asked for), with how much time and how many shots each needs. */
export function fitPlan(outline: EpisodeOutline, onlyScenes?: string[]): FitScene[] {
	const rows: OutlineSceneRow[] = outline.acts.flatMap((act) => act.scenes);
	return rows
		.filter((row) => !onlyScenes || onlyScenes.includes(row.page_id))
		.map((row) => ({ page_id: row.page_id, group_id: row.group_id, title: row.title, gap_s: Math.round(row.target_s - row.shot_s) }))
		.filter((scene) => scene.gap_s >= FIT_MIN_GAP_S)
		.map((scene) => ({ ...scene, shots_wanted: Math.min(FIT_MAX_SHOTS, Math.max(1, Math.round(scene.gap_s / FIT_SHOT_TYPICAL_S))) }));
}

const text = (max: number) => z.string().trim().max(max);
export const fitShotSchema = z.object({
	description: text(4000).min(1),
	duration_s: z.number().positive(),
	video_prompt: text(5000).min(1),
	image_prompt: text(5000).optional().default(''),
	dialogue: text(4000).optional().default(''),
	audio: text(4000).optional().default(''),
	refs: text(4000).optional().default(''),
	characters: z.array(text(100).min(1)).max(40).optional().default([])
});
export type FitShot = z.infer<typeof fitShotSchema>;

/** The Agent's answer: {"shots": [...]}, between one and a couple more shots than asked for. */
export function parseFitShots(value: unknown, scene: FitScene): FitShot[] {
	const parsed = z.object({ shots: z.array(fitShotSchema).min(1).max(scene.shots_wanted + 2) }).parse(value);
	return parsed.shots;
}

/** Whole-second durations, each 4–10 s, scaled so they add up to the gap as nearly as the limits allow. */
export function fitDurations(asked: number[], gap_s: number): number[] {
	const clamp = (value: number) => Math.min(FIT_SHOT_MAX_S, Math.max(FIT_SHOT_MIN_S, Math.round(value)));
	const sum = asked.reduce((total, value) => total + Math.max(0, value), 0);
	const scaled = asked.map((value) => clamp(sum > 0 ? (Math.max(0, value) / sum) * gap_s : gap_s / asked.length));
	// Settle the rounding: add or take a second at a time where the limits allow, longest first.
	for (let drift = gap_s - scaled.reduce((total, value) => total + value, 0), guard = 0; drift !== 0 && guard < 200; guard++) {
		const step = drift > 0 ? 1 : -1;
		const order = scaled.map((value, i) => [value, i] as const).sort((a, b) => (step > 0 ? a[0] - b[0] : b[0] - a[0]));
		const pick = order.find(([value]) => (step > 0 ? value < FIT_SHOT_MAX_S : value > FIT_SHOT_MIN_S));
		if (!pick) break;
		scaled[pick[1]] += step; drift -= step;
	}
	return scaled;
}

export interface FittedShot extends FitShot { lint: { rounds: number; fixed: number; remaining: number } }

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** "P02.03" → prefix "P02" and 3; titles that do not follow the pattern give no number. */
function titleParts(title: string): { prefix: string; n: number } | null {
	const match = title.match(/^(.*?)(\d+)\s*$/);
	return match && /[.\s_-]$/.test(match[1]) ? { prefix: match[1], n: Number(match[2]) } : null;
}

/** The new beats for one scene: titles continue the scene's numbering ("P02.04", "P02.05"…). */
export function fittedCards(scene: FitScene & { title: string }, groupCards: StoryCard[], shots: FittedShot[], input: { newId: () => string; now: string; target_min: number; summary: string }): StoryCard[] {
	const numbered = groupCards.map((card) => titleParts(card.title)).filter((part): part is { prefix: string; n: number } => part !== null);
	const prefix = numbered.at(-1)?.prefix ?? `${scene.title.split(/\s+[—–-]\s+/)[0]}.`;
	let next = numbered.reduce((max, part) => Math.max(max, part.n), 0);
	const width = Math.max(2, ...numbered.map((part) => String(part.n).length));
	const durations = fitDurations(shots.map((shot) => shot.duration_s), scene.gap_s);
	return shots.map((shot, i) => {
		const fit: NonNullable<StoryCard['fit']> = { target_min: input.target_min, at: input.now, lint: shot.lint };
		if (shot.dialogue) fit.dialogue = clip(shot.dialogue, 4000);
		if (shot.audio) fit.audio = clip(shot.audio, 4000);
		if (shot.refs) fit.refs = clip(shot.refs, 4000);
		if (shot.characters.length) fit.characters = shot.characters.map((name) => clip(name, 100));
		next += 1;
		return {
			card_id: input.newId(), order: 0, title: clip(`${prefix}${String(next).padStart(width, '0')}`, 200),
			beat: clip(shot.description, 4000), purpose: clip(input.summary.trim() || scene.title, 1000),
			duration_ms: durations[i] * 1000, image_prompt: clip(shot.image_prompt.trim() || 'None yet (written by Fit).', 5000),
			video_prompt: clip(shot.video_prompt, 5000), status: 'draft', group_id: scene.group_id, fit
		};
	});
}

/**
 * Put new beats right after the group's last beat: in card order, and on the spine when the project keeps
 * explicit links (last → new… → whatever followed). A group with no beats gets them at the end.
 */
export function insertIntoGroup(production: ProductionState, groupId: string, added: StoryCard[]): ProductionState {
	if (added.length === 0) return production;
	const sorted = production.cards.toSorted((a, b) => a.order - b.order);
	const inGroup = sorted.filter((card) => card.group_id === groupId);
	const last = inGroup.at(-1);
	const at = last ? sorted.indexOf(last) + 1 : sorted.length;
	const cards = [...sorted.slice(0, at), ...added, ...sorted.slice(at)].map((card, order) => ({ ...card, order }));
	if (!production.links) return { ...production, cards };
	const links: SpineLink[] = [...production.links];
	const chain = added.map((card, i) => ({ from: i === 0 ? null : added[i - 1].card_id, to: card.card_id }));
	const outIndex = last ? links.findIndex((link) => link.from === last.card_id) : -1;
	const onSpine = last && (outIndex >= 0 || links.some((link) => link.to === last.card_id));
	if (!onSpine) return { ...production, cards };
	const after = outIndex >= 0 ? links.splice(outIndex, 1)[0].to : null;
	links.push({ from: last.card_id, to: added[0].card_id }, ...chain.slice(1).map((link) => ({ from: link.from!, to: link.to })));
	if (after) links.push({ from: added.at(-1)!.card_id, to: after });
	return { ...production, cards, links };
}

/** Take fitted beats out again (all, or a scene's), but only those with no takes; the spine closes over the gap. */
export function removeFitted(production: ProductionState, groupIds?: string[]): { production: ProductionState; removed: number; kept: number } {
	const withTakes = new Set(production.assets.map((asset) => asset.card_id));
	const target = production.cards.filter((card) => card.fit && (!groupIds || (card.group_id && groupIds.includes(card.group_id))));
	const drop = new Set(target.filter((card) => !withTakes.has(card.card_id)).map((card) => card.card_id));
	if (drop.size === 0) return { production, removed: 0, kept: target.length };
	const cards = production.cards.filter((card) => !drop.has(card.card_id)).toSorted((a, b) => a.order - b.order).map((card, order) => ({ ...card, order }));
	let links = production.links;
	if (links) {
		const next = new Map(links.map((link) => [link.from, link.to]));
		const skip = (id: string | undefined): string | undefined => { let at = id; while (at && drop.has(at)) at = next.get(at); return at; };
		links = links.filter((link) => !drop.has(link.from)).map((link) => ({ ...link, to: skip(link.to) })).filter((link): link is SpineLink => !!link.to);
	}
	return { production: { ...production, cards, ...(links ? { links } : {}) }, removed: drop.size, kept: target.length - drop.size };
}

/** For tests and callers that need the effective links either way. */
export const effectiveLinks = (production: ProductionState): SpineLink[] => production.links ?? defaultLinks(production.cards);
