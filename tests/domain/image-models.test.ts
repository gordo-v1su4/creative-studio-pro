import { describe, expect, test } from 'bun:test';
import { DEFAULT_IMAGE_MODEL, IMAGE_MODEL_IDS, IMAGE_MODELS, RETIRED_IMAGE_MODELS, highFrequencyWords, soften26 } from '../../src/lib/domain/image-models';
import { prepStateSchema } from '../../src/lib/domain/prep';
import { stillArgs, STILL_MODEL } from '../../src/lib/server/higgsfield';
import { renderSources } from '../../src/lib/server/prep';

describe('image models (V1S-522)', () => {
	test('new images are ChatGPT Image 2.6 Sunburst at 2K, high; Nano Banana Pro stays for alterations', () => {
		expect(IMAGE_MODEL_IDS).toEqual(['gpt_image_2_6', 'nano_banana_pro']);
		expect(DEFAULT_IMAGE_MODEL).toBe('gpt_image_2_6');
		expect(IMAGE_MODELS[DEFAULT_IMAGE_MODEL]).toMatchObject({ label: 'ChatGPT Image 2.6 Sunburst', quality: 'high', resolution: '2k' });
		expect(STILL_MODEL).toBe(IMAGE_MODELS.gpt_image_2_6);
		expect(stillArgs({ prompt: 'x', references: [], aspect_ratio: '16:9' }, 'p.json')).toEqual(['gpt_image_2_6', '--prompt', '@p.json', '--aspect_ratio', '16:9', '--quality', 'high', '--resolution', '2k']);
	});

	test('a Prep entry with no model, or saved on the retired model, reads as 2.6', () => {
		expect(prepStateSchema.parse({}).image_model).toBe('gpt_image_2_6');
		for (const retired of Object.keys(RETIRED_IMAGE_MODELS)) expect(prepStateSchema.parse({ image_model: retired }).image_model).toBe('gpt_image_2_6');
		expect(prepStateSchema.parse({ image_model: 'nano_banana_pro' }).image_model).toBe('nano_banana_pro');
		expect(prepStateSchema.safeParse({ image_model: 'flux' }).success).toBeFalse();
	});
});

describe('high-frequency wording on 2.6 (V1S-522)', () => {
	test('finds the words that make 2.6 splotchy, outside the AVOID line', () => {
		for (const text of ['a grungy hallway', 'dirt on the floor', 'lots of detail', 'micro detail in the brick', 'high micro contrast', 'razor texture in every surface', 'heavy fine grain', 'blacks lifted and grainy', 'fine 35mm film grain', 'hyper-detailed walls'])
			expect(highFrequencyWords(`A gym. ${text}.`).length).toBeGreaterThan(0);
		expect(highFrequencyWords('A clean gym with soft window light.\nAVOID: grain, grunge, dirt.')).toEqual([]);
		// Things in the set, not texture words.
		expect(highFrequencyWords('A dirt road past razor wire, oak floor with visible wood grain.')).toEqual([]);
	});

	test("Scenecraft's fixed finish lines get a 2.6-safe wording", () => {
		const finish = 'Color-negative motion-picture film rendition, daylight-balanced for day or tungsten-balanced and pushed for night, heavy fine grain across the entire frame and heaviest in the lifted shadows. Low macro contrast with blacks lifted at every depth and highlights rolling off softly, never clipping; high micro contrast with razor texture in every surface — stone, metal, wood, glass, fabric, foliage. Blacks lifted and grainy between every source.';
		const safe = soften26(finish);
		expect(highFrequencyWords(safe)).toEqual([]);
		expect(safe).toContain('Low macro contrast with blacks lifted at every depth');
		expect(safe).toContain('stone, metal, wood, glass, fabric, foliage');
	});
});

describe('what a Prep render attaches (V1S-522)', () => {
	const src = (n: number) => ({ name: `s${n}.png`, file: `/f/s${n}.png`, url: `/u/s${n}`, added_at: '' });
	const state = (extra: object) => prepStateSchema.parse({ sources: [src(1), src(2), src(3)], ...extra });
	const flow = (builder: string, stage: string, approved: string | null = null) => ({ workflow: { builder, stage, approved_source_url: approved, confirmed: true } });
	test('one reference at most, the approved or body source first', () => {
		expect(renderSources(state({})).map((s) => s.url)).toEqual(['/u/s1']);
		expect(renderSources(state({ body_source_url: '/u/s3' })).map((s) => s.url)).toEqual(['/u/s3']);
		expect(renderSources(state(flow('castkit-v1', 'face_lock'))).map((s) => s.url)).toEqual(['/u/s1']);
		expect(renderSources(state(flow('castkit-v1', 'outfit', '/u/s2'))).map((s) => s.url)).toEqual(['/u/s2']);
		expect(renderSources(state(flow('scenecraft-v1', 'coverage', '/u/s3'))).map((s) => s.url)).toEqual(['/u/s3']);
	});
	test('a Scenecraft environment master is text only; the Castkit sheet keeps its fixed identity + wardrobe pair', () => {
		expect(renderSources(state(flow('scenecraft-v1', 'environment')))).toEqual([]);
		const sheet = state({ ...flow('castkit-v1', 'sheet', '/u/s2'), sheet_inputs: { wardrobe_source_url: '/u/s1' } });
		expect(renderSources(sheet).map((s) => s.url)).toEqual(['/u/s2', '/u/s1']);
	});
});
