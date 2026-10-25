/**
 * The QC that replaces the Seedance linter for prompts Ghost writes (V1S-375): what keeps identity (exact
 * names, every handle swapped, only declared references) plus Ghost's own final gate (the eleven sections in
 * order, the seconds and upload line, the no-music opener and closer, one clip of 15 s or less, timeline seconds
 * inside the clip). Deterministic, no LLM. Runs on the compiled prompt (handles already swapped).
 */

import { handlesIn, UPLOAD_LINE } from './handles';

export const GHOST_SECTIONS = ['SCENE + REALISM LOCK', 'REFERENCES', 'CHARACTERS', 'SPACE', 'FIRST FRAME', 'TIMELINE', 'PHYSICS', 'CAMERA', 'LIGHT / COLOUR', 'SOUND', 'LOCKS'] as const;
export const MUSIC_OPENER = 'No background music; generate only ambient sound, action sound and the specified dialogue.';
export const MUSIC_CLOSER = 'No music, no library audio, no voiceover.';
const MAX_CLIP_S = 15;

export interface GhostQcInput {
	/** The clip length the shot spec asked for. */
	duration_s: number;
	/** Exact names of the references attached, in image order. */
	references?: string[];
	/** Words the project bans (brief must-nots); "neon" is always banned. */
	banned?: string[];
}

/** A section heading at the start of a line, with or without numbering and Markdown bold. */
const sectionAt = (prompt: string, name: string) => {
	const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/\s+/g, '\\s*');
	return prompt.search(new RegExp(`^[\\s>*#\\d.)-]*\\**${escaped}\\**\\s*[:—–-]`, 'mi'));
};

export function ghostQc(prompt: string, input: GhostQcInput): string[] {
	const out: string[] = [];
	if (!prompt.trim()) return ['The prompt is empty'];
	const upload = prompt.match(UPLOAD_LINE);
	if (!upload) out.push('The seconds and upload line is missing ("6 s. Upload: image 1 = …")');
	else if (Number(upload[1]) > MAX_CLIP_S) out.push(`One prompt is one clip of ${MAX_CLIP_S} s or less; this one says ${upload[1]} s`);
	else if (Math.abs(Number(upload[1]) - input.duration_s) > 0.5) out.push(`The header says ${upload[1]} s but the shot is ${input.duration_s} s`);
	let last = -1;
	for (const name of GHOST_SECTIONS) {
		const at = sectionAt(prompt, name);
		if (at < 0) { out.push(`Ghost section missing: ${name}`); continue; }
		if (at < last) out.push(`Ghost section out of order: ${name}`);
		last = Math.max(last, at);
	}
	if (!prompt.includes(MUSIC_OPENER)) out.push(`The no-music opener is missing: "${MUSIC_OPENER}"`);
	if (!prompt.includes(MUSIC_CLOSER)) out.push(`The no-music closer is missing: "${MUSIC_CLOSER}"`);
	for (const handle of new Set(handlesIn(prompt))) out.push(`${handle} is not a reference of this series; use an exact name or a known handle`);
	if (/@Image[ _]?\d/i.test(prompt)) out.push('Write references the Ghost way ("image 1"), not "@Image_1"');
	const names = input.references ?? [];
	names.forEach((name, i) => {
		if (!prompt.includes(name)) out.push(`Image ${i + 1} is attached but its exact name "${name}" never appears`);
	});
	for (const m of prompt.matchAll(/\bimage (\d+)\b/gi)) if (Number(m[1]) > names.length) { out.push(`"image ${m[1]}" is named but only ${names.length} image${names.length === 1 ? ' is' : 's are'} attached`); break; }
	for (const m of prompt.matchAll(/(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*s\b/g)) if (Number(m[2]) > input.duration_s + 0.5) { out.push(`The timeline runs to ${m[2]} s, past the ${input.duration_s}-second clip`); break; }
	for (const word of ['neon', ...(input.banned ?? [])]) if (word && new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(prompt)) out.push(`The prompt uses the banned word "${word}"`);
	return out;
}
