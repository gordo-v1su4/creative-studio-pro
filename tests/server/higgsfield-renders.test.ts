import { describe, expect, test } from 'bun:test';
import { getRender, listRenders, renderFileName, renderOf } from '../../src/lib/server/higgsfield-renders';

const job = (extra: Record<string, unknown> = {}) => ({
	id: 'd91143db-d868-43f6-b3e9-4560f1778c9f', display_name: 'Seedance 2.5', job_type: 'seedance_2_5', status: 'completed', created_at: '2026-10-30T19:25:02Z',
	result_url: 'https://d8j0ntlcm91z4.cloudfront.net/u/hf_20261030_192502_d91143db.mp4', thumbnail_url: 'https://cdn.higgsfield.ai/u/thumb.webp',
	params: { prompt: 'A neon alley at night.', duration: 8, aspect_ratio: '16:9', height: 720 }, ...extra
});

describe('Higgsfield renders', () => {
	test('a finished job becomes a render with its kind, model, prompt and length', () => {
		expect(renderOf(job())).toEqual({
			job_id: 'd91143db-d868-43f6-b3e9-4560f1778c9f', kind: 'video', model: 'Seedance 2.5', created_at: '2026-10-30T19:25:02Z', prompt: 'A neon alley at night.',
			duration_s: 8, aspect_ratio: '16:9', resolution: '720p', thumbnail_url: 'https://cdn.higgsfield.ai/u/thumb.webp', result_url: 'https://d8j0ntlcm91z4.cloudfront.net/u/hf_20261030_192502_d91143db.mp4'
		});
		expect(renderOf(job({ result_url: 'https://cdn.higgsfield.ai/u/still.png' }))?.kind).toBe('image');
	});

	test('unfinished, failed, fileless and non-https jobs are left out', () => {
		for (const extra of [{ status: 'in_progress' }, { status: 'failed' }, { result_url: null }, { result_url: 'http://x.example/a.mp4' }, { result_url: 'https://x.example/a.txt' }]) expect(renderOf(job(extra))).toBeNull();
		expect(renderOf('nope')).toBeNull();
	});

	test('list asks the CLI for the kind and size and keeps only finished renders of that kind', async () => {
		const calls: string[][] = [];
		const run = async (args: string[]) => { calls.push(args); return [job(), job({ id: 'x2', status: 'queued' }), job({ id: 'x3', result_url: 'https://cdn.higgsfield.ai/u/still.png' })]; };
		expect((await listRenders(run, 'video', 500)).map((r) => r.job_id)).toEqual(['d91143db-d868-43f6-b3e9-4560f1778c9f']);
		expect(calls).toEqual([['generate', 'list', '--video', '--size', '100']]);
		expect((await getRender(async () => job(), 'd91143db'))?.kind).toBe('video');
	});

	test('the file keeps the name Higgsfield gave it', () => {
		expect(renderFileName(renderOf(job())!)).toBe('hf_20261030_192502_d91143db.mp4');
	});
});
