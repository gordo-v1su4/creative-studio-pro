import { expect, test } from 'bun:test';
import { auditioned, itemSeconds, nudged, placed, selectionEntries, selectionSummary, synced, toggled, type SelectionItem } from '../../src/lib/domain/selection';
import type { Project } from '../../src/lib/domain/schemas';

const item = (id: string, assetId = `${id}-pick`): SelectionItem => ({ id, title: id.toUpperCase(), src: `/${assetId}.mp4`, assetId });
const ids = (items: SelectionItem[]) => items.map((entry) => entry.id).join('');

test('a shot is added at the end and taken out when it is already in', () => {
	const one = toggled([], item('a'));
	expect(ids(toggled(one, item('b')))).toBe('ab');
	expect(ids(toggled(toggled(one, item('b')), item('a')))).toBe('b');
});

test('placing a shot adds it there, or moves it there when it is already in', () => {
	const abc = [item('a'), item('b'), item('c')];
	expect(ids(placed(abc, item('d'), 1))).toBe('adbc');
	expect(ids(placed(abc, item('a'), 3))).toBe('bca');
	expect(ids(placed(abc, item('c'), 0))).toBe('cab');
	expect(ids(placed(abc, item('a'), 1))).toBe('abc');
	expect(ids(placed(abc, item('d'), 99))).toBe('abcd');
});

test('a moved entry keeps the take auditioned on it', () => {
	const list = auditioned([item('a'), item('b')], 'a', { assetId: 'a-2', src: '/a-2.mp4' }, 'a-pick');
	expect(placed(list, item('a'), 2)[1]).toEqual({ id: 'a', title: 'A', src: '/a-2.mp4', assetId: 'a-2', auditioned: true });
});

test('nudging swaps neighbours and stops at the ends', () => {
	const abc = [item('a'), item('b'), item('c')];
	expect(ids(nudged(abc, 'a', 1))).toBe('bac');
	expect(ids(nudged(abc, 'c', -1))).toBe('acb');
	expect(nudged(abc, 'a', -1)).toBe(abc);
	expect(nudged(abc, 'c', 1)).toBe(abc);
});

test('auditioning swaps the take in place; going back to the pick ends the audition', () => {
	const list = auditioned([item('a'), item('b')], 'b', { assetId: 'b-2', src: '/b-2.mp4' }, 'b-pick');
	expect(list[1]).toEqual({ id: 'b', title: 'B', src: '/b-2.mp4', assetId: 'b-2', auditioned: true });
	expect(list[0]).toEqual(item('a'));
	expect(auditioned(list, 'b', { assetId: 'b-pick', src: '/b-pick.mp4' }, 'b-pick')[1]).toEqual(item('b'));
});

test('an entry follows its pick, but an auditioned take stays until it can no longer be used', () => {
	const list = [item('a')];
	expect(synced(list, 'a', item('a'))).toBe(list);
	expect(synced(list, 'a', item('a', 'a-new'))[0].assetId).toBe('a-new');
	expect(synced(list, 'a', null)).toEqual([]);
	const trying = auditioned(list, 'a', { assetId: 'a-2', src: '/a-2.mp4' }, 'a-pick');
	expect(synced(trying, 'a', item('a', 'a-new'))).toBe(trying);
	expect(synced(trying, 'a', item('a', 'a-new'), () => false)[0]).toEqual(item('a', 'a-new'));
	expect(synced(trying, 'a', null)).toEqual([]);
	expect(synced(list, 'zz', item('zz'))).toBe(list);
});

const project = {
	project_id: 'p',
	production: {
		cards: [{ card_id: 'a', title: 'A', beat: '', order: 0, duration_ms: 4000 }, { card_id: 'b', title: 'B', beat: '', order: 1, duration_ms: 2500 }, { card_id: 'c', title: 'C', beat: '', order: 2, duration_ms: 3000 }],
		assets: [
			{ asset_id: 'a-pick', card_id: 'a', kind: 'video', duration_s: 10, in_s: 2, out_s: 6 },
			{ asset_id: 'b-pick', card_id: 'b', kind: 'video', duration_s: 5, speed: [{ x: 0, rate: 2 }, { x: 1, rate: 2 }] },
			{ asset_id: 'c-pick', card_id: 'c', kind: 'video' }
		]
	}
} as unknown as Project;

test('an entry runs for its kept span as its ramp plays it; a missing shot for its planned length', () => {
	expect(itemSeconds(project, item('a'))).toBe(4);
	expect(itemSeconds(project, item('b'))).toBeCloseTo(2.5, 1);
	expect(itemSeconds(project, item('c'))).toBeNull();
	expect(itemSeconds(project, { id: 'b', title: 'B', src: '/slate', assetId: 'slate-b' })).toBe(2.5);
});

test('the summary counts the shots and adds the length only when every length is known', () => {
	expect(selectionSummary(project, [])).toBe('');
	expect(selectionSummary(project, [item('a')])).toBe('1 shot · 4s');
	expect(selectionSummary(project, [item('a'), item('b')])).toBe('2 shots · 6.5s');
	expect(selectionSummary(project, [item('a'), item('c')])).toBe('2 shots');
});

test('a push saves each shot, take, trim and ramp in order, and names a take whose length is not recorded', () => {
	const pushed = selectionEntries(project, [item('b'), item('a')]);
	expect(pushed).toEqual({ ok: true, entries: [
		{ card_id: 'b', asset_id: 'b-pick', in_s: 0, out_s: 5, speed: [{ x: 0, rate: 2 }, { x: 1, rate: 2 }] },
		{ card_id: 'a', asset_id: 'a-pick', in_s: 2, out_s: 6 }
	] });
	expect(selectionEntries(project, [item('a'), item('c')])).toEqual({ ok: false, unknown: ['C'] });
});

test('a length read from the file stands in for one that was never recorded', () => {
	const read = { 'c-pick': 7.5 };
	expect(itemSeconds(project, item('c'), read)).toBe(7.5);
	expect(selectionSummary(project, [item('a'), item('c')], read)).toBe('2 shots · 11.5s');
	expect(selectionEntries(project, [item('c')], read)).toEqual({ ok: true, entries: [{ card_id: 'c', asset_id: 'c-pick', in_s: 0, out_s: 7.5 }] });
	// A recorded trim still wins over the file's length.
	expect(itemSeconds(project, item('a'), { 'a-pick': 99 })).toBe(4);
});

test('what the strip pushes is accepted as a cut, auditioned take and all', async () => {
	const { applyPushCut, cutsOf } = await import('../../src/lib/domain/cuts');
	const production = { ...project.production, assets: [...project.production.assets, { asset_id: 'a-2', card_id: 'a', kind: 'video', duration_s: 3 }] } as unknown as Project['production'];
	const withTake = { ...project, production } as Project;
	const list = auditioned([item('b'), item('a')], 'a', { assetId: 'a-2', src: '/a-2.mp4' }, 'a-pick');
	const built = selectionEntries(withTake, list);
	if (!built.ok) throw new Error('expected entries');
	let n = 0;
	const result = applyPushCut(production, { cut_id: 'cut-1', name: 'Cut 1', entries: built.entries }, () => `e${++n}`, '2026-11-23T00:00:00Z');
	if (!result.ok) throw new Error(result.message);
	expect(cutsOf(result.production)[0].entries.map((entry) => [entry.card_id, entry.asset_id, entry.in_s, entry.out_s])).toEqual([['b', 'b-pick', 0, 5], ['a', 'a-2', 0, 3]]);
	// The pick was never written: the shot's card is unchanged.
	expect(result.production.cards).toEqual(production.cards);
});
