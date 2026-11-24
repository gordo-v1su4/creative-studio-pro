import { expect, test } from 'bun:test';
import { dropLabel, dropMeaning, type DropContext } from '../../src/lib/domain/drops';
import { applyMoveBeats, nextGroupName } from '../../src/lib/domain/groups';
import type { ProductionState } from '../../src/lib/domain/schemas';

const context: DropContext = {
	groupOf: (cardId) => ({ a: 'main', b: 'scene-1', c: 'scene-1', 'still-only': 'main' } as Record<string, string>)[cardId] ?? null,
	playable: (cardId) => cardId !== 'still-only'
};

test('a clip dropped on a shot is a new take of that shot', () => {
	expect(dropMeaning({ kind: 'files' }, { kind: 'shot', cardId: 'a' }, context)).toEqual({ kind: 'new-take', cardId: 'a' });
	expect(dropMeaning({ kind: 'files', media: ['video', 'image'] }, { kind: 'shot', cardId: 'a' }, context)).toEqual({ kind: 'new-take', cardId: 'a' });
});

test('files dropped on open space or on a scene are new shots there', () => {
	expect(dropMeaning({ kind: 'files' }, { kind: 'space', groupId: 'scene-1' }, context)).toEqual({ kind: 'new-shots', groupId: 'scene-1' });
	expect(dropMeaning({ kind: 'files' }, { kind: 'group', groupId: 'scene-2' }, context)).toEqual({ kind: 'new-shots', groupId: 'scene-2' });
});

test('files that are neither pictures nor video mean nothing anywhere', () => {
	for (const target of [{ kind: 'shot' as const, cardId: 'a' }, { kind: 'space' as const, groupId: 'main' }, { kind: 'group' as const, groupId: 'main' }]) {
		expect(dropMeaning({ kind: 'files', media: ['other', 'other'] }, target, context).kind).toBe('nothing');
	}
});

test('a shot dropped on a scene moves there; shots already in it stay put', () => {
	expect(dropMeaning({ kind: 'shots', cardIds: ['a'] }, { kind: 'group', groupId: 'scene-1' }, context)).toEqual({ kind: 'move', groupId: 'scene-1', cardIds: ['a'] });
	expect(dropMeaning({ kind: 'shots', cardIds: ['a', 'b'] }, { kind: 'group', groupId: 'scene-1' }, context)).toEqual({ kind: 'move', groupId: 'scene-1', cardIds: ['a'] });
	expect(dropMeaning({ kind: 'shots', cardIds: ['b', 'c'] }, { kind: 'group', groupId: 'scene-1' }, context)).toEqual({ kind: 'nothing', why: 'Already in this scene' });
});

test('a shot dropped on the selection joins it at that place, if it can play', () => {
	expect(dropMeaning({ kind: 'shots', cardIds: ['a'] }, { kind: 'selection', at: 2 }, context)).toEqual({ kind: 'select', cardIds: ['a'], at: 2 });
	expect(dropMeaning({ kind: 'shots', cardIds: ['still-only'] }, { kind: 'selection', at: 0 }, context)).toEqual({ kind: 'nothing', why: 'A still pick does not play in a selection' });
	expect(dropMeaning({ kind: 'shots', cardIds: ['a', 'still-only'] }, { kind: 'selection', at: 0 }, context)).toEqual({ kind: 'select', cardIds: ['a'], at: 0 });
});

test('a picture dropped on a reference is a source image; anything else there means nothing', () => {
	expect(dropMeaning({ kind: 'files', media: ['image'] }, { kind: 'reference', referenceId: 'kai' }, context)).toEqual({ kind: 'source-image', referenceId: 'kai' });
	expect(dropMeaning({ kind: 'files' }, { kind: 'reference', referenceId: 'kai' }, context)).toEqual({ kind: 'source-image', referenceId: 'kai' });
	expect(dropMeaning({ kind: 'files', media: ['video'] }, { kind: 'reference', referenceId: 'kai' }, context)).toEqual({ kind: 'nothing', why: 'A reference takes pictures, not video' });
	expect(dropMeaning({ kind: 'shots', cardIds: ['a'] }, { kind: 'reference', referenceId: 'kai' }, context).kind).toBe('nothing');
});

test('a shot that is not on this project is nothing to drop', () => {
	expect(dropMeaning({ kind: 'shots', cardIds: ['gone'] }, { kind: 'group', groupId: 'scene-1' }, context)).toEqual({ kind: 'nothing', why: 'Nothing to drop' });
});

test('a shot dropped on a shot or on open space means nothing (order is not changed by dropping)', () => {
	expect(dropMeaning({ kind: 'shots', cardIds: ['a'] }, { kind: 'shot', cardId: 'b' }, context).kind).toBe('nothing');
	expect(dropMeaning({ kind: 'shots', cardIds: ['a'] }, { kind: 'space', groupId: 'main' }, context).kind).toBe('nothing');
});

test('each meaning has a line saying what the drop will do', () => {
	expect(dropLabel({ kind: 'new-take', cardId: 'a' }, { shot: 'Kai drinks' })).toBe('Drop to add as a take of Kai drinks');
	expect(dropLabel({ kind: 'new-shots', groupId: 'g' }, { group: 'Scene 010' })).toBe('Drop to add as shots in Scene 010');
	expect(dropLabel({ kind: 'move', groupId: 'g', cardIds: ['a', 'b'] }, { group: 'Scene 010' })).toBe('Drop to move 2 shots to Scene 010');
	expect(dropLabel({ kind: 'nothing', why: 'Already in this scene' }, {})).toBe('Already in this scene');
});

const production = {
	cards: [{ card_id: 'a', order: 0, shot_number: 30 }, { card_id: 'b', order: 1, shot_number: 40, group_id: 'g1' }],
	assets: [], groups: [{ group_id: 'g1', name: 'Group 1', created_at: '2026-11-23T00:00:00Z' }, { group_id: 'g2', name: 'Scene 020', created_at: '2026-11-23T00:00:00Z' }]
} as unknown as ProductionState;

test('a moved shot keeps its number and everything else about it', () => {
	const moved = applyMoveBeats(production, ['a'], 'g2');
	if (!moved.ok) throw new Error(moved.message);
	expect(moved.production.cards[0]).toEqual({ ...production.cards[0], group_id: 'g2' });
	expect(moved.production.cards[1]).toEqual(production.cards[1]);
});

test('a group made with G is named Group N, the first N not taken', () => {
	expect(nextGroupName(production)).toBe('Group 3');
	expect(nextGroupName({ ...production, groups: [] })).toBe('Group 1');
	expect(nextGroupName({ ...production, groups: [...production.groups!, { group_id: 'g3', name: 'group 3', created_at: '2026-11-23T00:00:00Z' }] })).toBe('Group 4');
});
