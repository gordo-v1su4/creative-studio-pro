/**
 * Grid stills (V1S-278, CONTEXT.md "Grid"): one 4K 16:9 image holding a scene's stills as a 3×3 sheet,
 * generated together for continuity and split into still takes. A scene with more than nine shots gets a
 * second grid that reuses the first one's references.
 */

export const GRID_ROWS = 3;
export const GRID_COLS = 3;
export const GRID_CELLS = GRID_ROWS * GRID_COLS;

export interface GridShot { card_id: string; title: string; image_prompt: string; description: string }

/** Shots in story order, nine per grid. */
export function gridChunks<T>(shots: T[]): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < shots.length; i += GRID_CELLS) chunks.push(shots.slice(i, i + GRID_CELLS));
	return chunks;
}

const usable = (text: string) => text.trim() && !/^none yet/i.test(text.trim());

/**
 * The grid prompt: a 3×3 cinematic shot grid, each panel one shot, same characters, wardrobe, light and
 * location across panels, no borders or text. Empty cells (fewer than nine shots) are asked to stay black.
 */
export function gridPrompt(input: { scene: string; location: string; summary: string; characters: string[]; shots: GridShot[] }): string {
	const lines = input.shots.map((shot, i) => `Panel ${i + 1} (row ${Math.floor(i / GRID_COLS) + 1}, column ${(i % GRID_COLS) + 1}): ${usable(shot.image_prompt) ? shot.image_prompt.trim() : shot.description.trim()}`);
	for (let i = input.shots.length; i < GRID_CELLS; i++) lines.push(`Panel ${i + 1}: plain black, empty.`);
	return [
		`A 3×3 grid of nine cinematic film stills from one scene, read left to right, top to bottom. Equal 16:9 panels, edge to edge, no borders, no gutters, no text, no captions, no numbers.`,
		`Scene: ${input.scene}${input.location ? ` — ${input.location}` : ''}. ${input.summary}`.trim(),
		input.characters.length ? `The same characters in every panel, identical faces, hair and wardrobe: ${input.characters.join(', ')}.` : '',
		'Consistent lighting, colour grade and lens look across all panels, as frames from the same shoot.',
		...lines
	].filter(Boolean).join('\n');
}
