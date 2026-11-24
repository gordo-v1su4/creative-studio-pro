import { expect, test } from 'bun:test';
import { shotCardFacts } from '../../src/lib/domain/shot-card';

const card = (over: Record<string, unknown> = {}) => ({ card_id: 'c', order: 2, title: 'Mara on the floor', duration_ms: 5000, ...over });
const take = (id: string, over: Record<string, unknown> = {}) => ({ asset_id: id, card_id: 'c', kind: 'video' as const, name: `${id}.mp4`, ...over });

test('a shot with no take says so and shows no takes', () => {
	const facts = shotCardFacts(card(), [], null);
	expect(facts.status).toBe('missing');
	expect(facts.statusLabel).toBe('No take');
	expect(facts.takes).toEqual([]);
	expect(facts.takesLabel).toBe('');
	expect(facts.version).toBe('');
});

test('the number is the shot number when it has one, else its place in the order', () => {
	expect(shotCardFacts(card({ shot_number: 30 }), [], null).number).toBe('0030');
	expect(shotCardFacts(card(), [], null).number).toBe('03');
});

test('length reads in seconds, to one decimal at most', () => {
	expect(shotCardFacts(card({ duration_ms: 5000 }), [], null).length).toBe('5s');
	expect(shotCardFacts(card({ duration_ms: 625 }), [], null).length).toBe('0.6s');
	expect(shotCardFacts(card({ duration_ms: 20050 }), [], null).length).toBe('20.1s');
});

test('takes keep their order; the pick and excluded takes are marked; sound is not a take', () => {
	const assets = [
		take('a', { rejected: true, review_room: { version: 1 } }),
		take('b', { review_room: { version: 2 } }),
		take('s', { kind: 'audio' as const }),
		take('d')
	];
	const facts = shotCardFacts(card(), assets, 'b');
	expect(facts.takes.map((t) => [t.id, t.label, t.pick, t.excluded])).toEqual([
		['a', 'v001', false, true],
		['b', 'v002', true, false],
		['d', 'Take 3', false, false]
	]);
	expect(facts.takesLabel).toBe('3 takes');
	expect(facts.version).toBe('v002');
});

test('one take reads in the singular, and a pick not yet stored has no version', () => {
	const facts = shotCardFacts(card(), [take('a')], 'a');
	expect(facts.takesLabel).toBe('1 take');
	expect(facts.version).toBe('');
	expect(facts.statusLabel).toBe('Awaiting review');
});

test("the status label follows the shot's review status", () => {
	expect(shotCardFacts(card(), [take('a', { review_status: 'approved' })], 'a').statusLabel).toBe('Approved');
	expect(shotCardFacts(card(), [take('a', { review_status: 'needs_changes' })], 'a').statusLabel).toBe('Needs changes');
	expect(shotCardFacts(card(), [take('a', { review_status: 'in_progress' })], 'a').statusLabel).toBe('In progress');
});
