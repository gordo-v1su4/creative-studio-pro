import { describe, expect, test } from 'bun:test';
import { cleanName, driftItems, isDriftQuestion, isMarkedOld, markedOld, type DriftInput, type DriftPrepEntry } from '../../src/lib/domain/drift';

/**
 * Drift 03 (GitHub #32 / V1S-510, ADR 0012): the comparison rule. Given Notion's References, each project's Prep
 * and Review Room's reference sheets, it lists what is out of step and the choices that make sense for each.
 * The cases are TR110's real ones (issues/04-references-to-review-room.md).
 */

const TR110 = { project_id: 'p-tr110', project_title: 'TR110' };
const notion: DriftInput['notion'] = [
	['r-kai', 'Kai Hoodie Santana'], ['r-mara', 'Mara Voss'], ['r-bryson', 'Bryson Vane'], ['r-malachi', 'Malachi Jackson'],
	['r-elias', 'Elias Mercer'], ['r-malik', 'Malik Vale'], ['r-rowan', 'Rowan Mercer'], ['r-lucian', 'Lucian Blaise']
].map(([page_id, name]) => ({ page_id, name, kind: 'Character' })).concat([{ page_id: 'r-quad', name: 'College Quad', kind: 'Location' }]);

const prep = (kind: DriftPrepEntry['kind'], name: string, reference_page_id: string | null = null): DriftPrepEntry => ({ ...TR110, kind, name, reference_page_id });
/** Every name TR110's Prep holds, spelled as it is there, duplicates included. */
const tr110Prep: DriftPrepEntry[] = [
	prep('character', 'Kai Hoodie Santana', 'r-kai'), prep('character', 'Mara Voss', 'r-mara'), prep('character', 'Bryson Vane', 'r-bryson'),
	prep('character', 'Lucian Blaise', 'r-lucian'), prep('location', 'College Quad', 'r-quad'),
	prep('character', 'Malachi Jackson'),
	prep('location', 'Chapel arcade at night'), prep('location', 'Chapel basement stairwell'), prep('location', 'Chapel undercroft'),
	prep('location', 'Video Haven'), prep('location', 'Pool'), prep('location', 'Campus Walkway'), prep('location', 'Campus walkway'),
	prep('location', 'Portland woods and campus boundary'), prep('location', 'Rooftop chase - blue storm night'), prep('location', 'Rooftop chase · blue storm night'),
	prep('prop', 'Amber vials'), prep('character', 'The Pledge'), prep('location', 'Campus gym'), prep('location', 'Off-campus party house'),
	prep('location', 'Mara’s dorm room'), prep('location', "Mara's dorm room"), prep('location', 'Portland rooftops'),
	prep('location', 'Kai rooftop run - sunset'), prep('prop', 'The Rush'), prep('prop', "Kai's Sunglasses")
];
const sheet = (code: string, folder_key: string) => ({ asset_id: `a-${code}`, code, folder_key, title: code });
const sheets: DriftInput['sheets'] = [
	sheet('BLR_REF_CHR_KAI_HOODIE_SANTANA', 'refs:characters'), sheet('BLR_REF_CHR_MARA_VOSS', 'refs:characters'),
	sheet('BLR_REF_CHR_LUCIAN_BLAISE', 'refs:characters'), sheet('BLR_REF_LOC_COLLEGE_QUAD', 'refs:locations'),
	sheet('BLR_REF_CHR_LUCIAN_VALE', 'refs:characters'), sheet('BLR_REF_CHR_BRYSON', 'refs:characters'),
	sheet('BLR_REF_PRP_KAI_S_SUNGLASSES', 'refs:props')
];
const tr110: DriftInput = { show_code: 'BLR', notion, prep: tr110Prep, sheets };

