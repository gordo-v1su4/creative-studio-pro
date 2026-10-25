import { rendersAlone, specLine, type ShotSpec } from './shot-spec';

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
const WORDS: Record<number, string> = { 1: 'one', 4: 'four', 9: 'nine' };

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

// ---- Keyframes (V1S-376): from approved shot specs, 2×2 at 2K, wide shots alone ----

export interface KeyframeShot { card_id: string; title: string; spec: ShotSpec }

/** Up to four approved shots per 2×2 keyframe, in story order; a wide shot renders alone (it loses identity in a grid). */
export function keyframeChunks<T extends { spec: ShotSpec }>(shots: T[]): T[][] {
	const chunks: T[][] = [];
	let run: T[] = [];
	for (const shot of shots) {
		if (rendersAlone(shot.spec)) { if (run.length) chunks.push(run); run = []; chunks.push([shot]); continue; }
		run.push(shot);
		if (run.length === 4) { chunks.push(run); run = []; }
	}
	if (run.length) chunks.push(run);
	return chunks;
}

/** A keyframe's layout: 2×2 for a run of shots, 1×1 for a shot that renders alone. Either way a 16:9 frame. */
export const keyframeShape = (shots: number) => (shots === 1 ? { rows: 1, cols: 1 } : { rows: 2, cols: 2 });

/** The ONE SHOT spine every still holds (oneshot-image-prompts: photoreal, practical, photographed). */
const REALISM = 'Photoreal live-action film stills: real lenses, real skin texture and pores, real fabric, practical light, fine film grain; not a 3D render, not a video game, not illustration, no text, no watermark.';

/**
 * The keyframe prompt, written from the approved specs to the ONE SHOT standard: one plain opener, the series
 * look stated once, each panel as framing → action → place → light → camera, then the identity locks. People,
 * places and props stay as @handles here; the send compiles them to exact names and `image N` tags. Same specs,
 * same bytes, so an approval stays valid until a spec changes.
 */
export function keyframePrompt(input: { scene: string; look: string; shots: KeyframeShot[] }): string {
	const { rows, cols } = keyframeShape(input.shots.length);
	const cells = rows * cols;
	const panel = (spec: ShotSpec) => [specLine(spec), spec.location ? `In ${spec.location}.` : '', spec.light ? `${spec.light[0].toUpperCase()}${spec.light.slice(1)}.` : '', spec.camera_move ? `The frame at the start of: ${spec.camera_move}.` : ''].filter(Boolean).join(' ');
	const lines = input.shots.map((shot, i) => `Panel ${i + 1}. ${panel(shot.spec)}`);
	for (let i = input.shots.length; i < cells; i++) lines.push(`Panel ${i + 1}. A closer angle on the moment in panel ${((i - input.shots.length) % input.shots.length) + 1}.`);
	const opener = cells === 1 ? `Create one cinematic 16:9 film still from the scene "${input.scene}".` : `Create a ${rows}x${cols} grid of ${WORDS[cells] ?? cells} cinematic 16:9 film stills from the scene "${input.scene}", one moment per panel, in story order.`;
	return [opener, input.look.trim(), ...lines, REALISM, 'LOCKS: every person keeps the same face, hair and costume in every panel; every place keeps the same architecture and light; no extra characters.'].filter(Boolean).join('\n');
}

/** The season story's "Look:" line (the series look, stated once per keyframe). */
export const lookLine = (story: string) => story.split('\n').map((line) => line.trim()).find((line) => /^Look:/i.test(line))?.replace(/^Look:\s*/i, 'Look: ') ?? '';

/** QC on a compiled keyframe prompt: every handle swapped, every attached reference named exactly, no banned word. */
export function keyframeQc(prompt: string, attachedNames: string[], banned: string[] = []): string[] {
	const out: string[] = [];
	for (const handle of new Set(prompt.match(/@(?!Image[ _]?\d)[A-Za-z][\w-]*/g) ?? [])) out.push(`${handle} is not a reference of this series`);
	for (const name of attachedNames) if (!name.startsWith('the last frame') && !prompt.includes(name)) out.push(`"${name}" is attached but never named`);
	for (const word of ['neon', ...banned]) if (word && new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(prompt)) out.push(`uses the banned word "${word}"`);
	return out;
}
