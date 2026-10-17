import { describe, expect, test } from 'bun:test';
import { SAVE_THE_CAT, TV_EPISODE, emptySections, sectionRank, storyBeatColor } from '../../src/lib/domain/structures';

describe('structures', () => {
	test('Save the Cat has 15 sections, the TV episode 5', () => {
		expect(SAVE_THE_CAT.sections).toHaveLength(15);
		expect(TV_EPISODE.sections).toEqual(['Teaser', 'Act 1', 'Act 2', 'Act 3', 'Tag']);
	});

	test('sections sort in structure order, case-insensitive; unknown ones last', () => {
		const order = ['Finale', 'catalyst', 'Opening Image', 'Something else'].toSorted((a, b) => sectionRank(SAVE_THE_CAT, a) - sectionRank(SAVE_THE_CAT, b));
		expect(order).toEqual(['Opening Image', 'catalyst', 'Finale', 'Something else']);
	});

	test('the gap view lists sections no story beat fills, in order', () => {
		expect(emptySections(TV_EPISODE, ['Act 1', 'tag'])).toEqual(['Teaser', 'Act 2', 'Act 3']);
		expect(emptySections(SAVE_THE_CAT, SAVE_THE_CAT.sections)).toEqual([]);
	});

	test('story beat colours run teal to violet, never a rainbow', () => {
		expect(storyBeatColor(0, 15)).toBe('hsl(172 70% 62%)');
		expect(storyBeatColor(14, 15)).toBe('hsl(270 70% 62%)');
		expect(storyBeatColor(0, 1)).toBe('hsl(172 70% 62%)');
	});
});
