import { dirname, join } from 'node:path';
import { derivedFile } from './derived-file';
import { runFfmpeg } from './ffmpeg';

/**
 * Editing proxies: a 480p H.264 copy of each video take for the board, the sequence player and cut previews,
 * so the browser decodes a few MB instead of the 1080p original. Export and Review Room keep using the
 * originals. Made when a take arrives and, for older takes, the first time one is asked for. One proxy per
 * video, overwritten when the video changes (see derivedFile).
 *
 * Same frame rate and timing as the source (no fps change), a keyframe every 12 frames for quick seeking,
 * the moov atom up front, and the audio kept so the sequence player can play sound from the proxy.
 */
export const PROXY_HEIGHT = 480;

export const proxyCacheDir = (projectRoot: string) => join(dirname(projectRoot), 'video-proxies');

/** The proxy for a video file, made now if it is missing or out of date. */
export function videoProxy(file: string, cacheDir: string): Promise<string> {
	return derivedFile(file, cacheDir, 'mp4', { height: PROXY_HEIGHT }, (output) => runFfmpeg([
		'-y', '-v', 'error', '-i', file,
		'-map', '0:v:0', '-map', '0:a:0?',
		'-vf', `scale=-2:'min(${PROXY_HEIGHT},ih)'`,
		'-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-g', '12', '-keyint_min', '12', '-sc_threshold', '0',
		'-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', output
	], 300_000));
}

/** Start a proxy in the background (on ingest); a failure only means it is made on first request instead. */
export function prepareVideoProxy(file: string, projectRoot: string): void {
	void videoProxy(file, proxyCacheDir(projectRoot)).catch((cause) => console.warn(`Proxy pending for ${file}: ${cause instanceof Error ? cause.message : cause}`));
}
