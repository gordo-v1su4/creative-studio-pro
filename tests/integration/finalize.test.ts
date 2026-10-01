import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { draftWindow, draftsClosingSoon, timeLeft, FINALIZE_WINDOW_MS } from '../../src/lib/domain/finalize';
import { pollGenerations, quoteFinalize, sendFinalize, type AnimateDeps } from '../../src/lib/server/animate';
import type { GenerationStatus, VideoGenerator } from '../../src/lib/server/higgsfield';
import type { ProductionAsset, StoryCard } from '../../src/lib/domain/schemas';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const H = 3600_000;
const made = '2026-10-01T00:00:00.000Z';
const t0 = Date.parse(made);
const draft = (extra: Partial<ProductionAsset['generation']> = {}): Pick<ProductionAsset, 'job_id' | 'generation'> => ({
	job_id: 'd1', generation: { provider: 'higgsfield', model: 'seedance_2_5', resolution: '480p', prompt: 'p', duration_s: 10, draft: true, draft_created_at: made, ...extra }
});

describe('finalize window (from the draft creation time)', () => {
	test('open for seven days, closing in the last 48 hours, then closed', () => {
		expect(draftWindow(draft(), t0 + 24 * H)).toMatchObject({ state: 'open', ms_left: 6 * 24 * H });
		expect(draftWindow(draft(), t0 + FINALIZE_WINDOW_MS - 47 * H)).toMatchObject({ state: 'closing' });
		expect(draftWindow(draft(), t0 + FINALIZE_WINDOW_MS + 1)).toMatchObject({ state: 'closed' });
	});
	test('takes that are not drafts, have no job, or are finalized have no window', () => {
		expect(draftWindow({ job_id: undefined, generation: draft().generation }, t0).state).toBe('none');
		expect(draftWindow(draft({ draft: false }), t0).state).toBe('none');
		expect(draftWindow(draft({ finalized_at: made }), t0).state).toBe('none');
	});
	test('badge text', () => {
		expect(timeLeft(5 * 24 * H + 3 * H)).toBe('5d left');
		expect(timeLeft(30 * H)).toBe('30h left');
		expect(timeLeft(20 * 60_000)).toBe('20m left');
	});
});

function fake(credits = 120, balance = 1000) {
	const calls: string[] = [];
	const statuses = new Map<string, { status: GenerationStatus; video_url?: string }>();
	const generator: VideoGenerator = {
		async estimate(request) { calls.push(`estimate ${request.resolution} ${request.draft_job_id}`); return { credits }; },
		async submit(request) { calls.push(`submit ${request.draft_job_id}`); const id = `fin-${request.draft_job_id}`; statuses.set(id, { status: 'queued' }); return { job_id: id }; },
		async status(id) { return statuses.get(id)!; },
		async balance() { return { credits: balance, plan: 'creator' }; }
	};
	return { generator, calls, statuses };
}

async function setup(credits = 120, balance = 1000) {
	const root = await mkdtemp(join(tmpdir(), 'csp-finalize-')); roots.push(root);
	const store = new ProjectStore({ root });
	const gateway = new ProjectCommandGateway(store);
	const created = await gateway.createProject({ command: 'create_project', title: 'Finalize', brief: '', creative_focus: 'full room', created_by: 'gordo' });
	if (!created.ok) throw new Error(created.error.message);
	const projectId = created.data.project_id;
	const card: StoryCard = { card_id: 'a', order: 0, title: 'Trailer', beat: 'b', purpose: 'p', duration_ms: 20000, image_prompt: 'i', video_prompt: 'v', status: 'draft' };
	const take: ProductionAsset = { asset_id: 'v', card_id: 'a', kind: 'video', name: 'trailer-480p.mp4', mime_type: 'video/mp4', url: `/api/projects/${projectId}/files/trailer.mp4`, in_s: 1.5, out_s: 18, speed: [{ x: 0, rate: 1 }, { x: 1, rate: 2 }], created_at: made };
	const saved = await gateway.saveProduction({ command: 'save_production', project_id: projectId, expected_version: created.data.version, production: { status: 'draft', title: 'F', logline: '', premise: '', theme: '', cards: [card], assets: [take], updated_at: null } });
	if (!saved.ok) throw new Error(saved.error.message);
	const linked = await gateway.linkDraftJobs({ command: 'link_draft_jobs', project_id: projectId, expected_version: saved.data.version, links: [{ take_id: 'v', job_id: 'd1', draft_created_at: new Date(Date.now() - 24 * H).toISOString(), prompt: 'Image_1 is Kai.', duration_s: 20, generate_audio: true }] });
	if (!linked.ok) throw new Error(linked.error.message);
	const f = fake(credits, balance);
	const deps: AnimateDeps = { gateway, store, projectRoot: root, generator: f.generator, probe: async () => ({ width: 1920, height: 1080, duration_s: 20 }), download: async () => new Uint8Array([0]) };
	return { deps, f, project: linked.data, projectId };
}

