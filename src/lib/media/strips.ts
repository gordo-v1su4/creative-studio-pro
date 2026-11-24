/**
 * Frame strips: one low-res picture per video take holding STRIP_FRAMES frames side by side, evenly spread
 * over the whole file. Hover-scrub on a shot card and the viewer's frame lane and hover preview read it, so
 * moving the pointer shows a frame without decoding or seeking any video.
 */
export const STRIP_FRAMES = 24;
/** Width of one frame in the strip, in pixels; its height follows the video's shape. */
export const STRIP_TILE_WIDTH = 160;

/** Which frame of the strip stands for `seconds` into a file `duration` seconds long. */
export function stripIndex(seconds: number, duration: number): number {
	if (!(duration > 0) || !(seconds > 0)) return 0;
	return Math.min(STRIP_FRAMES - 1, Math.floor((seconds / duration) * STRIP_FRAMES));
}

/** The frame for a pointer `fraction` of the way across a take's kept span (its in to its out; the whole file when untrimmed). */
export function stripIndexInSpan(fraction: number, duration: number | null | undefined, inS?: number | null, outS?: number | null): number {
	const along = Math.min(1, Math.max(0, fraction));
	if (!duration || !(duration > 0)) return Math.min(STRIP_FRAMES - 1, Math.floor(along * STRIP_FRAMES));
	const from = Math.min(duration, Math.max(0, inS ?? 0));
	const to = Math.min(duration, Math.max(from, outS ?? duration));
	return stripIndex(from + along * (to - from), duration);
}

/** CSS that shows one frame of the strip as the whole background of an element shaped like the video. */
export function stripFrameStyle(url: string, index: number): string {
	const at = Math.min(STRIP_FRAMES - 1, Math.max(0, Math.round(index)));
	return `background-image: url("${url}"); background-size: ${STRIP_FRAMES * 100}% 100%; background-position: ${(at / (STRIP_FRAMES - 1)) * 100}% 0;`;
}

/** The frames a lane `count` tiles wide shows: evenly spread, first to last. */
export function laneFrames(count: number): number[] {
	const tiles = Math.max(1, Math.min(STRIP_FRAMES, Math.floor(count)));
	return Array.from({ length: tiles }, (_, i) => (tiles === 1 ? 0 : Math.round((i / (tiles - 1)) * (STRIP_FRAMES - 1))));
}

// Strips are fetched ahead for the cards on screen, a few at a time, so the first hover does not wait.
const warmed = new Set<string>();
const waiting: string[] = [];
let running = 0;

function next() {
	while (running < 3 && waiting.length) {
		const url = waiting.shift()!;
		running += 1;
		const image = new Image();
		image.onload = image.onerror = () => { running -= 1; next(); };
		image.src = url;
	}
}

export function warmStrip(url: string | null): void {
	if (!url || warmed.has(url) || typeof Image === 'undefined') return;
	warmed.add(url);
	waiting.push(url);
	next();
}