describe('the drift check on TR110', () => {
	const items = driftItems(tr110);
	const named = (name: string) => items.find((item) => item.name === name);

	test('the sixteen made only in Prep are each one item offering "add to Notion", missing from Notion and Review Room', () => {
		const sixteen = ['Chapel arcade at night', 'Chapel basement stairwell', 'Chapel undercroft', 'Video Haven', 'Pool', 'Campus walkway',
			'Portland woods and campus boundary', 'Rooftop chase, blue storm night', 'Amber vials', 'The Pledge', 'Campus gym', 'Off-campus party house',
			"Mara's dorm room", 'Portland rooftops', 'Kai rooftop run, sunset', 'The Rush'];
		for (const name of sixteen) {
			const item = named(name);
			expect(item, name).toBeDefined();
			expect(item!.type).toBe('only_in_prep');
			expect(item!.choices).toEqual(['add_to_notion']);
			expect(item!.found.prep).toEqual([{ project_id: 'p-tr110', project_title: 'TR110' }]);
			expect(item!.found.review_room).toBeNull();
			expect(item!.missing).toEqual(['notion', 'review_room']);
		}
		expect(items.filter((item) => item.type === 'only_in_prep' && !item.found.review_room)).toHaveLength(16);
	});

	test('two spellings in one project are one item carrying both spellings', () => {
		expect(named("Mara's dorm room")!.spellings).toEqual(['Mara’s dorm room', "Mara's dorm room"]);
		expect(named('Campus walkway')!.spellings).toEqual(['Campus Walkway', 'Campus walkway']);
		expect(named('Rooftop chase, blue storm night')!.spellings).toEqual(['Rooftop chase - blue storm night', 'Rooftop chase · blue storm night']);
		expect(items.filter((item) => /dorm/.test(item.name))).toHaveLength(1);
	});

	test("Kai's sunglasses is in Prep and Review Room but not Notion: add it to Notion, its sheet already has the code", () => {
		const item = named("Kai's Sunglasses")!;
		expect(item.type).toBe('only_in_prep');
		expect(item.kind).toBe('prop');
		expect(item.found.review_room).toEqual({ asset_id: 'a-BLR_REF_PRP_KAI_S_SUNGLASSES', code: 'BLR_REF_PRP_KAI_S_SUNGLASSES' });
		expect(item.missing).toEqual(['notion']);
		expect(item.choices).toEqual(['add_to_notion']);
		expect(items.filter((entry) => entry.found.review_room?.code === 'BLR_REF_PRP_KAI_S_SUNGLASSES')).toHaveLength(1);
	});

	test('Bryson in Review Room is close to Bryson Vane in Notion: it offers a link, and mark as old', () => {
		const item = items.find((entry) => entry.found.review_room?.code === 'BLR_REF_CHR_BRYSON')!;
		expect(item.type).toBe('only_in_review_room');
		expect(item.name).toBe('Bryson');
		expect(item.link_to).toEqual({ page_id: 'r-bryson', name: 'Bryson Vane' });
		expect(item.choices).toEqual(['link', 'mark_old']);
		expect(item.missing).toEqual(['notion']);
	});

	test('Lucian Vale, a sheet no Notion reference uses, offers only mark as old', () => {
		const item = items.find((entry) => entry.found.review_room?.code === 'BLR_REF_CHR_LUCIAN_VALE')!;
		expect(item.type).toBe('only_in_review_room');
		expect(item.name).toBe('Lucian Vale');
		expect(item.link_to).toBeNull();
		expect(item.choices).toEqual(['mark_old']);
	});

	test('what is in step gives no item: Notion references with sheets, a Prep name matching Notion, Bryson Vane with no sheet', () => {
		for (const name of ['Kai Hoodie Santana', 'Mara Voss', 'Lucian Blaise', 'College Quad', 'Malachi Jackson', 'Bryson Vane', 'Elias Mercer']) expect(named(name), name).toBeUndefined();
		expect(items).toHaveLength(19);
	});

	test('items come characters first, then locations, then props', () => {
		const order = { character: 0, location: 1, prop: 2 };
		const kinds = items.map((item) => order[item.kind]);
		expect(kinds).toEqual(kinds.toSorted((a, b) => a - b));
	});
});

describe('the drift rule', () => {
	test('a Notion reference with no sheet and no Prep entry is not drift', () => {
		expect(driftItems({ show_code: 'BLR', notion: [{ page_id: 'r', name: 'Rowan Mercer', kind: 'Character' }], prep: [], sheets: [] })).toEqual([]);
	});

	test('a clean series gives no items', () => {
		expect(driftItems({ show_code: 'BLR', notion, prep: tr110Prep.filter((entry) => entry.reference_page_id), sheets: sheets.slice(0, 4) })).toEqual([]);
	});

	test('a Prep name close to a Notion name offers add to Notion and a link', () => {
		const [item] = driftItems({ show_code: 'BLR', notion, prep: [prep('character', 'Bryson')], sheets: [] });
		expect(item.choices).toEqual(['add_to_notion', 'link']);
		expect(item.link_to).toEqual({ page_id: 'r-bryson', name: 'Bryson Vane' });
	});

	test('the same reference in two projects is one item found in both', () => {
		const other = { project_id: 'p-tr130', project_title: 'TR130' };
		const items = driftItems({ show_code: 'BLR', notion, prep: [prep('location', 'Pool'), { ...other, kind: 'location', name: 'pool', reference_page_id: null }], sheets: [] });
		expect(items).toHaveLength(1);
		expect(items[0].found.prep.map((found) => found.project_title)).toEqual(['TR110', 'TR130']);
	});

	test('the same name as a different kind is not the same reference', () => {
		const items = driftItems({ show_code: 'BLR', notion: [{ page_id: 'r', name: 'The Rush', kind: 'Location' }], prep: [prep('prop', 'The Rush')], sheets: [] });
		expect(items).toHaveLength(1);
		expect(items[0].kind).toBe('prop');
	});

	test('a sheet with no code is skipped', () => {
		expect(driftItems({ show_code: 'BLR', notion: [], prep: [], sheets: [{ asset_id: 'a', code: null, folder_key: 'refs:props', title: 'dropped.png' }] })).toEqual([]);
	});
});

