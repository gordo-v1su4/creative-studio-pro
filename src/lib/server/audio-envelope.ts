import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { onsetEnvelope } from '$lib/domain/music';

/** Analysis sample rate: plenty for levels and onsets. */
export const PCM_RATE = 8000;
const pcmCache = new Map<string, Promise<Float32Array | null>>();

/**
 * A local file's audio as mono PCM at PCM_RATE, cached per file version.
 * Null when the file has no audio track.
 */
export async function readPcm(file: string): Promise<Float32Array | null> {
	const info = await stat(file);
	const key = `${file}|${info.size}|${info.mtimeMs}`;
	const hit = pcmCache.get(key);
	if (hit) return hit;
	const job = new Promise<Float32Array | null>((resolve, reject) => {
		execFile('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(PCM_RATE), '-f', 'f32le', '-'], { encoding: 'buffer', timeout: 120_000, maxBuffer: 512 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
			const message = stderr.toString();
			// A video with no audio track: nothing to decode, not a failure.
			if (error && /does not contain any stream|Output file .* does not contain|matches no streams/i.test(message)) resolve(null);
			else if (error) reject(new Error(`ffmpeg failed: ${(message || error.message).trim().split('\n').slice(-2).join(' ')}`));
			else resolve(stdout.length ? new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 4)) : null);
		});
	});
	pcmCache.set(key, job);
	job.catch(() => pcmCache.delete(key));
	return job;
}

/** A local file's audio as an onset envelope (see domain/music). Null when it has no audio track. */
export async function readOnsetEnvelope(file: string): Promise<number[] | null> {
	const pcm = await readPcm(file);
	return pcm ? onsetEnvelope(pcm, PCM_RATE) : null;
}
