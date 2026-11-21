import { expect, test } from 'bun:test';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { videoProxy } from '../../src/lib/server/video-proxies';
import { videoPoster } from '../../src/lib/server/video-posters';
import { proxyUrl, posterUrl } from '../../src/lib/media/gpu/clipBanks';

test('a 1080p clip gets a 480p proxy (same length) and a small poster, both cached', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'csp-proxy-'));
	const source = join(dir, 'take.mp4');
	execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=24:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', source]);
	const proxy = await videoProxy(source, join(dir, 'cache'));
	const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,height:format=duration', '-of', 'json', proxy]).toString());
	expect(probe.streams.find((s: { codec_type: string }) => s.codec_type === 'video').height).toBe(480);
	expect(probe.streams.some((s: { codec_type: string }) => s.codec_type === 'audio')).toBe(true);
	expect(Math.abs(Number(probe.format.duration) - 2)).toBeLessThan(0.1);
	expect(await videoProxy(source, join(dir, 'cache'))).toBe(proxy);
	const poster = await videoPoster(source, join(dir, 'posters'));
	expect(poster.byteLength).toBeLessThan((await stat(source)).size);
	expect(poster[0]).toBe(0xff);
});

test('only project video files get proxy and poster URLs', () => {
	expect(proxyUrl('/api/projects/p1/files/board/a.mp4')).toBe('/api/projects/p1/files/board/a.mp4?proxy=1');
	expect(proxyUrl('/api/projects/p1/files/board/a.mp4?v=2')).toBe('/api/projects/p1/files/board/a.mp4?v=2&proxy=1');
	expect(posterUrl('/api/projects/p1/files/board/a.mp4')).toBe('/api/projects/p1/files/board/a.mp4?poster=1');
	expect(proxyUrl('blob:abc')).toBe('blob:abc');
	expect(posterUrl('/api/projects/p1/files/board/a.png')).toBeNull();
});
