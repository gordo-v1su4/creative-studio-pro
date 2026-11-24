import { expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRenderProviders, describeProviders, RenderProviderError, type RenderRequest } from '../../src/lib/server/render-providers';
import { createHiggsfieldProvider, readBackOf } from '../../src/lib/server/render-providers/higgsfield';
import { createFalProvider, falApp, FAL_IMAGE_TO_VIDEO, FAL_REFERENCE_TO_VIDEO } from '../../src/lib/server/render-providers/fal';

const STILL = '11111111-1111-4111-8111-111111111111';
const SHEET = '22222222-2222-4222-8222-222222222222';
const request: RenderRequest = { model: 'seedance_2_5', prompt: '@Image_1 walks "home".\nSlowly.', duration_s: 6, resolution: '480p', generate_audio: true, still: { media_id: STILL }, references: [{ media_id: SHEET }] };

/** A CLI that records every call and answers by the first two words. */
function fakeCli(answers: Record<string, unknown>) {
	const calls: string[][] = [];
	const prompts: string[] = [];
	const run = async (args: string[]) => {
		calls.push(args);
		const at = args.indexOf('--prompt');
		if (at >= 0) prompts.push(JSON.parse(await readFile(args[at + 1].slice(1), 'utf8')));
		const answer = answers[`${args[0]} ${args[1]}`];
		if (answer instanceof Error) throw answer;
		return answer;
	};
	return { run, calls, prompts };
}

// ── Higgsfield ───────────────────────────────────────────────────────────

test('Higgsfield never sends draft, and sends an earlier job\'s media again by id', async () => {
	const cli = fakeCli({ 'generate create': { id: 'job-2' } });
	const sent = await createHiggsfieldProvider(cli.run).send(request);
	expect(sent).toEqual({ job_id: 'job-2', answer_code: 'queued' });
	const args = cli.calls.at(-1)!;
	expect(args.join(' ')).not.toContain('draft');
	expect(args.slice(0, 3)).toEqual(['generate', 'create', 'seedance_2_5']);
	expect(args.slice(args.indexOf('--duration'))).toEqual(['--duration', '6', '--resolution', '480p', '--generate_audio', 'true', '--mode', 'omni_reference', '--start-image', STILL, '--image-references', SHEET]);
	// the prompt travels in a file, so quotes, line breaks and a leading @ survive
	expect(cli.prompts).toEqual([request.prompt]);
	// nothing was uploaded: both were ids already
	expect(cli.calls.filter((call) => call[0] === 'upload')).toEqual([]);
});

test('Higgsfield prices in credits without uploading anything, at each resolution', async () => {
	const cli = fakeCli({ 'generate cost': { credits: 18 } });
	const provider = createHiggsfieldProvider(cli.run);
	expect(provider.resolutions).toEqual(['480p', '720p', '1080p']);
	expect(await provider.price({ ...request, still: { path: '/tmp/still.png' }, resolution: '1080p' })).toEqual({ amount: 18, unit: 'credits' });
	const args = cli.calls[0];
	expect(args).toContain('1080p');
	expect(args.join(' ')).not.toMatch(/still\.png|draft|start-image/);
});

test("Higgsfield's status word is the answer code, and nsfw is a refusal", async () => {
	const check = async (job: unknown) => createHiggsfieldProvider(fakeCli({ 'generate get': job }).run).check({ job_id: 'job-2', model: 'seedance_2_5' });
	expect(await check({ status: 'completed', result_url: 'https://cdn/x.mp4' })).toEqual({ state: 'done', url: 'https://cdn/x.mp4', answer_code: 'completed' });
	expect(await check({ status: 'nsfw' })).toEqual({ state: 'refused', answer_code: 'nsfw' });
	expect(await check({ status: 'failed', error: 'Out of credits' })).toEqual({ state: 'failed', error: 'Out of credits', answer_code: 'failed' });
	expect(await check({ status: 'in_progress' })).toEqual({ state: 'rendering', answer_code: 'in_progress' });
	expect(await check({ status: 'queued' })).toEqual({ state: 'queued', answer_code: 'queued' });
});

