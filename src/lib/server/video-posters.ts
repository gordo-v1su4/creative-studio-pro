import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runFfmpeg } from './ffmpeg';

/**
 * Poster stills for video takes: one small JPEG per file, made once with ffmpeg and kept in a disposable cache
 * beside the project root. The board shows these instead of downloading every clip to decode a single frame;
 * the full clip loads only when a card is hovered. A changed file (size or time) gets a new poster.
 */
const WIDTH = 640;
const inFlight = new Map<string, Promise<Buffer>>();

export async function videoPoster(file: string, cacheDir: string, at = 0.3): Promise<Buffer> {
	const info = await stat(file);
	const key = createHash('sha256').update(`${file}|${info.size}|${info.mtimeMs}|${at}|${WIDTH}`).digest('hex');
	const target = join(cacheDir, key.slice(0, 2), `${key}.jpg`);
	const cached = await readFile(target).catch(() => null);
	if (cached) return cached;
	let pending = inFlight.get(key);
	if (!pending) {
		pending = (async () => {
			await mkdir(dirname(target), { recursive: true });
			const partial = `${target}.${process.pid}.tmp.jpg`;
			// Seek before the input (fast); a clip shorter than `at` falls back to its first frame.
			await runFfmpeg(['-y', '-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', `scale=${WIDTH}:-2`, '-q:v', '5', partial], 30_000)
				.catch(() => runFfmpeg(['-y', '-v', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${WIDTH}:-2`, '-q:v', '5', partial], 30_000));
			await rename(partial, target);
			return readFile(target);
		})().finally(() => inFlight.delete(key));
		inFlight.set(key, pending);
	}
	return pending;
}
