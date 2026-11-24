import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * DESIGN.md's hard rules that can be read off a stylesheet, checked on every component of the new screens, so a
 * new file in these folders is covered without writing its own test. Folders still carrying the old look are
 * added here as they are restyled.
 */
const FOLDERS = ['src/lib/ui/shots', 'src/lib/ui/shell', 'src/lib/ui/story', 'src/lib/ui/cut', 'src/lib/ui/timeline'];
/** Single components restyled inside a folder that still carries the old look. */
const FILES = ['src/lib/ui/nodes/StoryCardNode.svelte', 'src/lib/ui/StoryPlan.svelte'];
const files = [...FOLDERS.flatMap((folder) => readdirSync(folder).filter((name) => name.endsWith('.svelte')).map((name) => join(folder, name))), ...FILES];
const styleOf = (file: string) => { const source = readFileSync(file, 'utf8'); const at = source.indexOf('<style>'); return at < 0 ? '' : source.slice(at); };

test('the new screens are found', () => {
	expect(files.length).toBeGreaterThanOrEqual(8);
});

for (const file of files) {
	const style = styleOf(file);
	test(`${file}: no borders, no pills, no circles, nothing bold`, () => {
		expect(style).not.toMatch(/border(-(top|bottom|left|right))?: [^0;]/);
		expect(style).not.toMatch(/border-radius: (50%|9999?px|100px)/);
		expect(style).not.toMatch(/font-weight: (bold|[5-9]00)/);
		expect(style).not.toMatch(/font:[^;]*\b(bold|[5-9]00)\b/);
		expect(style).not.toMatch(/border-style: (dashed|dotted)|outline: [^;]*(dashed|dotted)/);
	});
	// A local class with a Tailwind utility's name also gets the utility: `.fixed` took a label out of its row, `.outline` drew a frame.
	test(`${file}: no class named after a layout utility`, () => {
		expect(style).not.toMatch(/(^|[\s,{}])\.(fixed|absolute|relative|sticky|static|hidden|flex|grid|block|inline|contents|truncate|invisible|collapse|outline|border|ring|shadow)(?![\w-])/);
	});
}