describe('an old sheet (Drift 04)', () => {
	test('a sheet marked old in Review Room gives no item, so settled drift never comes back', () => {
		const old = sheets.map((entry) => (entry.code === 'BLR_REF_CHR_LUCIAN_VALE' ? { ...entry, old: true } : entry));
		const items = driftItems({ ...tr110, sheets: old });
		expect(items.some((item) => item.found.review_room?.code === 'BLR_REF_CHR_LUCIAN_VALE')).toBe(false);
		expect(items.some((item) => item.found.review_room?.code === 'BLR_REF_CHR_BRYSON')).toBe(true);
	});

	test('an old sheet no longer claims the Prep entry of the same name: it is offered as missing from Review Room too', () => {
		const items = driftItems({ show_code: 'BLR', notion: [], prep: [prep('prop', "Kai's Sunglasses")], sheets: [{ ...sheet('BLR_REF_PRP_KAI_S_SUNGLASSES', 'refs:props'), old: true }] });
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ type: 'only_in_prep', found: { review_room: null }, missing: ['notion', 'review_room'] });
	});

	test('marking old adds only the flag and the reference it is history of, and keeps every other field', () => {
		const before = {
			model: '', prompt: '', sourceLabel: 'Creative Studio Pro', referenceImageVersionIds: [], notes: 'kept',
			customFields: [{ id: 'reference', label: 'reference', kind: 'text', value: 'Lucian Vale' }]
		};
		expect(isMarkedOld(before)).toBe(false);
		const after = markedOld(before, { page_id: 'r-lucian', name: 'Lucian Blaise' });
		expect(after).toEqual({
			...before,
			customFields: [
				{ id: 'reference', label: 'reference', kind: 'text', value: 'Lucian Vale' },
				{ id: 'old', label: 'Old', kind: 'boolean', value: true },
				{ id: 'history_of', label: 'History of', kind: 'text', value: 'Lucian Blaise' },
				{ id: 'history_of_notion_page_id', label: 'History of (Notion page)', kind: 'text', value: 'r-lucian' }
			]
		});
		expect(isMarkedOld(after)).toBe(true);
		expect(before.customFields).toHaveLength(1);
	});

	test('marked old with no reference, it carries the flag alone; marked again, the history is replaced, not doubled', () => {
		const alone = markedOld({ model: '', prompt: '', sourceLabel: '', referenceImageVersionIds: [] }, null);
		expect(alone.customFields).toEqual([{ id: 'old', label: 'Old', kind: 'boolean', value: true }]);
		const again = markedOld(markedOld(alone, { page_id: 'a', name: 'A' }), { page_id: 'b', name: 'B' });
		expect((again.customFields as Array<{ id: string }>).map((field) => field.id)).toEqual(['old', 'history_of', 'history_of_notion_page_id']);
		expect(again.customFields).toContainEqual({ id: 'history_of', label: 'History of', kind: 'text', value: 'B' });
	});

	test('only a true "old" field counts', () => {
		expect(isMarkedOld({ customFields: [{ id: 'old', label: 'Old', kind: 'boolean', value: false }] })).toBe(false);
		expect(isMarkedOld({ customFields: [{ id: 'old', label: 'Old', kind: 'boolean', value: null }] })).toBe(false);
		expect(isMarkedOld({})).toBe(false);
	});
});

describe('the proposed name', () => {
	test('uses straight apostrophes and no " - "', () => {
		expect(cleanName('Mara’s dorm room')).toBe("Mara's dorm room");
		expect(cleanName('Kai rooftop run - sunset')).toBe('Kai rooftop run, sunset');
		expect(cleanName('Rooftop chase · blue storm night')).toBe('Rooftop chase, blue storm night');
		expect(cleanName('  Off-campus   party house ')).toBe('Off-campus party house');
	});
});

describe('asking the Agent', () => {
	test('"what\'s out of step?" in its usual wordings asks for the check', () => {
		for (const text of ["what's out of step?", 'What’s out of step', 'Is anything out of step?', 'check drift', 'run the drift check']) expect(isDriftQuestion(text), text).toBe(true);
		for (const text of ['Write the next scene', 'step out of the car', 'what happens in step two?']) expect(isDriftQuestion(text), text).toBe(false);
	});
});
