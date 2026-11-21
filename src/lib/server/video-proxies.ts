import { createHash } from 'node:crypto';
import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runFfmpeg } from './ffmpeg';

/**
 * Editing proxies: a 480p H.264 copy of each video take for the board, the sequence player and cut previews,
 * so the browser decodes a few MB instead of the 1080p original. Export and Review Room keep using the
 * originals. Proxies are made when a take arrives and, for older takes, the first time one is asked for; they
 * live in a disposable cache beside the project root, keyed by the original's path, size and time.
 *
 * Same frame rate and timing as the source (no fps change), a keyframe every 12 frames for quick seeking,
 * the moov atom up front, and the audio kept so the sequence player can play sound from the proxy.
 */
export const PROXY_HEIGHT = 480;
const inFlight = new Map<string, Promise<string>>();

export const proxyCacheDir = (projectRoot: string) => join(dirname(projectRoot), 'video-proxies');

async function proxyPath(file: string, cacheDir: string): Promise<string> {
	const info = await stat(file);
	const key = createHash('sha256').update(`${file}|${info.size}|${info.mtimeMs}|${PROXY_HEIGHT}`).digest('hex');
	return join(cacheDir, key.slice(0, 2), `${key}.mp4`);
}

/** The proxy for a video file, made now if it does not exist yet. */
export async function videoProxy(file: string, cacheDir: string): Promise<string> {
	const target = await proxyPath(file, cacheDir);
	if (await stat(target).then(() => true, () => false)) return target;
	let pending = inFlight.get(target);
	if (!pending) {
		pending = (async () => {
			await mkdir(dirname(target), { recursive: true });
			const partial = `${target}.${process.pid}.tmp.mp4`;
			await runFfmpeg([
				'-y', '-v', 'error', '-i', file,
				'-map', '0:v:0', '-map', '0:a:0?',
				'-vf', `scale=-2:'min(${PROXY_HEIGHT},ih)'`,
				'-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-g', '12', '-keyint_min', '12', '-sc_threshold', '0',
				'-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', partial
			], 300_000);
			await rename(partial, target);
			return target;
		})().finally(() => inFlight.delete(target));
		inFlight.set(target, pending);
	}
	return pending;
}

/** Start a proxy in the background (on ingest); a failure only means it is made on first request instead. */
export function prepareVideoProxy(file: string, projectRoot: string): void {
	void videoProxy(file, proxyCacheDir(projectRoot)).catch((cause) => console.warn(`Proxy pending for ${file}: ${cause instanceof Error ? cause.message : cause}`));
}
