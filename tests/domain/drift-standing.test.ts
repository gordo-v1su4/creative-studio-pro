import { describe, expect, test } from 'bun:test';
import { prepStanding, type StandingInput, type StandingPrepEntry } from '../../src/lib/domain/drift-standing';

/**
 * Drift 09 (GitHub #37 / V1S-513, ADR 0012): where each of a project's Prep references stands. In Review Room when
 * its Notion reference has a sheet there, waiting for a picture when it is in Notion with no sheet yet, missing from
 * Notion otherwise. "Only in this project" counts what is missing from Notion, two spellings of one name once.
 */

const notion: StandingInput['notion'] = [
	{ page_id: 'rmara', name: 'Mara Voss', kind: 'Character' },
	{ page_id: 'rbryson', name: 'Bryson Vane', kind: 'Character' },
	{ page_id: 'rquad', name: 'College Quad', kind: 'Location' },
	{ page_id: 'rrush', name: 'The Rush', kind: 'Prop' }
];
const entry = (kind: StandingPrepEntry['kind'], name: string, reference_page_id: string | null = null): StandingPrepEntry => ({ key: `${kind}:${name}`, kind, name, reference_page_id });
const sheet = (code: string, folder_key: string) => ({ asset_id: `a-${code}`, code, folder_key, title: code });

describe('where each Prep reference stands', () => {
	const input: StandingInput = {
		show_code: 'BLR', notion,
		prep: [
			entry('character', 'Mara Voss', 'rmara'), entry('character', 'Bryson Vane', 'rbryson'), entry('location', 'College Quad'),
			entry('location', 'Video Haven'), entry('location', 'Campus Walkway'), entry('location', 'Campus walkway'), entry('prop', 'The Rush', 'rrush')
		],
		sheets: [sheet('BLR_REF_CHR_MARA_VOSS', 'refs:characters'), sheet('BLR_REF_CHR_BRYSON', 'refs:characters')],
		sent: ['rrush']
	};
	const { entries, only_here } = prepStanding(input);
	const of = (name: string) => entries.find((one) => one.name === name)?.standing;

	test('a Notion reference with its sheet in Review Room is in Review Room', () => expect(of('Mara Voss')).toBe('in_review_room'));
	test('a sheet under a different code does not count for it (Bryson is not Bryson Vane)', () => expect(of('Bryson Vane')).toBe('waiting_for_picture'));
	test('an entry with no page id but the same name as a Notion reference is that reference', () => expect(of('College Quad')).toBe('waiting_for_picture'));
	test('a reference the app has sent is in Review Room, even before the sheets are read', () => expect(of('The Rush')).toBe('in_review_room'));
	test('an entry with no Notion reference is missing from Notion', () => {
		expect(of('Video Haven')).toBe('missing_from_notion');
		expect(entries.filter((one) => one.name.startsWith('Campus')).map((one) => one.standing)).toEqual(['missing_from_notion', 'missing_from_notion']);
	});
	test('every entry is listed by its Prep key, in order', () => expect(entries.map((one) => one.key)).toEqual(input.prep.map((one) => one.key)));
	test('"only in this project" counts two spellings once', () => expect(only_here).toBe(2));
});

describe('settled drift', () => {
	test('falls to zero once every entry is in Notion', () => {
		const { entries, only_here } = prepStanding({ show_code: 'BLR', notion, prep: [entry('character', 'Mara Voss', 'rmara'), entry('prop', 'the rush')], sheets: [], sent: [] });
		expect(only_here).toBe(0);
		expect(entries.map((one) => one.standing)).toEqual(['waiting_for_picture', 'waiting_for_picture']);
	});
	test('a page id that is no longer in Notion is missing from Notion', () => {
		expect(prepStanding({ show_code: 'BLR', notion, prep: [entry('character', 'Kai Santana', 'rgone')], sheets: [], sent: ['rgone'] }).entries[0].standing).toBe('missing_from_notion');
	});
	test('a same name of another kind is not that reference', () => {
		expect(prepStanding({ show_code: 'BLR', notion, prep: [entry('location', 'The Rush')], sheets: [], sent: [] }).only_here).toBe(1);
	});
	test('a sheet in the wrong folder does not count', () => {
		expect(prepStanding({ show_code: 'BLR', notion, prep: [entry('character', 'Mara Voss', 'rmara')], sheets: [sheet('BLR_REF_CHR_MARA_VOSS', 'refs:props')], sent: [] }).entries[0].standing).toBe('waiting_for_picture');
	});
});
