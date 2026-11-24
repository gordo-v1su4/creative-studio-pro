import { expect, test } from 'bun:test';
import { mergeProduction } from '../../src/lib/domain/merge-production';
import type { ProductionState } from '../../src/lib/domain/schemas';

const production = (cards: Array<Record<string, unknown>>, assets: Array<Record<string, unknown>> = [], over: Record<string, unknown> = {}) =>
	({ status: 'drafted', title: 'T', logline: '', premise: '', theme: '', cards, assets, updated_at: null, ...over }) as unknown as ProductionState;
const card = (id: string, over: Record<string, unknown> = {}) => ({ card_id: id, order: 0, title: id, beat: 'beat', video_prompt: 'p', ...over });
const take = (id: string, over: Record<string, unknown> = {}) => ({ asset_id: id, card_id: 'a', kind: 'video', ...over });

test('with no unsaved edits, the incoming project is taken as it is', () => {
	const base = production([card('a')]);
	const next = production([card('a', { pick_take_id: 't2' })]);
	expect(mergeProduction(base, base, next)).toEqual(next);
});

test('an unsaved edit survives a change that arrives from Review Room on another shot', () => {
	const base = production([card('a'), card('b')], [take('t1', { card_id: 'b' })]);
	const draft = production([card('a', { beat: 'typed here' }), card('b')], [take('t1', { card_id: 'b' })]);
	const next = production([card('a'), card('b', { pick_take_id: 't1' })], [take('t1', { card_id: 'b', review_status: 'approved' })]);
	const merged = mergeProduction(base, draft, next);
	expect(merged.cards[0].beat).toBe('typed here');
	expect(merged.cards[1].pick_take_id).toBe('t1');
	expect(merged.assets[0].review_status).toBe('approved');
});

test('on the same shot, each field keeps whichever side changed it', () => {
	const base = production([card('a')]);
	const draft = production([card('a', { video_prompt: 'rewritten' })]);
	const next = production([card('a', { pick_take_id: 't2' })]);
	expect(mergeProduction(base, draft, next).cards[0]).toMatchObject({ video_prompt: 'rewritten', pick_take_id: 't2' });
});

test('when both sides changed the same field, the unsaved edit is kept: it is the later change once saved', () => {
	const base = production([card('a', { title: 'Old' })]);
	const draft = production([card('a', { title: 'Mine' })]);
	const next = production([card('a', { title: 'Theirs' })]);
	expect(mergeProduction(base, draft, next).cards[0].title).toBe('Mine');
});

test('takes that arrive are added, takes and shots removed elsewhere go, and the incoming order stands', () => {
	const base = production([card('a'), card('b')], [take('t1')]);
	const draft = production([card('a', { beat: 'typed' }), card('b')], [take('t1')]);
	const next = production([card('b'), card('a')], [take('t1', { rejected: true }), take('t2')]);
	const merged = mergeProduction(base, draft, next);
	expect(merged.cards.map((entry) => entry.card_id)).toEqual(['b', 'a']);
	expect(merged.cards[1].beat).toBe('typed');
	expect(merged.assets.map((asset) => [asset.asset_id, !!asset.rejected])).toEqual([['t1', true], ['t2', false]]);
	const gone = mergeProduction(base, draft, production([card('b')], []));
	expect(gone.cards.map((entry) => entry.card_id)).toEqual(['b']);
});

test('unsaved edits to the story line itself are kept, and what only the server holds comes from the server', () => {
	const base = production([card('a')], [], { logline: 'old', cuts: [{ cut_id: 'c1' }] });
	const draft = production([card('a')], [], { logline: 'new line', cuts: [{ cut_id: 'c1' }] });
	const next = production([card('a')], [], { logline: 'old', cuts: [{ cut_id: 'c1' }, { cut_id: 'c2' }], groups: [{ group_id: 'g' }] });
	const merged = mergeProduction(base, draft, next) as unknown as Record<string, unknown>;
	expect(merged.logline).toBe('new line');
	expect(merged.cuts).toEqual([{ cut_id: 'c1' }, { cut_id: 'c2' }]);
	expect(merged.groups).toEqual([{ group_id: 'g' }]);
});
