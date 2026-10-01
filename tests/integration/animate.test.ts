import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { animateGate, SEEDANCE_I2V } from '../../src/lib/domain/animate';
import { pickFor, takesFor } from '../../src/lib/domain/takes';
import { draftAnimatePrompt, pollGenerations, resetSessionSpend, sendAnimate, type AnimateDeps } from '../../src/lib/server/animate';
import { createHiggsfieldGenerator, type GenerationStatus, type VideoGenerator } from '../../src/lib/server/higgsfield';
import type { StoryCard } from '../../src/lib/domain/schemas';

const roots: string[] = [];
beforeEach(() => resetSessionSpend());
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const GOOD = 'Image_1 is Mara.\nCold open. Mara holds at the door in @Image_1, then a hard cut to Mara on the handle. Cut to the street, rain, a slow push.';
const settings = (prompt = GOOD) => ({ prompt, duration_s: 5, resolution: '480p' as const, generate_audio: true });

/** A generator that records every call and never touches the network. */
function fakeGenerator(usd = 0.5) {
	const calls: string[] = [];
	const statuses = new Map<string, { status: GenerationStatus; video_url?: string; error?: string }>();
	let n = 0;
	const generator: VideoGenerator = {
		async upload() { calls.push('upload'); return 'https://files.example/still.png'; },
		async estimate(model, body) { calls.push(`estimate ${model} ${body.duration}s ${body.resolution}`); return { credits: usd * 20, usd }; },
		async submit(model) { calls.push(`submit ${model}`); const id = `req-${++n}`; statuses.set(id, { status: 'queued' }); return { request_id: id }; },
		async status(id) { calls.push(`status ${id}`); return statuses.get(id)!; }
	};
	return { generator, calls, statuses };
}

async function setup(still: { width: number; height: number }, usd = 0.5) {
	const root = await mkdtemp(join(tmpdir(), 'csp-animate-')); roots.push(root);
	const store = new ProjectStore({ root });
	const gateway = new ProjectCommandGateway(store);
	const created = await gateway.createProject({ command: 'create_project', title: 'Animate', brief: '', creative_focus: 'full room', created_by: 'gordo' });
	if (!created.ok) throw new Error(created.error.message);
	const projectId = created.data.project_id;
	await mkdir(join(root, projectId, 'files', 'board'), { recursive: true });
	await writeFile(join(root, projectId, 'files', 'board', 'still.png'), new Uint8Array([137, 80, 78, 71]));
	const card: StoryCard = { card_id: 'a', order: 0, title: 'Door', beat: 'She opens the door', purpose: 'Arrival', duration_ms: 5000, image_prompt: 'door', video_prompt: GOOD, status: 'draft' };
	const saved = await gateway.saveProduction({
		command: 'save_production', project_id: projectId, expected_version: created.data.version,
		production: { status: 'draft', title: 'A', logline: '', premise: '', theme: '', cards: [card], updated_at: null,
			assets: [{ asset_id: 'still', card_id: 'a', kind: 'image', name: 'still.png', mime_type: 'image/png', url: `/api/projects/${projectId}/files/board/still.png`, ...still, created_at: '2026-10-01T00:00:00.000Z' }] }
	});
	if (!saved.ok) throw new Error(saved.error.message);
	const fake = fakeGenerator(usd);
	const deps: AnimateDeps = {
		gateway, store, projectRoot: root, generator: fake.generator,
		probe: async () => ({ width: 854, height: 480, duration_s: 5 }),
		download: async () => new Uint8Array([0, 0, 0, 24])
	};
	return { deps, fake, project: saved.data, projectId, store };
}

