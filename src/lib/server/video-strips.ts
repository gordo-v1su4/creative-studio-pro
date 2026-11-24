import { dirname, join } from 'node:path';
import { STRIP_FRAMES, STRIP_TILE_WIDTH } from '$lib/media/strips';
import { derivedFile } from './derived-file';
import { runFfmpeg } from './ffmpeg';
import { probeMedia } from './media-probe';
import { proxyCacheDir, videoProxy } from './video-proxies';

/**
 * Frame strips (see $lib/media/strips): STRIP_FRAMES small frames of a video take in one JPEG row, evenly
 * spread over its length. Read from the 480p proxy so a strip costs a fraction of decoding the original.
 * Made when a take arrives and, for older takes, the first time one is asked for. One strip per video,
 * overwritten when the video changes (see derivedFile).
 */
export const stripCacheDir = (projectRoot: string) => join(dirname(projectRoot), 'video-strips');

// A screen of cards asks for its strips at once; ffmpeg runs a few at a time.
const LIMIT = 3;
let active = 0;
const queue: Array<() => void> = [];
async function limited<T>(work: () => Promise<T>): Promise<T> {
	if (active >= LIMIT) await new Promise<void>((resolve) => queue.push(resolve));
	active += 1;
	try { return await work(); }
	finally { active -= 1; queue.shift()?.(); }
}

/** The strip for a video file, made now if it is missing or out of date. */
export function videoStrip(file: string, projectRoot: string, cacheDir = stripCacheDir(projectRoot)): Promise<string> {
	return derivedFile(file, cacheDir, 'jpg', { frames: STRIP_FRAMES, width: STRIP_TILE_WIDTH }, (output) => limited(async () => {
		const input = await videoProxy(file, proxyCacheDir(projectRoot)).catch(() => file);
		const { duration_s } = await probeMedia(input);
		if (!duration_s) throw new Error('Could not read the length of this video');
		// One frame every length / STRIP_FRAMES seconds, starting on the first; the last tile repeats when a clip runs short.
		await runFfmpeg([
			'-y', '-v', 'error', '-i', input, '-an',
			'-vf', `fps=${STRIP_FRAMES}/${duration_s.toFixed(4)}:round=down,scale=${STRIP_TILE_WIDTH}:-2,tpad=stop_mode=clone:stop=${STRIP_FRAMES},tile=${STRIP_FRAMES}x1`,
			'-frames:v', '1', '-q:v', '6', output
		], 120_000);
	}));
}

/** Start a strip in the background (on ingest); a failure only means it is made on first request instead. */
export function prepareVideoStrip(file: string, projectRoot: string): void {
	void videoStrip(file, projectRoot).catch((cause) => console.warn(`Frame strip pending for ${file}: ${cause instanceof Error ? cause.message : cause}`));
}