test('an earlier Higgsfield job is read back with its still and references by role', () => {
	const job = { job_type: 'seedance_2_5', params: { prompt: 'Before.', duration: 13, resolution: '480p', generate_audio: true, aspect_ratio: '9:16', draft: true, seed: 1,
		medias: [{ role: 'start_image', data: { id: STILL, type: 'image_job', url: 'https://x' } }, { role: 'image', data: { id: SHEET, type: 'upload' } }] } };
	expect(readBackOf(job)).toEqual({ model: 'seedance_2_5', prompt: 'Before.', duration_s: 13, resolution: '480p', generate_audio: true, aspect_ratio: '9:16', still: { media_id: STILL, role: 'start_image' }, references: [{ media_id: SHEET, role: 'image' }] });
	expect(() => readBackOf({ job_type: 'seedance_2_5', params: {} })).toThrow('Higgsfield kept no request for this job');
});

test('Higgsfield without its CLI is listed as not set up, with the reason', async () => {
	const none = createHiggsfieldProvider(null);
	expect(await none.setup()).toEqual({ ready: false, reason: 'The Higgsfield CLI is not installed here' });
	expect(none.price(request)).rejects.toThrow('The Higgsfield CLI is not installed here');
	const signedOut = await createHiggsfieldProvider(fakeCli({ 'account status': new Error('not logged in') }).run).setup();
	expect(signedOut).toEqual({ ready: false, reason: 'The Higgsfield CLI is not signed in (not logged in)' });
});

// ── fal.ai ───────────────────────────────────────────────────────────────

function fakeFetch(answer: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
	const calls: Array<{ url: string; method: string; auth: string; body: unknown }> = [];
	const fetcher = async (url: string, init?: RequestInit) => {
		calls.push({ url, method: init?.method ?? 'GET', auth: (init?.headers as Record<string, string>)?.Authorization, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		const { status, body } = answer(url, init);
		return new Response(JSON.stringify(body), { status });
	};
	return { fetcher, calls };
}

test('fal.ai is not set up until its key is given, and SwarmUI never is', async () => {
	const info = await describeProviders(createRenderProviders({ higgsfield: null, falKey: ' ' }));
	expect(info.map((entry) => [entry.id, entry.setup])).toEqual([
		['higgsfield', { ready: false, reason: 'The Higgsfield CLI is not installed here' }],
		['fal', { ready: false, reason: 'FAL_KEY is not set' }],
		['swarmui', { ready: false, reason: 'Not connected yet' }]
	]);
	expect(info.map((entry) => [entry.can_cancel, entry.can_reuse])).toEqual([[false, true], [true, false], [false, false]]);
	// the still models are listed and connected to nothing
	expect(info[1].models.filter((model) => !model.wired).map((model) => model.id)).toEqual(['fal-ai/nano-banana-pro', 'openai/gpt-image-2']);
	expect(createFalProvider(null).send(request)).rejects.toThrow('FAL_KEY is not set');
});

test('fal.ai prices in dollars from its pricing address', async () => {
	const perSecond = fakeFetch(() => ({ status: 200, body: { prices: [{ endpoint_id: FAL_IMAGE_TO_VIDEO, unit_price: 0.14, unit: 'second', currency: 'USD' }], next_cursor: null, has_more: false } }));
	expect(await createFalProvider('k', perSecond.fetcher).price({ ...request, references: [] })).toEqual({ amount: 0.84, unit: 'usd' });
	expect(perSecond.calls[0]).toMatchObject({ url: `https://api.fal.ai/v1/models/pricing?endpoint_id=${encodeURIComponent(FAL_IMAGE_TO_VIDEO)}`, method: 'GET', auth: 'Key k' });
	const odd = fakeFetch(() => ({ status: 200, body: { prices: [{ endpoint_id: FAL_REFERENCE_TO_VIDEO, unit_price: 2, unit: 'megapixel', currency: 'USD' }] } }));
	expect(createFalProvider('k', odd.fetcher).price(request)).rejects.toThrow('fal.ai prices this per "megapixel"');
});

test('fal.ai sends through its queue and keeps the HTTP status as the answer code', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'csp-fal-'));
	const still = join(dir, 'still.png');
	await writeFile(still, Buffer.from([1, 2, 3]));
	const queue = fakeFetch(() => ({ status: 200, body: { request_id: 'req-1', status_url: 'x', response_url: 'y', cancel_url: 'z', queue_position: 0 } }));
	const provider = createFalProvider('k', queue.fetcher);
	expect(await provider.send({ ...request, still: { path: still }, references: [] })).toEqual({ job_id: 'req-1', answer_code: 200 });
	expect(queue.calls[0]).toEqual({ url: `https://queue.fal.run/${FAL_IMAGE_TO_VIDEO}`, method: 'POST', auth: 'Key k', body: { prompt: request.prompt, duration: '6', resolution: '480p', generate_audio: true, image_url: 'data:image/png;base64,AQID' } });
	// with references it is reference-to-video, and the still leads the images
	await provider.send({ ...request, still: { path: still }, references: [{ url: 'https://cdn/sheet.png' }] });
	expect(queue.calls[1].url).toBe(`https://queue.fal.run/${FAL_REFERENCE_TO_VIDEO}`);
	expect(queue.calls[1].body).toMatchObject({ task: 'reference', image_urls: ['data:image/png;base64,AQID', 'https://cdn/sheet.png'] });
	// an id from Higgsfield means nothing to fal
	expect(provider.send(request)).rejects.toThrow('fal.ai needs the file itself');
});