describe('the Animate gate (nothing is spent while it has reasons)', () => {
	const still = { kind: 'image' as const, width: 2048, height: 1152 };
	test('a lint error blocks', () => {
		expect(animateGate({ prompt: 'Cut to @Image 1 on the roof', still, estimate_usd: 1, mode: { kind: 'confirm', confirmed_usd: 1 } }).join(' ')).toContain('seedance-underscore');
	});
	test('a still under 2K, or of unknown size, blocks', () => {
		expect(animateGate({ prompt: GOOD, still: { kind: 'image', width: 1920, height: 1080 }, estimate_usd: 1, mode: { kind: 'confirm', confirmed_usd: 1 } })[0]).toContain('under 2048');
		expect(animateGate({ prompt: GOOD, still: { kind: 'image' }, estimate_usd: 1, mode: { kind: 'confirm', confirmed_usd: 1 } })[0]).toContain('unknown');
	});
	test('a price above the confirmed one blocks; YOLO needs a cap and stops at it', () => {
		expect(animateGate({ prompt: GOOD, still, estimate_usd: 1.2, mode: { kind: 'confirm', confirmed_usd: 1 } })[0]).toContain('above the $1.00');
		expect(animateGate({ prompt: GOOD, still, estimate_usd: 1, mode: { kind: 'yolo', cap_usd: 0, spent_usd: 0 } })[0]).toContain('cap');
		expect(animateGate({ prompt: GOOD, still, estimate_usd: 1, mode: { kind: 'yolo', cap_usd: 1.5, spent_usd: 1 } })[0]).toContain('YOLO cap reached');
		expect(animateGate({ prompt: GOOD, still, estimate_usd: 1, mode: { kind: 'yolo', cap_usd: 2, spent_usd: 1 } })).toEqual([]);
	});
});

describe('Animate against a fake generator', () => {
	test('a lint failure is refused before any upload or submit', async () => {
		const { deps, fake, project, projectId } = await setup({ width: 2048, height: 1152 });
		const sent = await sendAnimate(deps, { project_id: projectId, expected_version: project.version, card_id: 'a', settings: settings('Cut to @Image 1'), mode: { kind: 'confirm', confirmed_usd: 0.5 } });
		expect(sent.ok).toBeFalse();
		if (!sent.ok) expect(sent.code).toBe('GATE_BLOCKED');
		expect(fake.calls.filter((call) => call === 'upload' || call.startsWith('submit'))).toEqual([]);
	});

	test('a sub-2K still is refused before any spend', async () => {
		const { deps, fake, project, projectId } = await setup({ width: 1920, height: 1080 });
		const sent = await sendAnimate(deps, { project_id: projectId, expected_version: project.version, card_id: 'a', settings: settings(), mode: { kind: 'confirm', confirmed_usd: 0.5 } });
		expect(sent.ok).toBeFalse();
		if (!sent.ok) expect(sent.reasons?.join(' ')).toContain('under 2048');
		expect(fake.calls.some((call) => call.startsWith('submit'))).toBeFalse();
	});

	test('YOLO stops at the session cap', async () => {
		const { deps, fake, project, projectId, store } = await setup({ width: 2048, height: 1152 }, 0.6);
		const yolo = { kind: 'yolo' as const, cap_usd: 1, session_id: 's1' };
		const first = await sendAnimate(deps, { project_id: projectId, expected_version: project.version, card_id: 'a', settings: settings(), mode: yolo });
		expect(first.ok).toBeTrue();
		const latest = (await store.readProject(projectId))!;
		const second = await sendAnimate(deps, { project_id: projectId, expected_version: latest.version, card_id: 'a', settings: settings(), mode: yolo });
		expect(second.ok).toBeFalse();
		if (!second.ok) expect(second.reasons?.join(' ')).toContain('YOLO cap reached');
		expect(fake.calls.filter((call) => call.startsWith('submit'))).toHaveLength(1);
	});

	test('a confirmed send is noted as pending; when it completes its video lands as a new take and the pick', async () => {
		const { deps, fake, project, projectId } = await setup({ width: 2048, height: 1152 });
		const sent = await sendAnimate(deps, { project_id: projectId, expected_version: project.version, card_id: 'a', settings: settings(), mode: { kind: 'confirm', confirmed_usd: 0.5 } });
		if (!sent.ok) throw new Error(sent.message);
		expect(fake.calls).toEqual([`estimate ${SEEDANCE_I2V} 5s 480p`, 'upload', `submit ${SEEDANCE_I2V}`]);
		expect(sent.project.production.generations?.[0]).toMatchObject({ request_id: 'req-1', card_id: 'a', status: 'queued', estimate_usd: 0.5 });

		fake.statuses.set('req-1', { status: 'completed', video_url: 'https://files.example/out.mp4' });
		const polled = await pollGenerations(deps, projectId);
		if (!polled.ok) throw new Error(polled.message);
		const takes = takesFor(polled.project.production, 'a');
		expect(takes.map((take) => take.kind)).toEqual(['image', 'video']);
		const animated = takes[1];
		expect(animated).toMatchObject({ job_id: 'req-1', width: 854, height: 480, generation: { provider: 'higgsfield', model: SEEDANCE_I2V, resolution: '480p' } });
		expect(pickFor(polled.project.production, polled.project.production.cards[0])?.asset_id).toBe(animated.asset_id);
		expect(polled.project.production.generations?.[0]).toMatchObject({ status: 'completed', take_id: animated.asset_id });
	});

	test('a refused (nsfw) generation settles without a take', async () => {
		const { deps, fake, project, projectId } = await setup({ width: 2048, height: 1152 });
		await sendAnimate(deps, { project_id: projectId, expected_version: project.version, card_id: 'a', settings: settings(), mode: { kind: 'confirm', confirmed_usd: 0.5 } });
		fake.statuses.set('req-1', { status: 'nsfw' });
		const polled = await pollGenerations(deps, projectId);
		if (!polled.ok) throw new Error(polled.message);
		expect(takesFor(polled.project.production, 'a')).toHaveLength(1);
		expect(polled.project.production.generations?.[0].status).toBe('nsfw');
	});
});

