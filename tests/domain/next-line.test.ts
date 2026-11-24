import { expect, test } from 'bun:test';
import { nextLine } from '../../src/lib/domain/next-line';

type Take = { card_id: string; kind: 'image' | 'video' | 'audio'; rejected?: boolean; review_status?: 'awaiting_review' | 'in_progress' | 'needs_changes' | 'approved' };
const project = (cards: Array<{ card_id: string; benched?: boolean }>, assets: Take[], reviewed = true) => ({ production: { cards, assets }, reviewed });

test('with no project the next thing is to start one', () => {
	expect(nextLine(null)).toBe('Start a project');
});

test('a project with no shots asks for the story', () => {
	expect(nextLine(project([], []))).toBe('Write the story, then the shot list');
});

test('shots with no take are counted; audio and excluded takes do not count as a take', () => {
	const line = nextLine(project(
		[{ card_id: 'a' }, { card_id: 'b' }, { card_id: 'c' }],
		[{ card_id: 'a', kind: 'video', review_status: 'approved' }, { card_id: 'b', kind: 'audio' }, { card_id: 'c', kind: 'video', rejected: true }]
	));
	expect(line).toBe('2 shots have no take');
});

test('a benched shot is not waiting for a take', () => {
	expect(nextLine(project([{ card_id: 'a', benched: true }], []))).toBe('Nothing is waiting');
});

test('needs changes comes before awaiting review, and one shot reads in the singular', () => {
	const line = nextLine(project(
		[{ card_id: 'a' }, { card_id: 'b' }, { card_id: 'c' }, { card_id: 'd' }],
		[
			{ card_id: 'a', kind: 'video', review_status: 'needs_changes' },
			{ card_id: 'b', kind: 'video' },
			{ card_id: 'c', kind: 'image', review_status: 'awaiting_review' },
			{ card_id: 'd', kind: 'video', review_status: 'approved' }
		]
	));
	expect(line).toBe('1 shot needs changes · 2 shots await review');
});

test('a project that is not reviewed in Review Room never says shots await review', () => {
	const line = nextLine(project([{ card_id: 'a' }], [{ card_id: 'a', kind: 'video' }], false));
	expect(line).toBe('Nothing is waiting');
});

test("a shot's status is the strongest of its takes' statuses", () => {
	const { shotStatus } = require('../../src/lib/domain/next-line');
	expect(shotStatus([])).toBe('missing');
	expect(shotStatus([{ card_id: 'a', kind: 'audio' }])).toBe('missing');
	expect(shotStatus([{ card_id: 'a', kind: 'video' }])).toBe('awaiting');
	expect(shotStatus([{ card_id: 'a', kind: 'video', review_status: 'in_progress' }])).toBe('progress');
	expect(shotStatus([{ card_id: 'a', kind: 'video', review_status: 'approved' }, { card_id: 'a', kind: 'video' }])).toBe('approved');
	expect(shotStatus([{ card_id: 'a', kind: 'video', review_status: 'approved' }, { card_id: 'a', kind: 'video', review_status: 'needs_changes' }])).toBe('changes');
});

test('while the story plan is being approved, its next step is the line', () => {
	expect(nextLine({ ...project([], []), story: 'Approve the scenes, then story beats' })).toBe('Approve the scenes, then story beats');
	expect(nextLine({ ...project([], []), story: null })).toBe('Write the story, then the shot list');
});
