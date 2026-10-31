import { describe, expect, test } from 'bun:test';
import { barLoudness, cutPoints, planCut, samePlace, sectionDrive, sectionsFromBars, shotEnergies, shotsForAssembly, type AssemblyShot, type Section } from '../../src/lib/domain/assemble';
import { applySetTakeTags, motionOf, wordsFromCaption, type ShotTags } from '../../src/lib/domain/shot-tags';
import type { ProductionAsset, ProductionState, StoryCard } from '../../src/lib/domain/schemas';

const card = (id: string, order: number, extra: Partial<StoryCard> = {}): StoryCard => ({
	card_id: id, order, title: id, beat: `${id} happens`, purpose: 'Story', duration_ms: 5000, image_prompt: 'still', video_prompt: 'clip', status: 'draft', ...extra
});
const take = (id: string, cardId: string, extra: Partial<ProductionAsset> = {}): ProductionAsset => ({
	asset_id: id, card_id: cardId, kind: 'video', name: id, mime_type: 'video/mp4', url: `/files/${id}`, created_at: '2026-10-01T07:00:00.000Z', ...extra
});
const production = (cards: StoryCard[], assets: ProductionAsset[]): ProductionState => ({ status: 'draft', title: '', logline: '', premise: '', theme: '', cards, assets, updated_at: null });
const tags = (extra: Partial<ShotTags> = {}): ShotTags => ({ caption: 'a shot', place: '', time_of_day: '', subjects: [], action: '', shot_size: '', lighting: '', title_card: false, motion: 0.01, cuts: 0, source: 'operator', at: '2026-10-31T00:00:00Z', ...extra });
const shot = (n: number, max_s: number, extra: Partial<AssemblyShot> = {}): AssemblyShot => ({ n, card_id: `c${n}`, asset_id: `t${n}`, kind: 'video', title: `S${n}`, beat: '', in_s: 0, max_s, ...extra });
// 120 BPM: a beat every half second for 20 seconds; quiet first half, loud second half.
const music = { duration_s: 20, bpm: 120, beats: Array.from({ length: 39 }, (_, i) => (i + 1) * 0.5) };
const quietLoud: Section[] = [{ start: 0, end: 10, label: 'intro', energy: 0.2 }, { start: 10, end: 20, label: 'chorus', energy: 0.9 }];

describe('shots for the first cut', () => {
	test('spine in story order, then shots off it; benched shots and shots with no pick left out; trims and tags carried', () => {
		const shots = shotsForAssembly({ ...production(
			[card('a', 0), card('b', 1, { beat: 'Dropped in: hf.mp4' }), card('c', 2), card('d', 3), card('e', 4, { benched: true })],
			[take('a1', 'a', { in_s: 1, out_s: 4, tags: tags({ place: 'roof' }) }), take('b1', 'b', { duration_s: 8, generation: { provider: 'higgsfield', model: 'Seedance 2.5', resolution: '720p', prompt: 'A neon alley at night' } }), take('c1', 'c', { kind: 'image', mime_type: 'image/png' }), take('e1', 'e')]
		), links: [{ from: 'seed', to: 'a' }, { from: 'a', to: 'c' }] });
		expect(shots.map((s) => [s.n, s.card_id, s.kind, s.in_s, s.max_s])).toEqual([[1, 'a', 'video', 1, 3], [2, 'c', 'image', 0, 8], [3, 'b', 'video', 0, 8]]);
		expect(shots[0].tags?.place).toBe('roof');
		expect(shots[2].beat).toBe('A neon alley at night');
	});

	test('cut points are 0, the beats and the end; no beat grid falls back to every half second', () => {
		expect(cutPoints({ duration_s: 2, beats: [0.5, 1, 1.5] })).toEqual([0, 0.5, 1, 1.5, 2]);
		expect(cutPoints({ duration_s: 2, beats: [] })).toEqual([0, 0.5, 1, 1.5, 2]);
	});
});