describe('the Agent drafts the Animate prompt', () => {
	test('a draft the linter rejects is re-asked once with the findings', async () => {
		const prompts: string[] = [];
		const answers = ['{"prompt":"Image_1 is Mara.\\nMara opens the door and she steps through."}', JSON.stringify({ prompt: GOOD })];
		const client = { choice: { provider: 'hyper' as const, model: 'fake-vision', base_url: 'https://hyper.example/v1' }, async generate({ prompt }: { prompt: string }) { prompts.push(prompt); return answers[prompts.length - 1]; } };
		const card: StoryCard = { card_id: 'a', order: 0, title: 'Door', beat: 'Mara opens the door', purpose: 'Arrival', duration_ms: 5000, image_prompt: 'door', video_prompt: 'door', status: 'draft' };
		const draft = await draftAnimatePrompt(client, { card, still: new Uint8Array([1]), stillType: 'image/png', rules: 'No pronouns.' });
		expect(draft).toBe(GOOD);
		expect(prompts).toHaveLength(2);
		expect(prompts[1]).toContain('The prompt linter rejected it');
		expect(prompts[1]).toContain('Pronoun');
	});
});

describe('Higgsfield client', () => {
	test('calls the documented paths with the key header, and never sends the key to storage', async () => {
		const seen: Array<{ url: string; method: string; auth: string | null; idem: string | null }> = [];
		const fetchImpl = async (url: string, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			seen.push({ url, method: init?.method ?? 'GET', auth: headers.get('authorization'), idem: headers.get('idempotency-key') });
			const body = url.endsWith('/files/generate-upload-url') ? { upload_url: 'https://storage.example/put', public_url: 'https://storage.example/still.png', upload_headers: { 'x-amz-acl': 'private' } }
				: url.includes('/estimate/') ? { credits: '12.000', usd: '0.600' }
				: url.endsWith('/status') ? { status: 'completed', request_id: 'r1', video: { url: 'https://out.example/v.mp4' } }
				: url === 'https://storage.example/put' ? {}
				: { status: 'queued', request_id: 'r1' };
			return new Response(JSON.stringify(body), { status: 200 });
		};
		const hf = createHiggsfieldGenerator('id:secret', { fetchImpl });
		expect(await hf.upload(new Uint8Array([1]), 'image/png')).toBe('https://storage.example/still.png');
		expect(await hf.estimate(SEEDANCE_I2V, { duration: 5 })).toEqual({ credits: 12, usd: 0.6 });
		expect(await hf.submit(SEEDANCE_I2V, { duration: 5 }, 'k1')).toEqual({ request_id: 'r1' });
		expect(await hf.status('r1')).toMatchObject({ status: 'completed', video_url: 'https://out.example/v.mp4' });
		expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
			'POST https://api.higgsfield.ai/files/generate-upload-url',
			'PUT https://storage.example/put',
			`POST https://api.higgsfield.ai/estimate/${SEEDANCE_I2V}`,
			`POST https://api.higgsfield.ai/${SEEDANCE_I2V}`,
			'GET https://api.higgsfield.ai/requests/r1/status'
		]);
		expect(seen.filter((s) => s.url.startsWith('https://api.higgsfield.ai')).every((s) => s.auth === 'Key id:secret')).toBeTrue();
		expect(seen[1].auth).toBeNull();
		expect(seen[3].idem).toBe('k1');
	});
});
