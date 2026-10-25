import { describe, expect, test } from 'bun:test';
import { keyframeChunks, keyframePrompt, keyframeQc, keyframeShape, lookLine } from '../../src/lib/domain/grid';
import { compileHandles } from '../../src/lib/domain/handles';
import type { ShotSpec } from '../../src/lib/domain/shot-spec';

const spec = (over: Partial<ShotSpec> = {}): ShotSpec => ({ size: 'MS', angle: 'eye level', subjects: ['@Kai'], action: '@Kai crosses @Quad.', dialogue: '', location: '@Quad', light: 'night, sodium lamps', camera_move: 'slow push in', duration_s: 6, ...over });
const shot = (n: number, over: Partial<ShotSpec> = {}) => ({ card_id: `c${n}`, title: `Shot ${n}`, spec: spec(over) });
const refs = [{ name: 'Kai "Hoodie" Santana', kind: 'Character', handles: ['@Kai'] }, { name: 'College Quad', kind: 'Location', handles: ['@Quad'] }];

describe('keyframes (V1S-376)', () => {
	test('four approved shots per 2×2; a wide shot renders alone, keeping story order', () => {
		const shots = [shot(1), shot(2), shot(3, { size: 'WS' }), shot(4), shot(5), shot(6), shot(7), shot(8)];
		expect(keyframeChunks(shots).map((chunk) => chunk.map((s) => s.card_id))).toEqual([['c1', 'c2'], ['c3'], ['c4', 'c5', 'c6', 'c7'], ['c8']]);
		expect([keyframeShape(1), keyframeShape(3)]).toEqual([{ rows: 1, cols: 1 }, { rows: 2, cols: 2 }]);
	});

	test('the prompt comes from the specs: the series look once, one panel per shot, spare panels as closer angles, locks', () => {
		const look = lookLine('Status: draft\nLook: anamorphic lens, light haze, fine film grain; night unless a shot says otherwise.\nMore.');
		expect(look).toBe('Look: anamorphic lens, light haze, fine film grain; night unless a shot says otherwise.');
		const prompt = keyframePrompt({ scene: 'Morning Quad', look, shots: [shot(1), shot(2, { size: 'CU', action: '@Kai smiles.' })] });
		const lines = prompt.split('\n');
		expect(lines[0]).toBe('Create a 2x2 grid of four cinematic 16:9 film stills from the scene "Morning Quad", one moment per panel, in story order.');
		expect(lines[1]).toBe(look);
		expect(prompt).toContain('Panel 2. Close-up, eye level — @Kai smiles. In @Quad. Night, sodium lamps.');
		expect(prompt).toContain('Panel 3. A closer angle on the moment in panel 1.');
		expect(prompt).toContain('LOCKS:');
		// Same specs, same bytes: an approval stays valid.
		expect(keyframePrompt({ scene: 'Morning Quad', look, shots: [shot(1), shot(2, { size: 'CU', action: '@Kai smiles.' })] })).toBe(prompt);
		expect(keyframePrompt({ scene: 'Quad', look: '', shots: [shot(1, { size: 'WS' })] }).split('\n')[0]).toBe('Create one cinematic 16:9 film still from the scene "Quad".');
	});

	test('compiled the Ghost way and checked: exact names with image tags, no stray handles, no banned words', () => {
		const compiled = compileHandles(keyframePrompt({ scene: 'Quad', look: '', shots: [shot(1)] }), refs, 'ghost');
		const prompt = compiled.prompt.replace(/^Upload:/m, 'References:');
		expect(prompt.split('\n')[0]).toBe('References: image 1 = Kai "Hoodie" Santana, image 2 = College Quad');
		expect(prompt).toContain('Kai "Hoodie" Santana (image 1) crosses College Quad (image 2).');
		expect(keyframeQc(prompt, ['Kai "Hoodie" Santana', 'College Quad'])).toEqual([]);
		expect(keyframeQc(`${prompt} @Bryce waits under a neon sign.`, ['Kai "Hoodie" Santana']).join(' ')).toMatch(/@Bryce.*neon/);
	});
});
