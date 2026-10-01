import { execFile } from 'node:child_process';

/** Thin runner for render plans: ffmpeg on PATH with the plan's arguments. Rejects with ffmpeg's error text. */
export function runFfmpeg(args: string[], timeoutMs = 120_000): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile('ffmpeg', args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, _stdout, stderr) => {
			if (error) reject(new Error(`ffmpeg failed: ${(stderr || error.message).trim().split('\n').slice(-3).join(' ')}`));
			else resolve();
		});
	});
}
