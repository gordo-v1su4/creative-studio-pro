import { describe, expect, test } from 'bun:test';
import { episodeOutline } from '../../src/lib/domain/episode-outline';
import { effectiveLinks, fitDurations, fitPlan, fittedCards, insertIntoGroup, parseFitShots, removeFitted, type FittedShot } from '../../src/lib/domain/episode-fit';
import { deriveSpine } from '../../src/lib/domain/spine';
import type { ProductionState, StoryCard } from '../../src/lib/domain/schemas';

const id = (n: number) => `01a0fda5-0000-7000-8000-${String(n).padStart(12, '0')}`;
const G1 = id(901), G2 = id(902);
const card = (n: number, group: string, title: string, seconds: number): StoryCard => ({
	card_id: id(n), order: n, title, beat: `beat ${n}`, purpose: 'p', duration_ms: seconds * 1000, image_prompt: 'i', video_prompt: 'v', status: 'draft', group_id: group
});
const production = (cards: StoryCard[], links?: ProductionState['links']): ProductionState => ({
	status: 'draft', title: '', logline: '', premise: '', theme: '', cards, assets: [], updated_at: null, ...(links ? { links } : {})
});
const series = {
	episode_number: 1, episode_title: 'EP01',
	scenes: [
		{ page_id: 's1', number: 1, title: 'P01 — Teaser', act: 'Teaser', summary: '', story_beats: '', timecode: '0:00–1:00 (Teaser)', location: '', characters: [], group_id: G1, seconds: 40, shot_count: 2 },
		{ page_id: 's2', number: 2, title: 'P02 — Morning Quad', act: 'Act 1', summary: '', story_beats: '', timecode: 'Act 1 · ~1:00', location: '', characters: [], group_id: G2, seconds: 17, shot_count: 1 }
	]
};
const cards = [card(0, G1, 'P01.01', 20), card(1, G1, 'P01.02', 20), card(2, G2, 'P02.01', 17)];
const shot = (seconds: number, extra: Partial<FittedShot> = {}): FittedShot => ({
	description: 'Kai crosses the quad.', duration_s: seconds, video_prompt: 'No image: Kai — a freshman.\nKai crosses the quad. Cut to Kai waving.', image_prompt: '', dialogue: '', audio: 'Birds.', refs: '', characters: ['Kai'], lint: { rounds: 1, fixed: 2, remaining: 0 }, ...extra
});

describe('fit to length', () => {
	test('plans the short scenes with the time and shot count each needs', () => {
		// 2 min episode: the teaser plans 1:00 and has 0:40; the quad plans 1:00 and has 0:17.
		const plan = fitPlan(episodeOutline(series, cards, 2));
		expect(plan).toEqual([
			{ page_id: 's1', group_id: G1, title: 'P01 — Teaser', gap_s: 20, shots_wanted: 3 },
			{ page_id: 's2', group_id: G2, title: 'P02 — Morning Quad', gap_s: 43, shots_wanted: 7 }
		]);
		expect(fitPlan(episodeOutline(series, cards, 2), ['s2']).map((s) => s.page_id)).toEqual(['s2']);
		// Already long enough: nothing to fill.
		expect(fitPlan(episodeOutline(series, cards, 0.5))).toEqual([]);
	});

	test('reads the Agent\'s shots and refuses an answer that is empty or far too long', () => {
		const scene = { page_id: 's2', group_id: G2, title: 'P02', gap_s: 12, shots_wanted: 2 };
		const shots = parseFitShots({ shots: [{ description: 'a', duration_s: 6, video_prompt: 'x' }] }, scene);
		expect(shots[0]).toMatchObject({ description: 'a', dialogue: '', characters: [] });
		expect(() => parseFitShots({ shots: [] }, scene)).toThrow();
		expect(() => parseFitShots({ shots: Array.from({ length: 5 }, () => ({ description: 'a', duration_s: 6, video_prompt: 'x' })) }, scene)).toThrow();
		expect(() => parseFitShots({ shots: [{ description: 'a', duration_s: 6 }] }, scene)).toThrow();
	});

	test('durations are whole seconds of 4–10 that add up to the gap when the limits allow', () => {
		expect(fitDurations([5, 5, 5], 18)).toEqual([6, 6, 6]);
		expect(fitDurations([3, 9], 13).reduce((a, b) => a + b)).toBe(13);
		expect(fitDurations([3, 9], 13).every((s) => s >= 4 && s <= 10)).toBeTrue();
		expect(fitDurations([6], 30)).toEqual([10]);
		expect(fitDurations([6, 6], 5)).toEqual([4, 4]);
	});

	test('new beats continue the scene\'s numbering and carry the fit marker and shot details', () => {
		let n = 100;
		const made = fittedCards({ page_id: 's2', group_id: G2, title: 'P02 — Morning Quad', gap_s: 12, shots_wanted: 2 }, [cards[2]], [shot(6), shot(6, { dialogue: '"Hey."' })], { newId: () => id(n++), now: '2026-10-02T00:00:00.000Z', target_min: 10, summary: 'Kai as campus celebrity.' });
		expect(made.map((c) => c.title)).toEqual(['P02.02', 'P02.03']);
		expect(made[0]).toMatchObject({ group_id: G2, duration_ms: 6000, purpose: 'Kai as campus celebrity.', fit: { target_min: 10, lint: { rounds: 1, fixed: 2, remaining: 0 }, audio: 'Birds.', characters: ['Kai'] } });
		expect(made[1].fit?.dialogue).toBe('"Hey."');
		expect(made[0].image_prompt).toBe('None yet (written by Fit).');
	});

	test('inserted right after the scene, in card order and on an explicit spine', () => {
		const added = [card(50, G1, 'P01.03', 6), card(51, G1, 'P01.04', 6)].map((c) => ({ ...c, fit: { target_min: 10, at: 'x', lint: { rounds: 0, fixed: 0, remaining: 0 } } }));
		const byOrder = insertIntoGroup(production(cards), G1, added);
		expect(byOrder.cards.map((c) => c.title)).toEqual(['P01.01', 'P01.02', 'P01.03', 'P01.04', 'P02.01']);
		expect(byOrder.links).toBeUndefined();

		const linked = production(cards, effectiveLinks(production(cards)));
		const spliced = insertIntoGroup(linked, G1, added);
		const spine = deriveSpine(spliced.cards, spliced.links!);
		expect(spine.ok && spine.chain.map((c) => c.title)).toEqual(['P01.01', 'P01.02', 'P01.03', 'P01.04', 'P02.01']);

		// Undo: gone again, the spine closes over the gap, and a fitted beat that has a take stays.
		const withTake = { ...spliced, assets: [{ asset_id: id(700), card_id: id(51), kind: 'video' as const, name: 't', mime_type: 'video/mp4', url: '/x' }] } as ProductionState;
		const undone = removeFitted(withTake);
		expect(undone).toMatchObject({ removed: 1, kept: 1 });
		const after = deriveSpine(undone.production.cards, undone.production.links!);
		expect(after.ok && after.chain.map((c) => c.title)).toEqual(['P01.01', 'P01.02', 'P01.04', 'P02.01']);
		expect(removeFitted(spliced, [G2]).removed).toBe(0);
	});
});
