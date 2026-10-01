import type { ProductionState, StoryCard } from './schemas';
import type { TakeResult } from './takes';

/**
 * The spine (CONTEXT.md: Spine) is the story order, set by how beats are
 * connected on the board: a single chain of links starting at the seed. Each
 * beat has at most one link in and one link out. Beats not reached from the
 * seed are off the spine: they keep their place on the canvas but are not
 * part of the story order.
 */

/** The seed's end of a link. */
export const SEED = 'seed';

export type SpineLink = { from: string; to: string };

export type SpineResult = { ok: true; chain: StoryCard[]; offSpine: StoryCard[] } | { ok: false; message: string };

const byOrder = (cards: StoryCard[]) => cards.toSorted((a, b) => a.order - b.order);

/** Projects saved before rewiring: seed → beats in card order. */
export function defaultLinks(cards: StoryCard[]): SpineLink[] {
	return byOrder(cards).map((card, index, sorted) => ({ from: index === 0 ? SEED : sorted[index - 1].card_id, to: card.card_id }));
}

/** The project's links, dropping any whose beats no longer exist. */
export function linksOf(production: ProductionState): SpineLink[] {
	if (!production.links) return defaultLinks(production.cards);
	const ids = new Set(production.cards.map((card) => card.card_id));
	return production.links.filter((link) => (link.from === SEED || ids.has(link.from)) && ids.has(link.to));
}

export function deriveSpine(cards: StoryCard[], links: SpineLink[]): SpineResult {
	const byId = new Map(cards.map((card) => [card.card_id, card]));
	const next = new Map<string, string>();
	const incoming = new Set<string>();
	for (const { from, to } of links) {
		if (from !== SEED && !byId.has(from)) return { ok: false, message: `Link from unknown beat ${from}` };
		if (!byId.has(to)) return { ok: false, message: `Link to unknown beat ${to}` };
		if (from === to) return { ok: false, message: `A beat cannot link to itself (${to})` };
		if (next.has(from)) return { ok: false, message: `${from === SEED ? 'The seed' : `Beat ${from}`} already links onward` };
		if (incoming.has(to)) return { ok: false, message: `Beat ${to} already has a link in` };
		next.set(from, to);
		incoming.add(to);
	}
	// With at most one link out per beat, a cycle is a walk that comes back to where it started.
	for (const start of next.keys()) {
		const seen = new Set<string>([start]);
		for (let at = next.get(start); at !== undefined; at = next.get(at)) {
			if (seen.has(at)) return { ok: false, message: 'The spine cannot loop back on itself' };
			seen.add(at);
		}
	}
	const chain: StoryCard[] = [];
	for (let at = next.get(SEED); at !== undefined; at = next.get(at)) chain.push(byId.get(at)!);
	const onChain = new Set(chain.map((card) => card.card_id));
	return { ok: true, chain, offSpine: byOrder(cards.filter((card) => !onChain.has(card.card_id))) };
}

/** The production's spine; stored links that no longer derive fall back to card order. */
export function spineOf(production: ProductionState): { chain: StoryCard[]; offSpine: StoryCard[] } {
	const derived = deriveSpine(production.cards, linksOf(production));
	return derived.ok ? derived : { chain: byOrder(production.cards), offSpine: [] };
}

/** The beats on the spine, in story order. */
export function spineBeats(production: ProductionState): StoryCard[] {
	return spineOf(production).chain;
}

/** The beats that play: the spine with benched beats skipped. */
export function liveSpine(production: ProductionState): StoryCard[] {
	return spineBeats(production).filter((card) => !card.benched);
}

/** Hook `from` onto `to`, unhooking whatever either end was linked to before. */
export function connect(links: SpineLink[], from: string, to: string): SpineLink[] {
	return [...links.filter((link) => link.from !== from && link.to !== to), { from, to }];
}

export function disconnect(links: SpineLink[], from: string, to: string): SpineLink[] {
	return links.filter((link) => !(link.from === from && link.to === to));
}

/** Store new links and renumber beats: spine order first, then off-spine beats in their old order. */
export function applyRewire(production: ProductionState, links: SpineLink[]): TakeResult {
	const derived = deriveSpine(production.cards, links);
	if (!derived.ok) return derived;
	const order = new Map([...derived.chain, ...derived.offSpine].map((card, index) => [card.card_id, index]));
	return {
		ok: true,
		production: {
			...production,
			links,
			cards: production.cards.map((card) => ({ ...card, order: order.get(card.card_id)! }))
		}
	};
}
