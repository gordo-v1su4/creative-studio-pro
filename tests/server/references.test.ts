import { describe, expect, test } from 'bun:test';
import { compileForSend, fileNameHasName } from '../../src/lib/server/references';

const kai = { page_id: 'k', name: 'Kai "Hoodie" Santana', kind: 'Character', role: '', handles: ['@Kai'], file_name: 'Kai_Hoodie_Santana_sheet.png', name_on_sheet: true, scene_ids: [] };
const store = { page_id: 's', name: 'the Video Haven interior', kind: 'Location', role: '', handles: ['@VideoHaven'], file_name: 'haven.png', name_on_sheet: false, scene_ids: [] };

describe('compile for send', () => {
	test('attaches each used reference in image order', async () => {
		const out = await compileForSend('@Kai waits.', [kai, store], 'nano_banana', async (ref) => `/refs/${ref.file_name}`);
		expect(out.files).toEqual(['/refs/Kai_Hoodie_Santana_sheet.png']);
		expect(out.blocked).toEqual([]);
		expect(out.prompt.startsWith('Image 1 = Kai "Hoodie" Santana')).toBe(true);
	});

	test('blocks a reference with no name on the sheet, a wrong file name, or no file', async () => {
		const out = await compileForSend('@Kai inside @VideoHaven.', [kai, store], 'seedance');
		expect(out.blocked).toHaveLength(4);
		expect(out.blocked.join('\n')).toContain('Name on sheet is off');
		expect(out.blocked.join('\n')).toContain('does not contain its name');
		expect(out.blocked.filter((reason) => reason.includes('no file to attach'))).toHaveLength(2);
	});

	test('a prompt without handles needs nothing', async () => {
		const out = await compileForSend('A wide street, hard cut to a close-up.', [kai], 'seedance');
		expect(out).toMatchObject({ prompt: 'A wide street, hard cut to a close-up.', files: [], blocked: [] });
	});

	test('file names are compared on letters and digits', () => {
		expect(fileNameHasName('Kai_Hoodie_Santana_sheet.png', 'Kai "Hoodie" Santana')).toBe(true);
		expect(fileNameHasName('kai.png', 'Kai "Hoodie" Santana')).toBe(false);
	});
});
