import { describe, expect, test } from 'bun:test';
import { compileHandles, handlesIn } from '../../src/lib/domain/handles';
import { lintPrompt } from '../../src/lib/domain/prompt-lint';

const kai = { name: 'Kai "Hoodie" Santana', kind: 'Character', handles: ['@Kai'] };
const elias = { name: 'Elias Vane', kind: 'Character', handles: ['@Elias', '@Vane'] };
const store = { name: 'the Video Haven interior', kind: 'Location', handles: ['@VideoHaven'] };
const vial = { name: 'the silver vial', kind: 'Prop', handles: ['@Vial'] };
const refs = [vial, store, elias, kai];

describe('handle compile', () => {
	test('numbers characters → location → props, in order of first mention within a kind', () => {
		const out = compileHandles('@Vial sits on the counter of @VideoHaven. @Elias watches @Kai.', refs, 'seedance');
		expect(out.images.map((entry) => [entry.image, entry.reference.name])).toEqual([[1, 'Elias Vane'], [2, 'Kai "Hoodie" Santana'], [3, 'the Video Haven interior'], [4, 'the silver vial']]);
		expect(out.prompt).toBe([
			'@Image_1 = Elias Vane — definitive identity and wardrobe lock',
			'@Image_2 = Kai "Hoodie" Santana — definitive identity and wardrobe lock',
			'@Image_3 = the Video Haven interior — exact location lock',
			'@Image_4 = the silver vial — exact prop lock',
			'',
			'@Image_4 (the silver vial) sits on the counter of @Image_3 (the Video Haven interior). @Image_1 (Elias Vane) watches @Image_2 (Kai "Hoodie" Santana).'
		].join('\n'));
	});

	test('repeats and alias handles keep the same image number; possessives survive', () => {
		const out = compileHandles("@Kai's hand shakes. @Vane steps in. @Kai backs off from @Elias.", refs, 'seedance');
		expect(out.images.map((entry) => entry.image)).toEqual([1, 2]);
		expect(out.prompt).toContain('@Image_1 (Kai "Hoodie" Santana)\'s hand shakes. @Image_2 (Elias Vane) steps in. @Image_1 (Kai "Hoodie" Santana) backs off from @Image_2 (Elias Vane).');
	});

	test('plain words and dialogue without @ are left alone', () => {
		const out = compileHandles('@Kai says: "Kai never runs." Elias is not mentioned.', refs, 'seedance');
		expect(out.images).toHaveLength(1);
		expect(out.prompt).toContain('"Kai never runs." Elias is not mentioned.');
	});

	test('unknown handles stay in place and are reported once', () => {
		const out = compileHandles('@Bryce looks at @Kai. @Bryce smiles.', refs, 'seedance');
		expect(out.unknown).toEqual(['@Bryce']);
		expect(out.prompt).toContain('@Bryce looks at @Image_1 (Kai "Hoodie" Santana). @Bryce smiles.');
		expect(lintPrompt(out.prompt, 'seedance').issues.map((issue) => issue.rule)).toContain('unknown-handle');
	});

	test('a handle on two references is ambiguous, not guessed', () => {
		const out = compileHandles('@Kai waits.', [kai, { ...elias, handles: ['@Kai'] }], 'seedance');
		expect(out.ambiguous).toEqual(['@Kai']);
		expect(out.images).toEqual([]);
	});

	test('handles match case-insensitively; @Image_N is never a handle', () => {
		expect(handlesIn('@kai and @Image_2 and @Image 3')).toEqual(['@kai']);
		expect(compileHandles('@kai waits.', refs, 'seedance').images).toHaveLength(1);
	});

	test('Nano Banana gets "Image N" with no @', () => {
		const out = compileHandles('@Kai inside @VideoHaven.', refs, 'nano_banana');
		expect(out.prompt).toBe('Image 1 = Kai "Hoodie" Santana — definitive identity and wardrobe lock\nImage 2 = the Video Haven interior — exact location lock\n\nImage 1 (Kai "Hoodie" Santana) inside Image 2 (the Video Haven interior).');
		expect(lintPrompt(out.prompt, 'nano_banana', [], { references: refs }).issues).toEqual([]);
	});

	test('firstImage leaves room for a start frame', () => {
		expect(compileHandles('@Kai waits.', refs, 'seedance', { firstImage: 2 }).prompt.startsWith('@Image_2 = Kai')).toBe(true);
	});

	test('no handles: the prompt is unchanged', () => {
		expect(compileHandles('A quiet street at dawn, hard cut to a wide.', refs, 'seedance').prompt).toBe('A quiet street at dawn, hard cut to a wide.');
	});
});

describe('lint with references', () => {
	test('a compiled prompt passes', () => {
		const out = compileHandles('@Kai walks into @VideoHaven, hard cut to @Kai at the counter.', refs, 'seedance');
		expect(lintPrompt(out.prompt, 'seedance', [], { references: refs }).issues).toEqual([]);
	});

	test('a full name without its image label is flagged', () => {
		const out = compileHandles('@Kai walks in, hard cut to the counter.', refs, 'seedance');
		const issues = lintPrompt(`${out.prompt} Kai "Hoodie" Santana sits.`, 'seedance', [], { references: refs }).issues;
		expect(issues.map((issue) => issue.rule)).toEqual(['unlabelled-name']);
	});
});

describe('handle compile beside a declared start frame', () => {
	test('numbers continue after images the prompt already declares', () => {
		const out = compileHandles('Image_1 is the start frame.\n@Kai turns, hard cut.', refs, 'seedance');
		expect(out.images.map((entry) => entry.image)).toEqual([2]);
		expect(out.prompt).toContain('@Image_2 (Kai "Hoodie" Santana) turns');
	});
});
