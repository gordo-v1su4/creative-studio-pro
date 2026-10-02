import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { animateGate } from '../../src/lib/domain/animate';
import { pickFor, takesFor } from '../../src/lib/domain/takes';
import { draftAnimatePrompt, pollGenerations, resetSessionSpend, sendAnimate, type AnimateDeps } from '../../src/lib/server/animate';
import { createHiggsfieldCli, SEEDANCE_JOB_TYPE, seedanceArgs, type GenerationStatus, type VideoGenerator } from '../../src/lib/server/higgsfield';
import type { StoryCard } from '../../src/lib/domain/schemas';

const roots: string[] = [];
beforeEach(() => resetSessionSpend());
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const GOOD = 'Image_1 is Mara.\nCold open. Mara holds at the door in @Image_1, then a hard cut to Mara on the handle. Cut to the street, rain, a slow push.';
const settings = (prompt = GOOD) => ({ prompt, duration_s: 5, resolution: '480p' as const, generate_audio: true });

/** A generator that records every call and never touches the network. */
function fakeGenerator(credits = 15) {
	const calls: string[] = [];
	const statuses = new Map<string, { status: GenerationStatus; video_url?: string; error?: string }>();
	let n = 0;
	const generator: VideoGenerator = {
		async estimate(request) { calls.push(`estimate ${request.duration}s ${request.resolution} draft=${request.draft} image=${Boolean(request.start_image)}`); return { credits }; },
		async submit(request) { calls.push(`submit ${request.resolution} draft=${request.draft} image=${request.start_image?.endsWith('still.png')}`); const id = `job-${++n}`; statuses.set(id, { status: 'queued' }); return { job_id: id }; },
		async status(id) { calls.push(`status ${id}`); return statuses.get(id)!; },
		async balance() { return { credits: 100, plan: 'creator' }; }
	};
	return { generator, calls, statuses };
}

async function setup(still: { width: number; height: number }, credits = 15) {
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
	const fake = fakeGenerator(credits);
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
		expect(animateGate({ prompt: 'Cut to @Image 1 on the roof', still, estimate_credits: 15, mode: { kind: 'confirm', confirmed_credits: 15 } }).join(' ')).toContain('seedance-underscore');
	});
	test('a still under 2K, or of unknown size, blocks', () => {
		expect(animateGate({ prompt: GOOD, still: { kind: 'image', width: 1920, height: 1080 }, estimate_credits: 15, mode: { kind: 'confirm', confirmed_credits: 15 } })[0]).toContain('under 2048');
		expect(animateGate({ prompt: GOOD, still: { kind: 'image' }, estimate_credits: 15, mode: { kind: 'confirm', confirmed_credits: 15 } })[0]).toContain('unknown');
	});
	test('a price above the confirmed one blocks; YOLO needs a cap and stops at it', () => {
		expect(animateGate({ prompt: GOOD, still, estimate_credits: 18, mode: { kind: 'confirm', confirmed_credits: 15 } })[0]).toContain('above the 15 you confirmed');
		expect(animateGate({ prompt: GOOD, still, estimate_credits: 15, mode: { kind: 'yolo', cap_credits: 0, spent_credits: 0 } })[0]).toContain('cap');
		expect(animateGate({ prompt: GOOD, still, estimate_credits: 15, mode: { kind: 'yolo', cap_credits: 25, spent_credits: 15 } })[0]).toContain('YOLO cap reached');
		expect(animateGate({ prompt: GOOD, still, estimate_credits: 15, mode: { kind: 'yolo', cap_credits: 30, spent_credits: 15 } })).toEqual([]);
	});
});

