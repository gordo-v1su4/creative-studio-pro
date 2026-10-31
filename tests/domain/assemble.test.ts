import { describe, expect, test } from 'bun:test';
import { barLoudness, cutPoints, entriesFromPlan, shotsForAssembly, type AssemblyShot } from '../../src/lib/domain/assemble';
import type { ProductionAsset, ProductionState, StoryCard } from '../../src/lib/domain/schemas';

const card = (id: string, order: number, extra: Partial<StoryCard> = {}): StoryCard => ({
	card_id: id, order, title: id, beat: `${id} happens`, purpose: 'Story', duration_ms: 5000, image_prompt: 'still', video_prompt: 'clip', status: 'draft', ...extra
});
const take = (id: string, cardId: string, extra: Partial<ProductionAsset> = {}): ProductionAsset => ({
	asset_id: id, card_id: cardId, kind: 'video', name: id, mime_type: 'video/mp4', url: `/files/${id}`, created_at: '2026-10-01T07:00:00.000Z', ...extra
});
const production = (cards: StoryCard[], assets: ProductionAsset[]): ProductionState => ({ status: 'draft', title: '', logline: '', premise: '', theme: '', cards, assets, updated_at: null });
const shot = (n: number, max_s: number, extra: Partial<AssemblyShot> = {}): AssemblyShot => ({ n, card_id: `c${n}`, asset_id: `t${n}`, kind: 'video', title: `c${n}`, beat: '', in_s: 0, max_s, ...extra });
// 120 BPM: a beat every half second for 10 seconds.
const music = { duration_s: 10, beats: Array.from({ length: 19 }, (_, i) => (i + 1) * 0.5) };

describe('first cut to the score', () => {
	test('the shots on offer: spine in story order, then benched and dropped-in shots; trims respected; shots with no pick left out', () => {
		const shots = shotsForAssembly(production(
			[card('a', 0), card('b', 1, { benched: true, beat: 'Dropped in: hf.mp4' }), card('c', 2), card('d', 3)],
			[take('a1', 'a', { in_s: 1, out_s: 4 }), take('b1', 'b', { duration_s: 8, generation: { provider: 'higgsfield', model: 'Seedance 2.5', resolution: '720p', prompt: 'A neon alley at night' } }), take('c1', 'c', { kind: 'image', mime_type: 'image/png' })]
		));
		expect(shots.map((s) => [s.n, s.card_id, s.kind, s.in_s, s.max_s])).toEqual([[1, 'a', 'video', 1, 3], [2, 'c', 'image', 0, 8], [3, 'b', 'video', 0, 8]]);
		expect(shots[2].beat).toBe('A neon alley at night');
	});

	test('cut points are 0, the beats and the end; no beat grid falls back to every half second', () => {
		expect(cutPoints({ duration_s: 2, beats: [0.5, 1, 1.5] })).toEqual([0, 0.5, 1, 1.5, 2]);
		expect(cutPoints({ duration_s: 2, beats: [] })).toEqual([0, 0.5, 1, 1.5, 2]);
	});

	test('every cut lands on a beat, in the planned order, and the cut stops at the end of the score', () => {
		const { entries, notes } = entriesFromPlan([{ shot: 2, beats: 4 }, { shot: 1, beats: 8 }, { shot: 3, beats: 16 }, { shot: 4, beats: 2 }], [shot(1, 8), shot(2, 8, { in_s: 1.5 }), shot(3, 20), shot(4, 5)], music);
		expect(entries.map((e) => [e.card_id, e.in_s, e.out_s])).toEqual([['c2', 1.5, 3.5], ['c1', 0, 4], ['c3', 0, 4]]);
		expect(notes.some((note) => note.includes('left out'))).toBeTrue();
	});

	test('a shot whose footage runs out before its beats is cut at the last beat it reaches', () => {
		const { entries } = entriesFromPlan([{ shot: 1, beats: 8 }, { shot: 2, beats: 2 }], [shot(1, 1.3), shot(2, 8)], music);
		expect(entries.map((e) => e.out_s - e.in_s)).toEqual([1, 1]);
	});

	test('footage shorter than one beat holds as long as it runs, and the next cut snaps back onto the grid', () => {
		const { entries } = entriesFromPlan([{ shot: 1, beats: 1 }, { shot: 2, beats: 1 }], [shot(1, 0.45), shot(2, 8)], music);
		// The second shot runs to the 1.0s beat, so the cut is back on the grid.
		expect(entries.map((e) => e.out_s)).toEqual([0.45, 0.55]);
	});

	test('unknown and repeated shots are left out with a note; a short plan says how much of the score it covers', () => {
		const { entries, notes } = entriesFromPlan([{ shot: 9, beats: 2 }, { shot: 1, beats: 2 }, { shot: 1, beats: 2 }], [shot(1, 8)], music);
		expect(entries).toHaveLength(1);
		expect(notes).toEqual(['S9 is not a shot of this project; left out', 'S1 was placed twice; used once', 'The cut runs 1.0s of the 10.0s score']);
	});

	test('bar loudness is 0 to 9 against the loudest bar', () => {
		const rate = 100;
		const samples = new Float32Array(10 * rate);
		samples.fill(0.1, 0, 2 * rate);
		samples.fill(0.8, 6 * rate, 8 * rate);
		const bars = barLoudness(samples, rate, music);
		expect(bars.map((bar) => bar.at)).toEqual([0, 2, 4, 6, 8]);
		expect(bars.map((bar) => bar.level)).toEqual([1, 0, 0, 9, 0]);
	});
});
