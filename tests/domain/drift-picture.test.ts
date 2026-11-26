import { describe, expect, test } from 'bun:test';
import { driftItems, type DriftInput, type DriftPrepEntry } from '../../src/lib/domain/drift';

/**
 * Drift 08 (GitHub #36 / V1S-512, ADR 0012): a Prep picture under 2048 px on its long edge is its own drift item,
 * showing its size and offering only a remake: a small sheet is rendered new in Prep at 2K (GitHub #43
 * / V1S-521). Adding to Notion is a separate item that never waits on it.
 * The sizes are TR110's (issues/04-references-to-review-room.md).
 */

const TR110 = { project_id: 'p-tr110', project_title: 'TR110' };
const picture = (width: number, height: number, entry_key: string) => ({ width, height, url: `/api/projects/p-tr110/files/prep/references/${entry_key}.png`, entry_key });
const prep = (kind: DriftPrepEntry['kind'], name: string, reference_page_id: string | null, pic: DriftPrepEntry['picture'] = null): DriftPrepEntry => ({ ...TR110, kind, name, reference_page_id, picture: pic });
const input = (entries: DriftPrepEntry[], notion: DriftInput['notion'] = []): DriftInput => ({ show_code: 'BLR', notion, prep: entries, sheets: [] });

describe('an undersized picture', () => {
	test('Campus gym at 1678×937, not in Notion: "add to Notion" is one item, its picture another with its size, offering only remake', () => {
		const items = driftItems(input([prep('location', 'Campus gym', null, picture(1678, 937, 'location:Campus gym'))]));
		expect(items.map((item) => item.type)).toEqual(['only_in_prep', 'picture_too_small']);
		expect(items[0].choices).toEqual(['add_to_notion']);
		expect(items[1]).toMatchObject({
			kind: 'location', name: 'Campus gym', choices: ['remake'], missing: ['review_room'],
			found: { prep: [TR110], review_room: null },
			picture: { width: 1678, height: 937, entry_key: 'location:Campus gym', project_id: 'p-tr110', reference_page_id: null }
		});
	});

	test('a picture already in Notion carries its page and still offers only remake', () => {
		const items = driftItems(input([prep('location', 'Portland rooftops', 'r-roofs', picture(1344, 752, 'r-roofs'))], [{ page_id: 'r-roofs', name: 'Portland rooftops', kind: 'Location' }]));
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ type: 'picture_too_small', choices: ['remake'], picture: { width: 1344, height: 752, reference_page_id: 'r-roofs' } });
	});

	test('a portrait picture is measured on its long edge', () => {
		expect(driftItems(input([prep('character', 'The Pledge', null, picture(1158, 2048, 'k'))])).map((item) => item.type)).toEqual(['only_in_prep']);
		expect(driftItems(input([prep('character', 'The Pledge', null, picture(937, 1678, 'k'))])).map((item) => item.type)).toEqual(['only_in_prep', 'picture_too_small']);
	});

	test('a picture at 2048 px, or no picture at all, gives no picture item', () => {
		const items = driftItems(input([prep('location', 'Pool', null, picture(2048, 1143, 'p')), prep('prop', 'The Rush', null, null)]));
		expect(items.map((item) => `${item.name} ${item.type}`)).toEqual(['Pool only_in_prep', 'The Rush only_in_prep']);
	});

	test('a reference whose sheet is already in Review Room (College Quad) gives no picture item for its small Prep copy', () => {
		const items = driftItems({ ...input([prep('location', 'College Quad', 'r-quad', picture(1678, 937, 'r-quad'))], [{ page_id: 'r-quad', name: 'College Quad', kind: 'Location' }]), sheets: [{ asset_id: 'a-quad', code: 'BLR_REF_LOC_COLLEGE_QUAD', folder_key: 'refs:locations', title: 'College Quad' }] });
		expect(items).toEqual([]);
	});

	test("two spellings of Mara's dorm room with the same small picture are one picture item", () => {
		const pic = picture(1672, 941, "location:Mara's dorm room");
		const items = driftItems(input([prep('location', 'Mara’s dorm room', null, pic), prep('location', "Mara's dorm room", null, pic)]));
		expect(items.filter((item) => item.type === 'picture_too_small')).toHaveLength(1);
	});
});
