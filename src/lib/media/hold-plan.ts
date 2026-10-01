/**
 * Hold render plan (CONTEXT.md: Hold): a still held for a set length as a
 * video take, optionally with a slow push-in and/or a fade in and out.
 * Pure: inputs in, ffmpeg arguments out; a thin runner executes them.
 */

export interface HoldOptions {
	input: string;
	output: string;
	length_s: number;
	push_in: boolean;
	fade: boolean;
	/** The still's size, for the output aspect. */
	width: number;
	height: number;
}

export const HOLD_FPS = 30;
export const HOLD_LONG_EDGE = 1920;
export const HOLD_MIN_S = 0.5;
export const HOLD_MAX_S = 30;
/** How far the push-in moves over the whole hold. */
const PUSH_IN = 0.08;

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/** The output frame: the still's aspect with a 1920 px long edge. */
export function holdFrame(width: number, height: number): { width: number; height: number } {
	return width >= height
		? { width: HOLD_LONG_EDGE, height: even((HOLD_LONG_EDGE * height) / width) }
		: { width: even((HOLD_LONG_EDGE * width) / height), height: HOLD_LONG_EDGE };
}

export function holdPlan(options: HoldOptions): string[] {
	const length = Math.min(HOLD_MAX_S, Math.max(HOLD_MIN_S, options.length_s));
	const frames = Math.round(length * HOLD_FPS);
	const frame = holdFrame(options.width, options.height);
	const filters = options.push_in
		? [
				// zoompan steps in whole pixels; working at 4x keeps the slow push smooth.
				`scale=${frame.width * 4}:${frame.height * 4}:flags=lanczos`,
				`zoompan=z='1+${PUSH_IN}*on/${Math.max(1, frames - 1)}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${frame.width}x${frame.height}:fps=${HOLD_FPS}`
			]
		: [`scale=${frame.width}:${frame.height}:flags=lanczos`];
	if (options.fade) {
		const fade = Math.min(0.5, length / 4);
		filters.push(`fade=t=in:st=0:d=${fade}`, `fade=t=out:st=${+(length - fade).toFixed(3)}:d=${fade}`);
	}
	filters.push('setsar=1', 'format=yuv420p');
	return [
		'-hide_banner', '-loglevel', 'error', '-y',
		...(options.push_in ? [] : ['-loop', '1', '-framerate', String(HOLD_FPS)]),
		'-i', options.input,
		'-vf', filters.join(','),
		'-t', String(length),
		'-r', String(HOLD_FPS),
		'-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
		options.output
	];
}

/** A take name that says what the hold is. */
export function holdName(stillName: string, options: Pick<HoldOptions, 'length_s' | 'push_in' | 'fade'>): string {
	const extras = [options.push_in && 'push-in', options.fade && 'fade'].filter(Boolean).join(' + ');
	return `Hold ${+options.length_s.toFixed(2)}s${extras ? ` · ${extras}` : ''} · ${stillName}`;
}
