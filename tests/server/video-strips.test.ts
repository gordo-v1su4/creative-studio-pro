import { expect, test } from 'bun:test';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { videoStrip } from '../../src/lib/server/video-strips';
import { STRIP_FRAMES, STRIP_TILE_WIDTH } from '../../src/lib/media/strips';

const size = (file: string) => {
	const { streams } = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', file]).toString());
	return { width: streams[0].width as number, height: streams[0].height as number };
};

test('a take gets one strip: every frame the same small size, side by side, made once', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'csp-strip-'));
	const source = join(dir, 'take.mp4');
	execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=3', '-c:v', 'libx264', source]);
	const strip = await videoStrip(source, join(dir, 'projects'));
	expect(size(strip)).toEqual({ width: STRIP_FRAMES * STRIP_TILE_WIDTH, height: 90 });
	expect(await videoStrip(source, join(dir, 'projects'))).toBe(strip);
	const made = (await readdir(join(dir, 'video-strips'), { recursive: true })).filter((name) => String(name).endsWith('.jpg'));
	expect(made).toHaveLength(1);
});

test('a clip with fewer frames than the strip still fills every tile', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'csp-strip-short-'));
	const source = join(dir, 'short.mp4');
	execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=0.5', '-c:v', 'libx264', source]);
	expect(size(await videoStrip(source, join(dir, 'projects'))).width).toBe(STRIP_FRAMES * STRIP_TILE_WIDTH);
});
