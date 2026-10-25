/**
 * Shot spec (V1S-375, glossary: Shot spec): the fields a shot is written as. Ghost proposes a scene's coverage as
 * shot specs; the operator approves them; only then are the image and video prompts written from them. Subjects,
 * place and action name referenced people, places and props by @handle; code swaps them for exact names.
 */

import { z } from 'zod';

export const SHOT_SIZES = ['ECU', 'CU', 'MCU', 'MS', 'WS'] as const;
export const SIZE_WORDS: Record<(typeof SHOT_SIZES)[number], string> = {
	ECU: 'Extreme close-up',
	CU: 'Close-up',
	MCU: 'Medium close-up',
	MS: 'Medium shot',
	WS: 'Wide shot'
};
/** Seedance 2.5 renders 4 s and up; Ghost keeps one prompt to 15 s or less. */
export const SPEC_MIN_S = 4;
export const SPEC_MAX_S = 15;

export const shotSpecSchema = z.object({
	size: z.enum(SHOT_SIZES),
	/** e.g. "eye level", "low angle", "over the shoulder of @Kai". */
	angle: z.string().trim().max(200).default('eye level'),
	/** Who is in frame, by @handle where they have a reference, else by exact name. */
	subjects: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
	/** One or two sentences: what happens, in order, one action per beat. */
	action: z.string().trim().min(1).max(1500),
	/** The scene's scripted lines this shot speaks, verbatim, one per line as `SPEAKER (delivery): "line"`; empty when silent. */
	dialogue: z.string().trim().max(2000).default(''),
	/** The place, by @handle when it has a reference. */
	location: z.string().trim().max(300).default(''),
	/** Time and light; night unless the scene says otherwise. */
	light: z.string().trim().max(300).default('night'),
	/** The camera move and its physical reason, e.g. "slow push in as she reads". */
	camera_move: z.string().trim().max(300).default(''),
	duration_s: z.number().min(SPEC_MIN_S).max(SPEC_MAX_S)
});
export type ShotSpec = z.infer<typeof shotSpecSchema>;

/** Wide shots lose identity inside a grid: they render alone. */
export const rendersAlone = (spec: Pick<ShotSpec, 'size'>) => spec.size === 'WS';

/** One line for the board card and the keyframe: "MCU, low angle — @Kai looks up from his phone." */
export const specLine = (spec: ShotSpec) => `${SIZE_WORDS[spec.size]}, ${spec.angle || 'eye level'} — ${spec.action}`;

/** All of a spec's text, for the reference and dialogue checks. */
export const specText = (spec: ShotSpec) => [spec.subjects.join(' '), spec.action, spec.location, spec.camera_move, spec.dialogue].filter(Boolean).join('\n');

/** The keyframe line for a shot until V1S-376 writes its 2×2 prompt: framing, action, place, light. */
export const keyframeOf = (spec: ShotSpec) => [specLine(spec), spec.location ? `In ${spec.location}.` : '', spec.light ? `${spec.light[0].toUpperCase()}${spec.light.slice(1)}.` : ''].filter(Boolean).join(' ');

/** What a proposed shot's video prompt says until its spec is approved and Ghost writes it. */
export const PROMPT_PENDING = 'Written by Ghost once this shot spec is approved.';