describe('planning the first cut', () => {
	const pool = [shot(1, 10, { tags: tags({ motion: 0.002, place: 'video store' }) }), shot(2, 10, { tags: tags({ motion: 0.004, place: 'campus lawn' }) }), shot(3, 10, { tags: tags({ motion: 0.03, place: 'rooftop' }) }), shot(4, 10, { tags: tags({ motion: 0.05, place: 'street' }) })];

	test('the same shots and score always give the same cut, every cut on a beat, the whole score covered', () => {
		const first = planCut(pool, music, quietLoud);
		expect(planCut(pool, music, quietLoud)).toEqual(first);
		expect(first.covered_s).toBe(20);
		let t = 0;
		for (const entry of first.entries) {
			t += entry.out_s - entry.in_s;
			expect(cutPoints(music).some((p) => Math.abs(p - t) < 1e-6)).toBeTrue();
		}
	});

	test('calm shots hold long in the quiet section, moving shots cut fast in the loud one', () => {
		const { entries } = planCut(pool, music, quietLoud);
		const firstLength = entries[0].out_s - entries[0].in_s;
		expect(['c1', 'c2']).toContain(entries[0].card_id);
		expect(firstLength).toBeCloseTo(3.5, 3);
		let t = 0;
		const loud = entries.filter((entry) => { const start = t; t += entry.out_s - entry.in_s; return start >= 10; });
		expect(Math.max(...loud.map((entry) => entry.out_s - entry.in_s))).toBeLessThanOrEqual(1.5);
	});

	test('every shot once before any twice; a second use continues further into its footage', () => {
		const { entries, notes } = planCut(pool, music, quietLoud);
		const firstUses = entries.slice(0, 4).map((entry) => entry.card_id);
		expect(new Set(firstUses).size).toBe(4);
		const again = entries.findIndex((entry, i) => i >= 4);
		const before = entries.slice(0, again).filter((entry) => entry.card_id === entries[again].card_id).at(-1)!;
		expect(entries[again].in_s).toBeCloseTo(before.out_s, 3);
		expect(entries.every((entry, i) => i === 0 || entry.card_id !== entries[i - 1].card_id)).toBeTrue();
		expect(notes.some((note) => note.includes('used again'))).toBeTrue();
	});

	test('the title card is the end tag after the music; pre-cut sequences are left out', () => {
		const withTitle = [...pool, shot(5, 8, { title: 'Title', tags: tags({ title_card: true, cuts: 4 }) }), shot(7, 8, { kind: 'image', title: 'A still' }), shot(6, 20, { title: 'Old trailer', tags: tags({ cuts: 12 }) })];
		const { entries, notes, covered_s } = planCut(withTitle, music, quietLoud);
		expect(covered_s).toBe(20);
		expect(entries.at(-1)).toEqual({ card_id: 'c5', asset_id: 't5', in_s: 0, out_s: 3 });
		expect(entries.some((entry) => entry.card_id === 'c6')).toBeFalse();
		expect(notes).toContain('Left out Old trailer: already an edit (cuts inside)');
		expect(notes).toContain('Ends on Title after the music');
		expect(entries.some((entry) => entry.card_id === 'c7')).toBeFalse();
		expect(notes).toContain('1 still left out (the cut player plays video; animate them to use them)');
	});

	test('footage too short for a long hold goes where the cut runs fast', () => {
		const shots = [shot(1, 0.5, { tags: tags({ motion: 0.001 }) }), shot(2, 10, { tags: tags({ motion: 0.002 }) }), shot(3, 10, { tags: tags({ motion: 0.05 }) })];
		const { entries } = planCut(shots, music, quietLoud);
		expect(entries[0].card_id).toBe('c2');
	});

	test('section drive: half the label, half the loudness rank; one quiet sliver cannot flatten the rest', () => {
		expect(sectionDrive([{ start: 0, end: 2, label: 'intro', energy: 0.075 }, { start: 2, end: 17, label: 'intro', energy: 0.421 }, { start: 17, end: 32, label: 'verse', energy: 0.415 }, { start: 32, end: 78, label: 'chorus', energy: 0.389 }, { start: 78, end: 86, label: 'chorus', energy: 0.449 }]))
			.toEqual([0.075, 0.45, 0.475, 0.55, 0.925]);
		expect(sectionDrive([{ start: 0, end: 8, label: 'bars', energy: 0.2 }, { start: 8, end: 16, label: 'bars', energy: 0.9 }])).toEqual([0, 1]);
	});

	test('the same place twice in a row is avoided when another shot fits as well', () => {
		const twins = [shot(1, 10, { tags: tags({ motion: 0.01, place: 'Video Haven store interior' }) }), shot(2, 10, { tags: tags({ motion: 0.01, place: 'interior of the Video Haven store' }) }), shot(3, 10, { tags: tags({ motion: 0.01, place: 'rooftop' }) })];
		const { entries } = planCut(twins, { duration_s: 6, bpm: 120, beats: Array.from({ length: 11 }, (_, i) => (i + 1) * 0.5) }, [{ start: 0, end: 6, label: 'verse', energy: 0.5 }]);
		// Equal motion ranks by story order, so S2 fits the section best; S1 is the same store, so the rooftop follows.
		expect(entries.slice(0, 2).map((entry) => entry.card_id)).toEqual(['c2', 'c3']);
	});

	test('untagged shots are noted; no title card means no end tag', () => {
		const { notes } = planCut([shot(1, 30)], music, quietLoud);
		expect(notes).toContain('1 untagged shot placed by order only; tag them for a better cut');
		expect(notes).toContain('No title card tagged, so no end tag');
	});
});

