import { describe, expect, test } from 'bun:test';
import { lintPrompt } from '../../src/lib/domain/prompt-lint';

const head = 'Image 1 defines Kai "Hoodie" Santana’s identity, face, body, hair, and wardrobe. Image 4 is the Video Haven interior. No image: the man on the floor — a heavyset man in a 2001 windbreaker.';
const rules = (prompt: string, target: 'nano_banana' | 'seedance' = 'nano_banana') => lintPrompt(prompt, target).issues.map((i) => i.rule);

describe('prompt lint', () => {
	test('reads declarations as variables', () => {
		const { declarations } = lintPrompt(head);
		expect(declarations.map((d) => d.name)).toEqual(['Kai "Hoodie" Santana', 'the Video Haven interior', 'the man on the floor']);
	});

	test('clean prompt passes', () => {
		expect(rules(`${head}\n1. Kai "Hoodie" Santana from Image 1 inside the Video Haven interior from Image 4, beside the man on the floor.`)).toEqual([]);
	});

	test('flags pronouns, partial names, stand-ins and the dark store', () => {
		const found = rules(`${head}\n1. Kai looks at the store. He stands over the guy in the dark store.`);
		expect(found).toContain('partial-name');
		expect(found).toContain('place-alias');
		expect(found).toContain('pronoun');
		expect(found).toContain('person-alias');
		expect(found).toContain('vague-reference');
	});

	test('sentence-start capitalisation still matches a declared name', () => {
		expect(rules(`${head}\n1. The man on the floor lies still. The Video Haven interior from Image 4 is quiet.`)).toEqual([]);
	});

	test('quoted labels and dialogue are not scanned', () => {
		expect(rules(`${head}\n1. A sign reads "LOUNGE / GAME ROOM". Kai "Hoodie" Santana says "He is in the store."`)).toEqual([]);
	});

	test('flags re-description of a sheet', () => {
		expect(rules(`${head}\n1. Kai "Hoodie" Santana with platinum curls.`)).toContain('re-description');
	});

	test('target syntax: no @ on Nano Banana, underscore on Seedance', () => {
		expect(rules(`${head}\n1. @Image 1 at the counter.`)).toContain('at-sign');
		expect(rules('@Image 1 defines Kai "Hoodie" Santana’s identity.', 'seedance')).toContain('seedance-underscore');
		expect(rules('@Image_1 defines Kai "Hoodie" Santana’s identity.', 'seedance')).not.toContain('seedance-underscore');
	});

	test('banned words and black-and-white', () => {
		expect(rules(`${head}\n1. neon light.`)).toContain('banned-word');
		expect(rules(`${head}\nNo fangs.`)).toContain('banned-word');
		expect(rules(`${head}\n1. A vampire crew.`)).toContain('banned-word');
		expect(rules(`${head}\n1. A black-and-white frame.`)).toContain('black-and-white');
		expect(rules(`${head}\nNo black-and-white.`)).not.toContain('black-and-white');
	});

	test('flags undeclared image numbers in JSON prompts', () => {
		const json = JSON.stringify({ references: { 'Image 4': 'the Video Haven interior' }, shots: ['1. The Video Haven interior from Image 9.'] });
		expect(rules(json)).toContain('undeclared-image');
	});
});

test('several images can define one character', () => {
	const r = lintPrompt('Image 1 and Image 2 define Kai "Hoodie" Santana’s identity, face, body, hair, and wardrobe.\nKai "Hoodie" Santana walks (Image 2).');
	expect(r.declarations.filter((d) => d.name === 'Kai "Hoodie" Santana').map((d) => d.image)).toEqual([1, 2]);
	expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
});

test('inline "Name from Image N" style declares its own references', () => {
	const r = lintPrompt('1. Kai "Hoodie" Santana from Image 1 walks. Colour grade from Image 8.\n2. Kai "Hoodie" Santana from Image 1 stands in front of Mara Voss from Image 2, shielding Mara Voss.');
	expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
	expect(lintPrompt('1. Kai "Hoodie" Santana from Image 1 walks; he smiles.').issues.map((i) => i.rule)).toContain('pronoun');
});

test('operator-rejected beats: flicker, blood moon, pink signs, vial drinking, guide lines, Elias eye glow', () => {
	const head = '@Image_1 = Kai "Hoodie" Santana\n@Image_2 = Elias Mercer\n';
	const r = (body: string) => lintPrompt(head + body, 'seedance').issues.map((i) => i.rule);
	for (const body of [
		'The edit flickers to the beat. HARD CUT.',
		'A blood moon rises. HARD CUT.',
		'A pink glowing sign hums. HARD CUT.',
		'Kai "Hoodie" Santana drinks the vial. HARD CUT.',
		'Follow the red arc across the street. HARD CUT.',
		'Elias Mercer turns, eyes glowing. HARD CUT.',
	]) expect(r(body)).toContain('operator-rejected');
	expect(r('Kai "Hoodie" Santana sprints and leaps. HARD CUT. Elias Mercer watches.')).toEqual([]);
});

test('declared names lose a trailing period', () => {
	expect(lintPrompt('@Image_1 = Mara Voss.\nMara Voss runs. HARD CUT.', 'seedance').declarations[0].name).toBe('Mara Voss');
});

test('Seedance prompt with no cuts warns single-shot', () => {
	expect(lintPrompt('@Image_1 = Mara Voss\nMara Voss runs.', 'seedance').issues.map((i) => i.rule)).toContain('single-shot');
});
