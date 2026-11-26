/**
 * Still presets shared by Prep, approval cards and the Higgsfield adapter (V1S-522): new images are ChatGPT Image
 * 2.6 Sunburst at 2K, high; Nano Banana Pro alters an existing picture (same look, a new angle or resolution).
 */
export const IMAGE_MODEL_IDS = ['gpt_image_2_6', 'nano_banana_pro'] as const;
export type ImageModelId = typeof IMAGE_MODEL_IDS[number];
export const IMAGE_MODELS = {
	gpt_image_2_6: { job_type: 'gpt_image_2_6', label: 'ChatGPT Image 2.6 Sunburst', quality: 'high', resolution: '2k' },
	nano_banana_pro: { job_type: 'nano_banana_pro', label: 'Nano Banana Pro', resolution: '2k' }
} as const;
export const DEFAULT_IMAGE_MODEL: ImageModelId = 'gpt_image_2_6';
/** Models taken off the list, and what a saved choice of one reads as now. */
export const RETIRED_IMAGE_MODELS: Record<string, ImageModelId> = { gpt_image_2_5: 'gpt_image_2_6' };
export const currentImageModel = (value: unknown): unknown => typeof value === 'string' && Object.hasOwn(RETIRED_IMAGE_MODELS, value) ? RETIRED_IMAGE_MODELS[value] : value;
/** Models whose prompts must stay clear of high-frequency wording (2.6 comes back splotchy with it). */
export const needsCleanWording = (model: ImageModelId): boolean => model === 'gpt_image_2_6';

export function imageModelOption(model: ImageModelId): string {
	const preset = IMAGE_MODELS[model];
	return `${preset.label} · ${preset.resolution.toUpperCase()}${'quality' in preset ? ' · High' : ''}`;
}

/**
 * High-frequency wording (operator, 2026-11-26): grain, grit, razor texture and "lots of detail" make 2.6 come back
 * splotchy, worst with a reference attached. Lines starting AVOID: may name them as things to avoid.
 */
const HIGH_FREQUENCY: Array<[RegExp, string]> = [
	[/\bgrung(?:y|e)\b/i, 'grungy'],
	[/\bdirt(?:y)?\b(?!\s+(?:road|track|path|lot|bike)s?\b)/i, 'dirt'],
	[/\blots of detail\b/i, 'lots of detail'],
	[/\bmicro[- ]?(?:detail|contrast|texture|scratch)\w*/i, 'micro detail / micro contrast'],
	[/\brazor[- ]?(?:sharp|texture|detail)\w*/i, 'razor texture'],
	[/(?<!\bwood[- ])\bgrain(?:y|s)?\b(?!\s+(?:of the wood|silos?)\b)/i, 'grain'],
	[/\b(?:hyper|ultra|highly|intricately)[- ]?detailed\b|\bintricate detail/i, 'hyper-detailed']
];
export const WORDING_26 = 'ChatGPT Image 2.6 comes back splotchy with high-frequency wording, worst with a reference attached. Write none of these, not even softened: "grungy", "dirt", "lots of detail", "micro detail", "micro contrast", "razor texture", "grain" of any weight (film grain, grainy shadows) or "hyper-detailed". Say what the surface is and how the light falls on it instead (worn varnish on the floor, scuffs along the baseline), and keep the finish clean: smooth film tonality, low contrast, lifted blacks, soft highlight roll-off.';

export function highFrequencyWords(prompt: string): string[] {
	const said = prompt.split('\n').filter((line) => !/^\s*\**AVOID\**\s*:/i.test(line)).join('\n');
	return HIGH_FREQUENCY.filter(([pattern]) => pattern.test(said)).map(([, label]) => label);
}

/** Scenecraft's fixed finish lines, reworded for 2.6: the same film look without grain or micro-contrast language. */
export function soften26(prompt: string): string {
	return prompt
		.replace(/heavy fine grain across the entire frame and heaviest in the lifted shadows/g, 'smooth even tonality across the whole frame')
		.replace(/Heavy fine grain across the entire frame and heaviest in the lifted shadows/g, 'Smooth even tonality across the whole frame')
		.replace(/(high|High) micro contrast with razor texture in/g, (_, h: string) => `${h === 'High' ? 'N' : 'n'}atural true-scale texture in`)
		.replace(/ and grainy\b/gi, '')
		.replace(/\bgrainy (shadows?)/g, '$1')
		.replace(/\bGrainy (s)(hadows?)/g, (_, s: string, rest: string) => `${s.toUpperCase()}${rest}`);
}
