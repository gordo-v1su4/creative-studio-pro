import { z } from 'zod';

export const CHARACTER_SHEET_TEMPLATE = 'castkit-sheet-v1';
export const characterSheetInputsSchema = z.object({
	subject: z.string().trim().min(1).max(300).default('the only person in the reference'),
	direction: z.string().trim().min(1).max(2000).default('Keep the appearance, clothing and accessories shown in the references unchanged.'),
	wardrobe_source_url: z.string().min(1).max(1000).nullable().default(null),
	coverage_confirmed: z.boolean().default(false)
});
export type CharacterSheetInputs = z.infer<typeof characterSheetInputsSchema>;

/** Literal substitution only: no model, paraphrasing, inferred facts or hidden character-specific prose. */
export function fillCharacterSheet(template: string, input: CharacterSheetInputs): string {
	const fields = characterSheetInputsSchema.parse(input);
	if (!fields.coverage_confirmed) throw new Error('Confirm the reference or wardrobe direction supplies the missing body and outfit details');
	if (/\{\{|\}\}/.test(fields.subject + fields.direction)) throw new Error('Template markers cannot be used inside sheet fields');
	const normalized = template.replace(/\r\n/g, '\n').trim();
	const markers = normalized.match(/\{\{[A-Z_]+\}\}/g) ?? [];
	if (markers.length !== 3 || !markers.includes('{{SUBJECT}}') || !markers.includes('{{DIRECTION}}') || !markers.includes('{{REFERENCES}}')) throw new Error('The fixed sheet template has unexpected fields');
	const slots = { SUBJECT: fields.subject, DIRECTION: fields.direction, REFERENCES: fields.wardrobe_source_url ? 'Use the second attached reference for body proportions, clothing, footwear and accessories only. The face and identity come from the first reference.' : 'Use the first reference for visible body proportions, clothing, footwear and accessories. Use the supplied details below for anything outside the reference frame.' };
	return normalized.replace(/\{\{(SUBJECT|DIRECTION|REFERENCES)\}\}/g, (_, key: keyof typeof slots) => slots[key]);
}
