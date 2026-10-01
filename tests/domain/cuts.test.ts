import { describe, expect, test } from 'bun:test';
import { applyEditCut, applyPushCut, applyRenameCut, cutLength, cutsOf, keepStoredCuts, nextCutName, type CutEntryInput } from '../../src/lib/domain/cuts';
import type { ProductionAsset, ProductionState, StoryCard } from '../../src/lib/domain/schemas';

const NOW = '2026-10-01T08:00:00.000Z';
const beat = (id: string, order: number): StoryCard => ({
	card_id: id, order, title: id, beat: `${id} happens`, purpose: 'Story', duration_ms: 3000,
	image_prompt: 'still', video_prompt: 'clip', status: 'draft'
});
const take = (id: string, cardId: string, extra: Partial<ProductionAsset> = {}): ProductionAsset => ({
	asset_id: id, card_id: cardId, kind: 'video', name: id, mime_type: 'video/mp4', url: `/files/${id}`, created_at: NOW, ...extra
});
const production: ProductionState = {
	status: 'draft', title: 'T', logline: '', premise: '', theme: '', updated_at: null,
	cards: [beat('a', 0), beat('b', 1)],
	assets: [take('a1', 'a', { in_s: 1, out_s: 4, speed: [{ x: 0, rate: 1 }, { x: 1, rate: 2 }] }), take('a2', 'a'), take('b1', 'b')]
};
const entries: CutEntryInput[] = [
	{ card_id: 'b', asset_id: 'b1', in_s: 0, out_s: 2 },
	{ card_id: 'a', asset_id: 'a1', in_s: 1, out_s: 4, speed: [{ x: 0, rate: 1 }, { x: 1, rate: 2 }] }
];

let counter = 0;
const newId = () => `e${++counter}`;
function push(from = production, input = entries) {
	const result = applyPushCut(from, { cut_id: 'cut-1', name: ' Trailer ', entries: input }, newId, NOW);
	if (!result.ok) throw new Error(result.message);
	return result.production;
}

describe('cut snapshot semantics', () => {
	test('push keeps the selection order, takes, trims and ramps as a new unlocked cut at version 1', () => {
		const cut = cutsOf(push())[0];
		expect(cut).toMatchObject({ cut_id: 'cut-1', name: 'Trailer', version: 1, locked: false, created_at: NOW });
		expect(cut.entries.map((e) => [e.card_id, e.asset_id, e.in_s, e.out_s])).toEqual([['b', 'b1', 0, 2], ['a', 'a1', 1, 4]]);
		expect(cut.entries[1].speed).toEqual([{ x: 0, rate: 1 }, { x: 1, rate: 2 }]);
		expect(new Set(cut.entries.map((e) => e.entry_id)).size).toBe(2);
	});

	test('push never touches takes or beats', () => {
		const pushed = push();
		expect(pushed.assets).toEqual(production.assets);
		expect(pushed.cards).toEqual(production.cards);
	});

	test('the cut owns copies: changing the source ramp or the take afterwards leaves it unchanged', () => {
		const input = structuredClone(entries);
		const pushed = push(production, input);
		input[1].speed![1].rate = 4;
		input[1].in_s = 3;
		const retrimmed = { ...pushed, assets: pushed.assets.map((a) => (a.asset_id === 'a1' ? { ...a, in_s: 0, out_s: 1, speed: undefined } : a)) };
		const cut = cutsOf(retrimmed)[0];
		expect(cut.entries[1]).toMatchObject({ in_s: 1, out_s: 4, speed: [{ x: 0, rate: 1 }, { x: 1, rate: 2 }] });
	});

	test('editing a cut changes only that cut: order, trims, ramps, dropped entries', () => {
		const pushed = push();
		const [, a] = cutsOf(pushed)[0].entries;
		const result = applyEditCut(pushed, 'cut-1', [{ ...a, in_s: 2, speed: undefined }], '2026-10-01T09:00:00.000Z');
		if (!result.ok) throw new Error(result.message);
		const cut = cutsOf(result.production)[0];
		expect(cut.entries).toEqual([{ entry_id: a.entry_id, card_id: 'a', asset_id: 'a1', in_s: 2, out_s: 4 }]);
		expect(cut.updated_at).toBe('2026-10-01T09:00:00.000Z');
		expect(cut.version).toBe(1);
		expect(result.production.assets).toEqual(production.assets);
		expect(result.production.cards).toEqual(production.cards);
	});

	test('a whole-production save keeps the stored cuts', () => {
		const pushed = push();
		const saved = { ...production, cuts: [] };
		expect(keepStoredCuts(saved, pushed).cuts).toEqual(pushed.cuts!);
		expect(keepStoredCuts(saved, production)).not.toHaveProperty('cuts');
	});

	test('push and edit refuse foreign takes, backwards trims and empty cuts', () => {
		expect(applyPushCut(production, { cut_id: 'x', name: 'X', entries: [{ card_id: 'a', asset_id: 'b1', in_s: 0, out_s: 1 }] }, newId, NOW).ok).toBeFalse();
		expect(applyPushCut(production, { cut_id: 'x', name: 'X', entries: [{ card_id: 'a', asset_id: 'a1', in_s: 2, out_s: 1 }] }, newId, NOW).ok).toBeFalse();
		expect(applyPushCut(production, { cut_id: 'x', name: 'X', entries: [] }, newId, NOW).ok).toBeFalse();
		const pushed = push();
		const [first] = cutsOf(pushed)[0].entries;
		expect(applyEditCut(pushed, 'cut-1', [], NOW).ok).toBeFalse();
		expect(applyEditCut(pushed, 'cut-1', [first, first], NOW).ok).toBeFalse();
		expect(applyEditCut(pushed, 'cut-1', [{ ...first, asset_id: 'a1' }], NOW).ok).toBeFalse();
		expect(applyEditCut(pushed, 'nope', [first], NOW).ok).toBeFalse();
	});

	test('an entry kept as pushed stays editable after its take is gone', () => {
		const pushed = push();
		const gone = { ...pushed, assets: pushed.assets.filter((a) => a.asset_id !== 'b1') };
		const [b] = cutsOf(gone)[0].entries;
		expect(applyEditCut(gone, 'cut-1', [{ ...b, out_s: 1.5 }], NOW).ok).toBeTrue();
	});

	test('a locked cut refuses edits', () => {
		const pushed = push();
		const locked = { ...pushed, cuts: cutsOf(pushed).map((cut) => ({ ...cut, locked: true })) };
		expect(applyEditCut(locked, 'cut-1', cutsOf(locked)[0].entries, NOW).ok).toBeFalse();
	});

	test('rename, default names and running length', () => {
		const pushed = push();
		const renamed = applyRenameCut(pushed, 'cut-1', 'Promo', NOW);
		expect(renamed.ok && cutsOf(renamed.production)[0].name).toBe('Promo');
		expect(nextCutName(production)).toBe('Cut 1');
		expect(nextCutName({ ...pushed, cuts: cutsOf(pushed).map((cut) => ({ ...cut, name: 'Cut 2' })) })).toBe('Cut 3');
		// 2s at 1x, plus 3s ramped from 1x to 2x (between 1.5s and 3s).
		const length = cutLength(cutsOf(pushed)[0]);
		expect(length).toBeGreaterThan(2 + 1.5);
		expect(length).toBeLessThan(2 + 3);
	});
});
