import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { characterSheetInputsSchema, fillCharacterSheet } from '../../src/lib/domain/character-sheet';

const template = await readFile('agent-skills/castkit-v1/references/character-sheet.txt', 'utf8');
test('scene input fills declared fields literally and leaves the fixed panel text untouched', () => {
	const input = characterSheetInputsSchema.parse({subject:'the foreground woman with the dark bob',direction:'Use the black suit from the second reference. Remove temporary bruising.',wardrobe_source_url:'/outfit.png',coverage_confirmed:true});
	const prompt = fillCharacterSheet(template,input);
	expect(fillCharacterSheet(template,structuredClone(input))).toBe(prompt);
	expect(prompt).toContain(input.subject);
	expect(prompt).toContain(input.direction);
	expect(prompt).toContain('second attached reference');
	expect(prompt.slice(prompt.indexOf('One horizontal image'))).toBe(template.trim().slice(template.indexOf('One horizontal image')));
	expect(prompt).not.toMatch(/faithful|photocopy|\{\{/i);
	const single = fillCharacterSheet(template,{...input,wardrobe_source_url:null});
	expect(single).not.toContain('second attached reference');
	expect(() => fillCharacterSheet(template,{...input,coverage_confirmed:false})).toThrow('Confirm');
	expect(() => fillCharacterSheet(template,{...input,subject:'{{DIRECTION}}'})).toThrow('Template markers');
});
