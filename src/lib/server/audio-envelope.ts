import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { onsetEnvelope } from '$lib/domain/music';

const RATE = 8000;
const cache = new Map<string, number[] | null>();

/**
 * A local file's audio as an onset envelope (mono, 8 kHz, 10 ms hops), cached
 * per file version. Null when the file has no audio track.
 */
export async function readOnsetEnvelope(file: string): Promise<number[] | null> {
	const info = await stat(file);
	const key = `${file}|${info.size}|${info.mtimeMs}`;
	if (cache.has(key)) return cache.get(key)!;
	const raw = await new Promise<Buffer | null>((resolve, reject) => {
		execFile('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { encoding: 'buffer', timeout: 120_000, maxBuffer: 512 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
			const message = stderr.toString();
			// A video with no audio track: nothing to decode, not a failure.
			if (error && /does not contain any stream|Output file .* does not contain|matches no streams/i.test(message)) resolve(null);
			else if (error) reject(new Error(`ffmpeg failed: ${(message || error.message).trim().split('\n').slice(-2).join(' ')}`));
			else resolve(stdout.length ? stdout : null);
		});
	});
	const envelope = raw ? onsetEnvelope(new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4)), RATE) : null;
	cache.set(key, envelope);
	return envelope;
}
