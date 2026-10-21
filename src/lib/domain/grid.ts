/**
 * Grid stills (V1S-278, CONTEXT.md "Grid"): one 16:9 image holding a scene's stills as a square sheet,
 * generated together for continuity and split into still takes. A scene with more than nine shots gets a
 * second grid that reuses the first one's references.
 */

/** Only square grids of 16:9 panels make a 16:9 frame (a 3×2 would be 8:3): 2×2 or 3×3. */
export const GRID_CELLS = 9;
export function gridShape(shots: number): { rows: number; cols: number } {
	return shots <= 4 ? { rows: 2, cols: 2 } : { rows: 3, cols: 3 };
}

export interface GridShot { card_id: string; title: string; image_prompt: string; description: string }

/** Shots in story order, nine per grid. */
export function gridChunks<T>(shots: T[]): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < shots.length; i += GRID_CELLS) chunks.push(shots.slice(i, i + GRID_CELLS));
	return chunks;
}

const usable = (text: string) => text.trim() && !/^none yet/i.test(text.trim());
const WORDS: Record<number, string> = { 4: 'four', 9: 'nine' };

/**
 * The grid prompt, written like a short script (operator, 2026-10-20 tests): one plain opener, then the
 * shots in order. No layout or negative instructions (the model fills a square grid edge to edge on its own)
 * and no black cells: a spare cell becomes a closer angle on an earlier shot. Who is who comes only from the
 * image declarations and each shot's exact names.
 */
export function gridPrompt(input: { scene: string; location: string; summary: string; characters: string[]; shots: GridShot[] }): string {
	const { rows, cols } = gridShape(input.shots.length);
	const cells = rows * cols;
	const lines = input.shots.map((shot, i) => `Shot ${i + 1}. ${(usable(shot.image_prompt) ? shot.image_prompt : shot.description).trim()}`);
	for (let i = input.shots.length; i < cells; i++) lines.push(`Shot ${i + 1}. A closer angle on the moment in shot ${((i - input.shots.length) % input.shots.length) + 1}.`);
	return [`Create a ${rows}x${cols} grid of ${WORDS[cells]} cinematic film stills from one scene.`, ...lines].join('\n');
}
