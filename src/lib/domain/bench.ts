import type { ProductionState, StoryCard } from './schemas';
import type { TakeResult } from './takes';

/**
 * Benched beats (CONTEXT.md: Benched). A benched beat stays on the board and
 * keeps its place on the spine, but is skipped wherever the spine is played
 * or assembled (see liveSpine in spine.ts). Benching never touches takes,
 * picks or existing cuts.
 */

export function applyBench(production: ProductionState, cardId: string, benched: boolean): TakeResult {
	if (!production.cards.some((card) => card.card_id === cardId)) return { ok: false, message: `Beat ${cardId} not on this project` };
	return {
		ok: true,
		production: {
			...production,
			cards: production.cards.map((card) => {
				if (card.card_id !== cardId) return card;
				const { benched: _old, ...rest } = card;
				return benched ? { ...rest, benched: true } : rest;
			})
		}
	};
}

export function benchedBeats(production: ProductionState): StoryCard[] {
	return production.cards.filter((card) => card.benched).toSorted((a, b) => a.order - b.order);
}
