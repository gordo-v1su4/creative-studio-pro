import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { frameSignal, type FrameSignal } from '$lib/domain/trim-suggest';

/** Small enough to decode a 30 s take in a moment, large enough to see a flash or a repeated frame. */
const WIDTH = 64;
const HEIGHT = 36;

const cache = new Map<string, FrameSignal>();

function run(bin: string, args: string[], maxBuffer = 1024 * 1024): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		execFile(bin, args, { encoding: 'buffer', timeout: 120_000, maxBuffer, windowsHide: true }, (error, stdout, stderr) => {
			if (error) reject(new Error(`${bin} failed: ${(stderr.toString() || error.message).trim().split('\n').slice(-2).join(' ')}`));
			else resolve(stdout);
		});
	});
}

/** The take's frame rate, from ffprobe ("24/1", "30000/1001"). */
async function frameRate(file: string): Promise<number> {
	const out = (await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate,r_frame_rate', '-of', 'csv=p=0', file])).toString();
	for (const rate of out.trim().split(/[,\n]/)) {
		const [n, d] = rate.split('/').map(Number);
		if (n > 0 && d > 0) return n / d;
	}
	return 24;
}

/** Every decoded frame of a local video, tiny and grey, as frame differences (cached per file version). */
export async function readFrameSignal(file: string): Promise<FrameSignal> {
	const info = await stat(file);
	const key = `${file}|${info.size}|${info.mtimeMs}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const fps = await frameRate(file);
	const raw = await run('ffmpeg', ['-v', 'error', '-i', file, '-an', '-vf', `scale=${WIDTH}:${HEIGHT}:flags=area,format=gray`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-'], 256 * 1024 * 1024);
	const size = WIDTH * HEIGHT;
	const frames = Array.from({ length: Math.floor(raw.length / size) }, (_, k) => new Uint8Array(raw.buffer, raw.byteOffset + k * size, size));
	const signal = frameSignal(frames, fps);
	cache.set(key, signal);
	return signal;
}
