import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSplitter } from '../../src/lib/server/splitter';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('splitter client (fake service)', () => {
	test('unlocks with the PIN, sends the video, polls, reads the manifest and downloads a clip with the session cookie', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-split-')); roots.push(root);
		const file = join(root, 'trailer.mp4');
		await writeFile(file, new Uint8Array([1, 2, 3]));
		const calls: string[] = [];
		let polls = 0;
		const fake = (async (url: string, init?: RequestInit) => {
			const path = url.replace('https://split.example', '');
			const cookie = (init?.headers as Record<string, string> | undefined)?.cookie;
			calls.push(`${init?.method ?? 'GET'} ${path}${cookie ? ' +cookie' : ''}`);
			if (path === '/api/access-gate' && !init?.method) return Response.json({ required: true, unlocked: false });
			if (path === '/api/access-gate') {
				expect(JSON.parse(String(init!.body))).toEqual({ pin: '1234' });
				return new Response('{}', { headers: { 'set-cookie': 'splitter_access=tok; Path=/; HttpOnly' } });
			}
			if (path === '/api/jobs') return Response.json({ job: { job_id: 'job42' } });
			if (path === '/api/jobs/job42') return Response.json({ status: ++polls < 2 ? 'processing' : 'completed', stage: 'detecting' });
			if (path === '/api/jobs/job42/result') return Response.json({ manifest: { job_id: 'job42', frame_rate: 24, segments: [{ index: 1, start_seconds: 0, end_seconds: 2, duration_seconds: 2, clip_path: 'clips/seg 1.mp4' }] } });
			if (path === '/api/jobs/job42/assets/clips/seg%201.mp4') return new Response(new Uint8Array([9, 9]));
			return new Response('nope', { status: 404 });
		}) as typeof fetch;
		const splitter = createSplitter({ url: 'https://split.example/', pin: '1234', fetch: fake, wait: async () => {} });
		const { manifest, download } = await splitter.split(file);
		expect(manifest.segments).toHaveLength(1);
		expect([...await download('clips/seg 1.mp4')]).toEqual([9, 9]);
		expect(calls).toEqual(['GET /api/access-gate', 'POST /api/access-gate', 'POST /api/jobs +cookie', 'GET /api/jobs/job42 +cookie', 'GET /api/jobs/job42 +cookie', 'GET /api/jobs/job42/result +cookie', 'GET /api/jobs/job42/assets/clips/seg%201.mp4 +cookie']);
	});

	test('without the PIN it says so instead of failing obscurely', async () => {
		const fake = (async () => Response.json({ required: true })) as unknown as typeof fetch;
		await expect(createSplitter({ url: 'https://s.example', pin: null, fetch: fake }).split('x.mp4')).rejects.toThrow('SPLITTER_APP_ACCESS_PIN');
	});
});