describe('Animate against a fake generator', () => {
	test('a lint failure is refused before any upload or submit', async () => {
		const { deps, fake, project, projectId } = await setup({ width: 2048, height: 1152 });
		const sent = await sendAnimate(deps, { project_id: projectId, expected_version: project.version, card_id: 'a', settings: settings('Cut to @Image 1'), mode: { kind: 'confirm', confirmed_credits: 15 } });
		expect(sent.ok).toBeFalse();
		if (!sent.ok) expect(sent.code).toBe('GATE_BLOCKED');
		expect(fake.calls.filter((call) => call.startsWith('submit'))).toEqual([]);
	});

	test('a sub-2K still is refused before any spend', async () => {
		const { deps, fake, project, projectId } = await setup({ width: 1920, height: 1080 });
		const sent = await sendAnimate(deps, { project_id: projectId, expected_version: project.version, card_id: 'a', settings: settings(), mode: { kind: 'confirm', confirmed_credits: 15 } });
		expect(sent.ok).toBeFalse();
		if (!sent.ok) expect(sent.reasons?.join(' ')).toContain('under 2048');
		expect(fake.calls.some((call) => call.startsWith('submit'))).toBeFalse();
	});

	test('YOLO stops at the session cap', async () => {
		const { deps, fake, project, projectId, store } = await setup({ width: 2048, height: 1152 }, 18);
		const yolo = { kind: 'yolo' as const, cap_credits: 30, session_id: 's1' };
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
		const sent = await sendAnimate(deps, { project_id: projectId, expected_version: project.version, card_id: 'a', settings: settings(), mode: { kind: 'confirm', confirmed_credits: 15 } });
		if (!sent.ok) throw new Error(sent.message);
		expect(fake.calls).toEqual(['estimate 5s 480p draft=true image=false', 'submit 480p draft=true image=true']);
		expect(sent.project.production.generations?.[0]).toMatchObject({ request_id: 'job-1', card_id: 'a', status: 'queued', estimate_credits: 15, draft: true });

		fake.statuses.set('job-1', { status: 'completed', video_url: 'https://files.example/out.mp4' });
		const polled = await pollGenerations(deps, projectId);
		if (!polled.ok) throw new Error(polled.message);
		const takes = takesFor(polled.project.production, 'a');
		expect(takes.map((take) => take.kind)).toEqual(['image', 'video']);
		const animated = takes[1];
		expect(animated).toMatchObject({ job_id: 'job-1', width: 854, height: 480, generation: { provider: 'higgsfield', model: SEEDANCE_JOB_TYPE, resolution: '480p', draft: true, duration_s: 5 } });
		expect(pickFor(polled.project.production, polled.project.production.cards[0])?.asset_id).toBe(animated.asset_id);
		expect(polled.project.production.generations?.[0]).toMatchObject({ status: 'completed', take_id: animated.asset_id });
	});

	test('a refused (nsfw) generation settles without a take', async () => {
		const { deps, fake, project, projectId } = await setup({ width: 2048, height: 1152 });
		await sendAnimate(deps, { project_id: projectId, expected_version: project.version, card_id: 'a', settings: settings(), mode: { kind: 'confirm', confirmed_credits: 15 } });
		fake.statuses.set('job-1', { status: 'nsfw' });
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

describe('Higgsfield CLI client', () => {
	test('drafts at 480p with the still as start frame; the prompt goes in a JSON file', async () => {
		const runs: string[][] = [];
		let promptFile = '';
		const run = async (args: string[]) => {
			runs.push(args);
			const at = args.indexOf('--prompt');
			if (at >= 0) { promptFile = args[at + 1].slice(1); expect(JSON.parse(await Bun.file(promptFile).text())).toBe(GOOD); }
			if (args[1] === 'cost') return { credits: 15 };
			if (args[1] === 'create') return [{ id: 'job-9', status: 'queued' }];
			if (args[1] === 'get') return { id: 'job-9', status: 'completed', result_url: 'https://cdn.example/v.mp4' };
			return { credits: 24.01, subscription_plan_type: 'creator' };
		};
		const hf = createHiggsfieldCli(run);
		const request = { prompt: GOOD, duration: 5, resolution: '480p' as const, generate_audio: true, draft: true, start_image: 'C:\\p\\still.png' };
		expect(await hf.estimate(request)).toEqual({ credits: 15 });
		expect(await hf.submit(request)).toEqual({ job_id: 'job-9' });
		expect(await hf.status('job-9')).toMatchObject({ status: 'completed', video_url: 'https://cdn.example/v.mp4' });
		expect(await hf.balance()).toEqual({ credits: 24.01, plan: 'creator' });
		expect(runs[1].slice(0, 2)).toEqual(['generate', 'create']);
		expect(runs[1].slice(2)).toEqual(['seedance_2_5', '--prompt', expect.stringMatching(/^@.+prompt\.json$/), '--duration', '5', '--resolution', '480p', '--generate_audio', 'true', '--draft', 'true', '--mode', 'omni_reference', '--start-image', 'C:\\p\\still.png']);
		expect(runs[2]).toEqual(['generate', 'get', 'job-9']);
		expect(await Bun.file(promptFile).exists()).toBeFalse();
	});

	test('Seedance 2.5 with a start image or references goes as omni_reference; 2.0 has no draft flags', () => {
		expect(seedanceArgs({ prompt: 'p', duration: 5, resolution: '480p', generate_audio: true, draft: true, start_image: 's.png' }, 'f.json'))
			.toEqual(['seedance_2_5', '--prompt', '@f.json', '--duration', '5', '--resolution', '480p', '--generate_audio', 'true', '--draft', 'true', '--mode', 'omni_reference', '--start-image', 's.png']);
		expect(seedanceArgs({ prompt: 'p', duration: 12, resolution: '480p', generate_audio: true, draft: true, aspect_ratio: '16:9', image_references: ['kai.png'] }, 'f.json'))
			.toEqual(['seedance_2_5', '--prompt', '@f.json', '--duration', '12', '--resolution', '480p', '--generate_audio', 'true', '--draft', 'true', '--mode', 'omni_reference', '--aspect_ratio', '16:9', '--image-references', 'kai.png']);
		expect(seedanceArgs({ prompt: 'p', duration: 12, resolution: '720p', generate_audio: true, job_type: 'seedance_2_0', aspect_ratio: '9:16', draft: true }, 'f.json'))
			.toEqual(['seedance_2_0', '--prompt', '@f.json', '--duration', '12', '--resolution', '720p', '--generate_audio', 'true', '--aspect_ratio', '9:16']);
	});

	test('finalizing a draft spells out draft false and passes the draft job id', () => {
		expect(seedanceArgs({ prompt: 'p', duration: 15, resolution: '1080p', generate_audio: true, draft: true, draft_job_id: 'd1' }, 'f.json'))
			.toEqual(['seedance_2_5', '--prompt', '@f.json', '--duration', '15', '--resolution', '1080p', '--generate_audio', 'true', '--draft', 'false', '--draft_job_id', 'd1']);
	});
});