test('a refusal from fal.ai carries its status and its reason', async () => {
	const refused = fakeFetch(() => ({ status: 422, body: { detail: 'image_url is not reachable' } }));
	const error = await createFalProvider('k', refused.fetcher).send({ ...request, still: { url: 'https://x/y.png' }, references: [] }).catch((cause) => cause);
	expect(error).toBeInstanceOf(RenderProviderError);
	expect([error.answer_code, error.message]).toEqual([422, 'fal.ai answered 422: image_url is not reachable']);
});

test('fal.ai is checked and cancelled under its owner and app only', async () => {
	expect(falApp(FAL_IMAGE_TO_VIDEO)).toBe('bytedance/seedance-2.5');
	const base = 'https://queue.fal.run/bytedance/seedance-2.5/requests/req-1';
	const job = { job_id: 'req-1', model: 'seedance_2_5' };
	const run = (status: unknown, result: { status: number; body: unknown } = { status: 200, body: { video: { url: 'https://v3b.fal.media/x.mp4' }, seed: 1 } }) =>
		fakeFetch((url) => (url.endsWith('/status') ? { status: 200, body: status } : url.endsWith('/cancel') ? { status: 202, body: { status: 'CANCELLATION_REQUESTED' } } : result));
	const waiting = run({ status: 'IN_QUEUE', queue_position: 2 });
	expect(await createFalProvider('k', waiting.fetcher).check(job)).toEqual({ state: 'queued', answer_code: 200 });
	expect(waiting.calls.map((call) => call.url)).toEqual([`${base}/status`]);
	expect(await createFalProvider('k', run({ status: 'IN_PROGRESS' }).fetcher).check(job)).toEqual({ state: 'rendering', answer_code: 200 });
	const done = run({ status: 'COMPLETED' });
	expect(await createFalProvider('k', done.fetcher).check(job)).toEqual({ state: 'done', url: 'https://v3b.fal.media/x.mp4', answer_code: 200 });
	expect(done.calls.map((call) => call.url)).toEqual([`${base}/status`, base]);
	const failed = run({ status: 'COMPLETED', error: 'Runner disconnected', error_type: 'runner_disconnected' }, { status: 503, body: { detail: 'Runner disconnected' } });
	expect(await createFalProvider('k', failed.fetcher).check(job)).toEqual({ state: 'failed', error: 'Runner disconnected', answer_code: 503 });
	const policy = run({ status: 'COMPLETED', error: 'Blocked by content policy', error_type: 'content_policy_violation' }, { status: 422, body: {} });
	expect((await createFalProvider('k', policy.fetcher).check(job)).state).toBe('refused');
	// 202 means "asked to stop": it may still finish, so it is not reported as cancelled
	const cancel = run({});
	expect(await createFalProvider('k', cancel.fetcher).cancel!(job)).toEqual({ cancelled: false, answer_code: 202 });
	expect(cancel.calls[0]).toMatchObject({ url: `${base}/cancel`, method: 'PUT' });
});
