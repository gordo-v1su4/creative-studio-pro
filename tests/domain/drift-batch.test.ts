import { describe, expect, test } from 'bun:test';
import { batchAnswer, batchable } from '../../src/lib/domain/drift-batch';
import type { DriftItem } from '../../src/lib/domain/drift';

/**
 * Drift 10 (GitHub #38 / V1S-514; spec GitHub #28, story 40): one answer covers several drift items. "add all six",
 * "add the locations", or a press on a group, picks the items; a count that does not match picks nothing.
 */

const at = [{ project_id: 'p-tr110', project_title: 'TR110' }];
const item = (kind: DriftItem['kind'], name: string, over: Partial<DriftItem> = {}): DriftItem => ({
	key: `${kind}:${name.toLowerCase()}`, kind, type: 'only_in_prep', name, spellings: [name],
	found: { prep: at, review_room: null }, missing: ['notion', 'review_room'], link_to: null, choices: ['add_to_notion'], ...over
});
const items: DriftItem[] = [
	item('character', 'Malachi Jackson'), item('character', 'The Pledge'),
	item('location', 'Pool'), item('location', 'Campus gym'), item('location', 'Video Haven'),
	item('prop', 'Amber vials'),
	// Only in Review Room: it has no "add to Notion", so no batch picks it.
	item('character', 'Lucian Vale', { key: 'sheet:BLR_REF_CHR_LUCIAN_VALE', type: 'only_in_review_room', found: { prep: [], review_room: { asset_id: 'a1', code: 'BLR_REF_CHR_LUCIAN_VALE' } }, missing: ['notion'], choices: ['mark_old'] })
];
const keys = (text: string) => { const answer = batchAnswer(text, items); return answer?.ok ? answer.keys : answer; };

describe('one answer for several drift items', () => {
	test('"add all six" picks the six that can be added, in the order shown', () => {
		expect(keys('add all six')).toEqual(['character:malachi jackson', 'character:the pledge', 'location:pool', 'location:campus gym', 'location:video haven', 'prop:amber vials']);
		expect(keys('Add all 6 to Notion.')).toHaveLength(6);
		expect(keys('yes, add them all')).toHaveLength(6);
		expect(batchAnswer('add all', items)).toMatchObject({ ok: true, choice: 'add_to_notion' });
	});

	test('a kind narrows it: "add the locations", "add both characters", "add all three places"', () => {
		expect(keys('add the locations')).toEqual(['location:pool', 'location:campus gym', 'location:video haven']);
		expect(keys('add both characters')).toEqual(['character:malachi jackson', 'character:the pledge']);
		expect(keys('add all three places to notion')).toHaveLength(3);
		expect(keys('add the prop')).toEqual(['prop:amber vials']);
	});

	test('a count that does not match picks nothing and says how many there are', () => {
		const wrong = batchAnswer('add all sixteen', items);
		expect(wrong).toMatchObject({ ok: false });
		if (wrong && !wrong.ok) expect(wrong.message).toContain('6');
		expect(batchAnswer('add all four locations', items)).toMatchObject({ ok: false });
		expect(batchAnswer('add the sets', items.filter((one) => one.kind === 'prop'))).toBeNull();
	});

	test('nothing to add, or words that are not a batch answer, are not taken as one', () => {
		expect(batchAnswer('add all', items.filter((one) => one.type === 'only_in_review_room'))).toMatchObject({ ok: false });
		for (const text of ['what is out of step?', 'add Pool', 'add a scene for the pool', 'tell me about all six', 'add all the drama you can', 'add constructor', 'add all toString']) expect(batchAnswer(text, items)).toBeNull();
	});

	test('only items found in a Prep with "add to Notion" can be batched', () => {
		expect(batchable(items).map((one) => one.name)).not.toContain('Lucian Vale');
		expect(batchable([item('prop', 'Ghost', { found: { prep: [], review_room: null } })])).toEqual([]);
	});
});