describe('shot tags', () => {
	test('motion is the mean calm frame change in the span; big jumps count as cuts', () => {
		const signal = { fps: 10, diffs: [0.01, 0.01, 0.5, 0.03, 0.03, 0.4, 0.02, 0.02, 0.02, 0.02] };
		expect(motionOf(signal)).toEqual({ motion: 0.02, cuts: 2 });
		expect(motionOf(signal, 0.6, 1)).toEqual({ motion: 0.02, cuts: 0 });
	});

	test('caption JSON (gateway keys) becomes tag words', () => {
		expect(wordsFromCaption({ caption: 'Malik catches the blade.', setting: 'fire escape', timeOfDay: 'Night', subjects: 'Malik and Rowan', shotType: 'Close-up', titleCard: 'false' }))
			.toEqual({ caption: 'Malik catches the blade.', place: 'fire escape', time_of_day: 'night', subjects: ['Malik', 'Rowan'], action: '', shot_size: 'close-up', lighting: '', title_card: false });
		expect(wordsFromCaption({ caption: 'BLOOD RUSH', titleCard: true }).title_card).toBeTrue();
		expect(wordsFromCaption({ caption: "The word 'BLOODRUSH' is displayed in a metallic font." }).title_card).toBeTrue();
		expect(wordsFromCaption({ caption: 'A man runs across a rooftop.' }).title_card).toBeFalse();
	});

	test('tags go on one take and can be cleared', () => {
		const p = production([card('a', 0)], [take('a1', 'a'), take('a2', 'a')]);
		const tagged = applySetTakeTags(p, 'a2', tags());
		if (!tagged.ok) throw new Error(tagged.message);
		expect(tagged.production.assets.map((a) => !!a.tags)).toEqual([false, true]);
		const cleared = applySetTakeTags(tagged.production, 'a2', null);
		expect(cleared.ok && cleared.production.assets[1].tags).toBeUndefined();
		expect(applySetTakeTags(p, 'nope', tags()).ok).toBeFalse();
	});

	test('places match by shared words; energies rank by motion, stills calm', () => {
		expect(samePlace('Video Haven store interior', 'interior of the Video Haven store')).toBeTrue();
		expect(samePlace('rooftop at night', 'Video Haven store')).toBeFalse();
		const energy = shotEnergies([shot(1, 5, { tags: tags({ motion: 0.05 }) }), shot(2, 5, { tags: tags({ motion: 0.01 }) }), shot(3, 5, { kind: 'image' }), shot(4, 5)]);
		expect([...energy.entries()]).toEqual([[2, 0], [1, 1], [3, 0.15], [4, 0.5]]);
	});

	test('bar loudness and eight-bar sections', () => {
		const rate = 100;
		const samples = new Float32Array(20 * rate);
		samples.fill(0.8, 16 * rate, 20 * rate);
		const bars = barLoudness(samples, rate, music);
		expect(bars.map((bar) => bar.level)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 9, 9]);
		expect(sectionsFromBars(bars, 20)).toEqual([{ start: 0, end: 16, label: 'bars', energy: 0 }, { start: 16, end: 20, label: 'bars', energy: 1 }]);
	});
});
