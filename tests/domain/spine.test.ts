import { describe, expect, test } from 'bun:test';
import { SEED, connect, defaultLinks, deriveSpine, disconnect, type SpineLink } from '../../src/lib/domain/spine';
import type { StoryCard } from '../../src/lib/domain/schemas';

const beat = (id: string, order: number): StoryCard => ({
	card_id: id, order, title: id, beat: `${id} happens`, purpose: 'Story', duration_ms: 3000,
	image_prompt: 'still', video_prompt: 'clip', status: 'draft'
});
const cards = [beat('a', 0), beat('b', 1), beat('c', 2), beat('d', 3)];
const link = (from: string, to: string): SpineLink => ({ from, to });
function spine(links: SpineLink[]) {
	const result = deriveSpine(cards, links);
	if (!result.ok) throw new Error(result.message);
	return { chain: result.chain.map((card) => card.card_id), off: result.offSpine.map((card) => card.card_id) };
}

describe('spine derivation', () => {
	test('a full chain from the seed is the story order', () => {
		expect(spine([link(SEED, 'c'), link('c', 'a'), link('a', 'd'), link('d', 'b')])).toEqual({ chain: ['c', 'a', 'd', 'b'], off: [] });
	});

	test('default links follow card order', () => {
		expect(spine(defaultLinks(cards))).toEqual({ chain: ['a', 'b', 'c', 'd'], off: [] });
	});

	test('a broken chain stops at the break; the rest is off the spine', () => {
		expect(spine([link(SEED, 'a'), link('a', 'b'), link('c', 'd')])).toEqual({ chain: ['a', 'b'], off: ['c', 'd'] });
	});

	test('no link from the seed means nothing is on the spine', () => {
		expect(spine([link('a', 'b')])).toEqual({ chain: [], off: ['a', 'b', 'c', 'd'] });
	});

	test('orphan beats with no links keep their old order, off the spine', () => {
		expect(spine([link(SEED, 'd'), link('d', 'b')])).toEqual({ chain: ['d', 'b'], off: ['a', 'c'] });
	});

	test('cycles are rejected, on or off the chain', () => {
		expect(deriveSpine(cards, [link(SEED, 'a'), link('a', 'b'), link('b', 'c'), link('c', 'a')]).ok).toBeFalse();
		expect(deriveSpine(cards, [link(SEED, 'a'), link('c', 'd'), link('d', 'c')]).ok).toBeFalse();
	});

	test('two links out of, or into, one beat are rejected, as are self and unknown links', () => {
		expect(deriveSpine(cards, [link(SEED, 'a'), link('a', 'b'), link('a', 'c')]).ok).toBeFalse();
		expect(deriveSpine(cards, [link(SEED, 'a'), link('a', 'c'), link('b', 'c')]).ok).toBeFalse();
		expect(deriveSpine(cards, [link(SEED, 'a'), link('a', 'a')]).ok).toBeFalse();
		expect(deriveSpine(cards, [link(SEED, 'zz')]).ok).toBeFalse();
	});

	test('connect replaces whatever either end was hooked to; disconnect unhooks one link', () => {
		const start = defaultLinks(cards); // seed→a→b→c→d
		const moved = connect(disconnect(start, 'c', 'd'), 'a', 'd'); // a now leads to d; b loses its way in
		expect(spine(moved)).toEqual({ chain: ['a', 'd'], off: ['b', 'c'] });
		expect(spine(connect(moved, 'd', 'b'))).toEqual({ chain: ['a', 'd', 'b', 'c'], off: [] });
	});
});
