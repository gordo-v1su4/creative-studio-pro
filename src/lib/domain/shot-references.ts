import type { ProductionState, ShotReference, StoryCard } from './schemas';
import { liveSpine } from './spine';
import { pickFor, type Take, type TakeResult } from './takes';

/**
 * References attached to one shot by hand (V1S-326 chips, V1S-328 previous frame). The prompt's @handles
 * add their own references at send; these are added after them, the previous shot's last frame last.
 */

export function applySetShotReferences(production: ProductionState, cardId: string, references: ShotReference[]): TakeResult {
	if (!production.cards.some((card) => card.card_id === cardId)) return { ok: false, message: `Shot ${cardId} not on this project` };
	const seen = new Set<string>();
	const kept: ShotReference[] = [];
	for (const reference of references) {
		// One chip per series reference, one previous frame per shot.
		const key = reference.kind === 'series' ? `series:${reference.page_id}` : 'previous_frame';
		if (seen.has(key)) continue;
		seen.add(key);
		kept.push(reference);
	}
	return {
		ok: true,
		production: {
			...production,
			cards: production.cards.map((card) => {
				if (card.card_id !== cardId) return card;
				const { references: _old, ...rest } = card;
				return kept.length ? { ...rest, references: kept } : rest;
			})
		}
	};
}

/** The shot that plays before this one: the one before it on the live spine, else the one before it by order. */
export function previousShot(production: ProductionState, cardId: string): StoryCard | null {
	const spine = liveSpine(production);
	const at = spine.findIndex((card) => card.card_id === cardId);
	if (at > 0) return spine[at - 1];
	if (at === 0) return null;
	const card = production.cards.find((entry) => entry.card_id === cardId);
	if (!card) return null;
	return production.cards.filter((entry) => !entry.benched && entry.order < card.order).toSorted((a, b) => b.order - a.order)[0] ?? null;
}

/** The previous shot and its pick, when there is one to take a frame from. */
export function previousPick(production: ProductionState, cardId: string): { card: StoryCard; pick: Take } | null {
	const card = previousShot(production, cardId);
	const pick = card ? pickFor(production, card) : null;
	return card && pick ? { card, pick } : null;
}

export const seriesReferenceIds = (card: Pick<StoryCard, 'references'>) => (card.references ?? []).flatMap((reference) => (reference.kind === 'series' ? [reference.page_id] : []));
export const previousFrameOf = (card: Pick<StoryCard, 'references'>) => (card.references ?? []).find((reference) => reference.kind === 'previous_frame') ?? null;