describe('finalize against a fake generator', () => {
	test('linking stores the job id and draft creation time; the take now has an open window', async () => {
		const { project } = await setup();
		const take = project.production.assets[0];
		expect(take).toMatchObject({ job_id: 'd1', generation: { draft: true, resolution: '480p', duration_s: 20 } });
		expect(draftWindow(take, Date.now()).state).toBe('open');
		expect(draftsClosingSoon(project.production, Date.now() + 4 * 24 * H).map((d) => d.take.asset_id)).toEqual(['v']);
		expect(draftsClosingSoon(project.production, Date.now())).toEqual([]);
	});

	test('a quote prices 1080p by draft job id and creates nothing', async () => {
		const { deps, f, project } = await setup(240);
		const quoted = await quoteFinalize(deps, project, ['v']);
		if (!quoted.ok) throw new Error(quoted.message);
		expect(quoted.quote.total_credits).toBe(240);
		expect(f.calls).toEqual(['estimate 1080p d1']);
	});

	test('a short balance or a higher price blocks before any submit', async () => {
		const poor = await setup(240, 24.01);
		const blocked = await sendFinalize(poor.deps, { project_id: poor.projectId, expected_version: poor.project.version, take_ids: ['v'], confirmed_credits: 240 });
		expect(blocked.ok).toBeFalse();
		if (!blocked.ok) expect(blocked.reasons?.join(' ')).toContain('Not enough credits');
		const pricier = await setup(300);
		const higher = await sendFinalize(pricier.deps, { project_id: pricier.projectId, expected_version: pricier.project.version, take_ids: ['v'], confirmed_credits: 240 });
		if (!higher.ok) expect(higher.reasons?.join(' ')).toContain('above the 240');
		expect([...poor.f.calls, ...pricier.f.calls].some((call) => call.startsWith('submit'))).toBeFalse();
	});

	test('a finished finalize replaces the take\'s media; trims, ramp and pick stay', async () => {
		const { deps, f, project, projectId } = await setup(240);
		const sent = await sendFinalize(deps, { project_id: projectId, expected_version: project.version, take_ids: ['v'], confirmed_credits: 240 });
		if (!sent.ok) throw new Error(sent.message);
		expect(f.calls).toEqual(['estimate 1080p d1', 'submit d1']);
		f.statuses.set('fin-d1', { status: 'completed', video_url: 'https://cdn.example/1080.mp4' });
		const polled = await pollGenerations(deps, projectId);
		if (!polled.ok) throw new Error(polled.message);
		const takes = polled.project.production.assets;
		expect(takes).toHaveLength(1);
		expect(takes[0]).toMatchObject({ asset_id: 'v', in_s: 1.5, out_s: 18, speed: [{ x: 0, rate: 1 }, { x: 1, rate: 2 }], width: 1920, height: 1080, generation: { resolution: '1080p', finalize_job_id: 'fin-d1', draft_url: project.production.assets[0].url } });
		expect(takes[0].url).not.toBe(project.production.assets[0].url);
		expect(draftWindow(takes[0], Date.now()).state).toBe('none');
	});
});
