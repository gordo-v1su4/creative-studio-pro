import { readFile } from 'node:fs/promises';
import { derivedFile } from './derived-file';
import { runFfmpeg } from './ffmpeg';

/**
 * Poster stills for video takes: one small JPEG per file, the frame playback starts on (the first frame, or a
 * trimmed clip's in-point). The board shows these instead of downloading every clip for a single frame. One
 * poster per video, overwritten when the video or the frame changes (see derivedFile).
 */
const WIDTH = 640;

export async function videoPoster(file: string, cacheDir: string, at = 0): Promise<Buffer> {
	const target = await derivedFile(file, cacheDir, 'jpg', { at, width: WIDTH }, async (output) => {
		// Seek before the input (fast); a clip shorter than `at` falls back to its first frame.
		await runFfmpeg(['-y', '-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', `scale=${WIDTH}:-2`, '-q:v', '5', output], 30_000)
			.catch(() => runFfmpeg(['-y', '-v', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${WIDTH}:-2`, '-q:v', '5', output], 30_000));
	});
	return readFile(target);
}
