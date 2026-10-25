import { describe, expect, test } from 'bun:test';
import { placeName, prepEntries, prepStage, sheetFileName, templateFor, emptyState } from '../../src/lib/domain/prep';

const scenes = [
	{ page_id: 's10', title: '2:47 AM', number: 10, location: 'Video Haven — back room / counter', characters: ['Kai', 'Mara', 'Malachi', 'Customer'] },
	{ page_id: 's20', title: 'Morning Quad', number: 20, location: 'College quad / orientation', characters: ['Kai', 'Malik', 'Elias'] },
	{ page_id: 's40', title: 'Video Haven, Day', number: 40, location: 'Video Haven', characters: ['Kai', "Kai's Mother", 'Customer'] },
	{ page_id: 's80', title: 'The Walk', number: 80, location: 'Veridian Avenue → Video Haven exterior', characters: ['Mara', 'Malachi', 'the freshmen'] },
	{ page_id: 's120', title: 'The Escape', number: 120, location: 'Video Haven rear exit → rooftops', characters: ['Kai', 'Kai Santana'] }
];
const references = [
	{ page_id: 'r-kai', name: 'Kai "Hoodie" Santana', kind: 'Character', role: "the crew's charming leader", scene_ids: [] },
	{ page_id: 'r-mara', name: 'Mara Voss', kind: 'Character', role: 'a freshman who notices too much', scene_ids: [] },
	{ page_id: 'r-quad', name: 'College Quad', kind: 'Location', role: 'the private college quad', scene_ids: [] },
	{ page_id: 'r-unused', name: 'Lucian Vale', kind: 'Character', role: '', scene_ids: [] }
];

describe('the Prep list (V1S-374)', () => {
	const entries = prepEntries(scenes, references, ['Red vial']);

	test('characters first (most scenes first), then locations in scene order, then props', () => {
		expect(entries.map((e) => [e.kind, e.name])).toEqual([
			['character', 'Kai "Hoodie" Santana'],
			['character', 'Mara Voss'],
			['character', 'Malachi'],
			['character', 'Malik'],
			['character', 'Elias'],
			['character', "Kai's Mother"],
			['location', 'Video Haven'],
			['location', 'College Quad'],
			['location', 'Veridian Avenue'],
			['prop', 'Red vial']
		]);
	});

	test('references keep their Notion row; names without one are listed to make', () => {
		const kai = entries.find((e) => e.name.startsWith('Kai "'))!;
		expect(kai.reference_page_id).toBe('r-kai');
		expect(kai.scenes.map((s) => s.title)).toEqual(['2:47 AM', 'Morning Quad', 'Video Haven, Day', 'The Escape']);
		expect(entries.find((e) => e.name === 'Malachi')!.reference_page_id).toBeNull();
		// "Kai Santana" is Kai; walk-ons and lowercase groups are not people to make a sheet for; unused references stay off.
		expect(entries.map((e) => e.name)).not.toContain('Kai Santana');
		expect(entries.map((e) => e.name)).not.toContain('Customer');
		expect(entries.map((e) => e.name)).not.toContain('the freshmen');
		expect(entries.map((e) => e.name)).not.toContain('Lucian Vale');
		// Video Haven's rear exit is still Video Haven.
		expect(entries.find((e) => e.name === 'Video Haven')!.scenes.map((s) => s.title)).toEqual(['2:47 AM', 'Video Haven, Day', 'The Escape']);
	});

	test('templates follow the ONE SHOT skill: T1/T5a characters, W3/W8 locations, W6 props', () => {
		expect([templateFor('character', false), templateFor('character', true), templateFor('location', false), templateFor('location', true), templateFor('prop', false)]).toEqual(['T1', 'T5a', 'W3', 'W8', 'W6']);
		expect(placeName('Veridian Avenue → Video Haven exterior')).toBe('Veridian Avenue');
		expect(sheetFileName('Kai "Hoodie" Santana')).toBe('Kai_Hoodie_Santana_sheet');
		expect(prepStage(emptyState())).toBe('sources');
	});
});
