import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { approveRerender, draftRerender, editRerender, queueRerenderFor, redraftRerender, removeRerender, setRerenderSettings, type RerenderDeps } from '../../src/lib/server/rerender';
import { createRenderProviders } from '../../src/lib/server/render-providers';
import { confirmBlockers } from '../../src/lib/domain/render-queue';
import type { AgentModelClient } from '../../src/lib/server/model-provider';
import type { ReviewNote } from '../../src/lib/domain/review-notes';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const PLAIN = 'Kai "Hoodie" Santana from Image 1 walks down the alley. Fast push in.';
const SLOW = 'Kai "Hoodie" Santana from Image 1 walks down the alley. Slow push in.';
const note = (over: Partial<ReviewNote>): ReviewNote => ({ id: 'n', body: 'Too fast', timecodeSec: 1.5, authorName: 'Client', authorRole: 'client', createdAt: 1, completedAt: null, ...over });

async function setup(options: { answers?: unknown[]; notes?: ReviewNote[]; job?: unknown; take?: Record<string, unknown>; status?: string } = {}) {
	const root = await mkdtemp(join(tmpdir(), 'csp-rerender-')); roots.push(root);
	const store = new ProjectStore({ root });
	const made = await new ProjectCommandGateway(store).createProject({ command: 'create_project', title: 'Re-render', brief: '', creative_focus: 'full room', created_by: 'test' });
	if (!made.ok) throw new Error(made.error.message);
	const project = await store.updateProject(made.data.project_id, made.data.version, (p) => ({ ...p, production: { ...p.production,
		cards: [{ card_id: 'shot', order: 0, title: 'Shot', beat: 'Run', purpose: 'Escape', duration_ms: 5000, image_prompt: 'Run', video_prompt: PLAIN, status: 'draft', pick_take_id: 'take1' }],
		assets: [{ asset_id: 'take1', card_id: 'shot', kind: 'video' as const, name: 'hf_take1.mp4', mime_type: 'video/mp4', url: '/files/take1.mp4', created_at: '2026-11-24T00:00:00.000Z', duration_s: 5,
			review_status: (options.status ?? 'needs_changes') as 'needs_changes', job_id: 'job-1', generation: { provider: 'higgsfield', model: 'seedance_2_5', resolution: '720p', prompt: PLAIN, duration_s: 5, generate_audio: true }, ...options.take }]
	} }));
	const asked: string[] = [];
	const answers = [...(options.answers ?? [])];
	const client: AgentModelClient = { choice: { provider: 'custom', model: 'fake', base_url: null }, async generate(input) { asked.push(input.prompt); const next = answers.shift(); if (next === undefined) throw new Error('The model did not answer'); return JSON.stringify(next); } };
	const cli: string[][] = [];
	const providers = createRenderProviders({ higgsfield: async (args) => { cli.push(args); if (args[0] === 'generate' && args[1] === 'get') return options.job; return {}; }, falKey: null });
	let n = 0;
	const deps: RerenderDeps = { store, providers, model: async () => ({ ok: true, client }), skill: async () => 'GHOST SKILL', notes: async () => options.notes ?? [], banned: async () => [], now: () => '2026-11-24T12:00:00.000Z', id: () => `render-${++n}` };
	return { deps, store, project, asked, cli, id: project.project_id };
}

const must = <T extends { ok: boolean }>(outcome: T): Extract<T, { ok: true }> => { if (!outcome.ok) throw new Error((outcome as unknown as { message: string }).message); return outcome as Extract<T, { ok: true }>; };

test('queueing a re-render keeps the requested change and the open notes, and starts at 480p on Higgsfield', async () => {
	const s = await setup({ notes: [note({}), note({ id: 'done', body: 'Old', completedAt: 5 }), note({ id: 'm', body: 'Wider', timecodeSec: null })] });
	const queued = must(await queueRerenderFor(s.deps, s.id, { expected_version: s.project.version, take_id: 'take1', requested_change: ' Slower push ' }));
	expect(queued.render).toMatchObject({ request_id: 'render-1', state: 'drafting', answers_take_id: 'take1', requested_change: 'Slower push', provider: 'higgsfield', resolution: '480p', prompt: PLAIN, prompt_before: PLAIN, reuse_job_id: 'job-1',
		notes: [{ text: 'Too fast', at_s: 1.5, author: 'Client' }, { text: 'Wider', author: 'Client' }] });
	expect((await s.store.readProject(s.id))!.production.generations).toHaveLength(1);
	// the take's own facts were enough: Higgsfield was not asked
	expect(s.cli).toEqual([]);
	// nothing is spent or sent by queueing
	expect(queued.render!.price).toBeUndefined();
});

test('queueing again opens the entry already there', async () => {
	const s = await setup();
	const first = must(await queueRerenderFor(s.deps, s.id, { expected_version: s.project.version, take_id: 'take1', requested_change: 'Slower' }));
	const again = must(await queueRerenderFor(s.deps, s.id, { expected_version: first.project.version, take_id: 'take1', requested_change: 'Other' }));
	expect([again.render!.request_id, again.render!.requested_change, again.project.production.generations!.length]).toEqual(['render-1', 'Slower', 1]);
});

test('only a take marked Needs changes is queued, and never by itself', async () => {
	const s = await setup({ status: 'approved' });
	expect(await queueRerenderFor(s.deps, s.id, { expected_version: s.project.version, take_id: 'take1', requested_change: 'Slower' })).toEqual({ ok: false, status: 400, message: 'A re-render is queued from a take marked Needs changes' });
});

test('a take brought in from Higgsfield is read back by its job id', async () => {
	const s = await setup({ take: { generation: undefined, duration_s: 8 }, job: { job_type: 'seedance_2_0', params: { prompt: 'From history.', duration: 8, generate_audio: false, medias: [] } } });
	const queued = must(await queueRerenderFor(s.deps, s.id, { expected_version: s.project.version, take_id: 'take1', requested_change: 'Slower' }));
	expect(s.cli).toEqual([['generate', 'get', 'job-1']]);
	expect(queued.render).toMatchObject({ prompt: 'From history.', model: 'seedance_2_0', duration_s: 8, generate_audio: false, reuse_job_id: 'job-1' });
});

test('a take with no record and no job id is refused with the reason', async () => {
	const s = await setup({ take: { generation: undefined, job_id: undefined } });
	const out = await queueRerenderFor(s.deps, s.id, { expected_version: s.project.version, take_id: 'take1', requested_change: 'Slower' });
	expect(out).toMatchObject({ ok: false, status: 400 });
	expect((out as { message: string }).message).toContain('no Higgsfield job id');
});

test('the Agent drafts the prompt change from the change and the notes, and the entry waits for approval', async () => {
	const s = await setup({ answers: [{ prompt: SLOW }], notes: [note({})] });
	const queued = must(await queueRerenderFor(s.deps, s.id, { expected_version: s.project.version, take_id: 'take1', requested_change: 'Slower push' }));
	const drafted = must(await draftRerender(s.deps, s.id, { expected_version: queued.project.version, render_id: 'render-1' }));
	expect(drafted.render).toMatchObject({ state: 'to_approve', prompt: SLOW, prompt_before: PLAIN, check: [] });
	expect(s.asked[0]).toContain('Slower push');
	expect(s.asked[0]).toContain('Too fast');
	// the take it answers is untouched: still Needs changes, still the pick, still one take
	const after = (await s.store.readProject(s.id))!.production;
	expect([after.assets.length, after.assets[0].review_status, after.cards[0].pick_take_id, after.cards[0].video_prompt]).toEqual([1, 'needs_changes', 'take1', PLAIN]);
});

test('when the Agent cannot write it the entry stays drafting with the reason, and can be asked again', async () => {
	const s = await setup({ answers: [] });
	const queued = must(await queueRerenderFor(s.deps, s.id, { expected_version: s.project.version, take_id: 'take1', requested_change: 'Slower' }));
	const stuck = must(await draftRerender(s.deps, s.id, { expected_version: queued.project.version, render_id: 'render-1' }));
	expect([stuck.render!.state, stuck.render!.error]).toEqual(['drafting', 'The model did not answer']);
});

test('"Render again unchanged" skips the Agent and waits for approval with the earlier prompt', async () => {
	const s = await setup();
	const queued = must(await queueRerenderFor(s.deps, s.id, { expected_version: s.project.version, take_id: 'take1', unchanged: true }));
	expect([queued.render!.state, queued.render!.prompt, queued.render!.check]).toEqual(['to_approve', PLAIN, []]);
	expect(await draftRerender(s.deps, s.id, { expected_version: queued.project.version, render_id: 'render-1' })).toMatchObject({ ok: false, message: 'Its prompt change is already written' });
	expect(s.asked).toEqual([]);
});

test('approve is the only way forward; an edit after it asks for approval again', async () => {
	const s = await setup({ answers: [{ prompt: SLOW }] });
	let v = must(await queueRerenderFor(s.deps, s.id, { expected_version: s.project.version, take_id: 'take1', requested_change: 'Slower' })).project.version;
	expect(await approveRerender(s.deps, s.id, { expected_version: v, render_id: 'render-1' })).toMatchObject({ ok: false, message: 'A render that is drafting cannot become approved' });
	v = must(await draftRerender(s.deps, s.id, { expected_version: v, render_id: 'render-1' })).project.version;
	const approved = must(await approveRerender(s.deps, s.id, { expected_version: v, render_id: 'render-1' }));
	expect([approved.render!.state, approved.render!.approved_at]).toEqual(['approved', '2026-11-24T12:00:00.000Z']);
	// approved, and still nothing to confirm: it has no price
	expect(confirmBlockers(approved.render!)).toEqual(['No price yet']);
	const edited = must(await editRerender(s.deps, s.id, { expected_version: approved.project.version, render_id: 'render-1', prompt: `${SLOW} He turns.` }));
	expect([edited.render!.state, edited.render!.approved_at]).toEqual(['to_approve', undefined]);
	// the operator's own words are checked like the Agent's
	expect(edited.render!.check!.length).toBeGreaterThan(0);
});

test('asking again with other words goes back to drafting from the earlier prompt', async () => {
	const s = await setup({ answers: [{ prompt: SLOW }] });
	let v = must(await queueRerenderFor(s.deps, s.id, { expected_version: s.project.version, take_id: 'take1', requested_change: 'Slower' })).project.version;
	v = must(await draftRerender(s.deps, s.id, { expected_version: v, render_id: 'render-1' })).project.version;
	const again = must(await redraftRerender(s.deps, s.id, { expected_version: v, render_id: 'render-1', requested_change: 'Wider instead' }));
	expect(again.render).toMatchObject({ state: 'drafting', requested_change: 'Wider instead', prompt: PLAIN });
	expect(again.render!.check).toBeUndefined();
});

test('the provider, model and resolution can be chosen only among what is set up', async () => {
	const s = await setup();
	const v = must(await queueRerenderFor(s.deps, s.id, { expected_version: s.project.version, take_id: 'take1', unchanged: true })).project.version;
	expect(await setRerenderSettings(s.deps, s.id, { expected_version: v, render_id: 'render-1', provider: 'fal' })).toMatchObject({ ok: false, message: 'fal.ai is not set up: FAL_KEY is not set' });
	expect(await setRerenderSettings(s.deps, s.id, { expected_version: v, render_id: 'render-1', provider: 'swarmui' })).toMatchObject({ ok: false, message: 'SwarmUI (desktop) is not set up: Not connected yet' });
	expect(await setRerenderSettings(s.deps, s.id, { expected_version: v, render_id: 'render-1', resolution: '4k' })).toMatchObject({ ok: false, message: 'Higgsfield does not render at 4k' });
	const set = must(await setRerenderSettings(s.deps, s.id, { expected_version: v, render_id: 'render-1', resolution: '1080p', model: 'seedance_2_0' }));
	expect([set.render!.resolution, set.render!.model, set.render!.state]).toEqual(['1080p', 'seedance_2_0', 'to_approve']);
});

test('removing an entry before it is sent takes it out and costs nothing', async () => {
	const s = await setup();
	const v = must(await queueRerenderFor(s.deps, s.id, { expected_version: s.project.version, take_id: 'take1', unchanged: true })).project.version;
	const removed = must(await removeRerender(s.deps, s.id, { expected_version: v, render_id: 'render-1' }));
	expect(removed.project.production.generations).toEqual([]);
	// and the take can be queued afresh
	expect(must(await queueRerenderFor(s.deps, s.id, { expected_version: removed.project.version, take_id: 'take1', unchanged: true })).render!.request_id).toBe('render-2');
});

test('a project that changed underneath is refused', async () => {
	const s = await setup();
	expect(await queueRerenderFor(s.deps, s.id, { expected_version: s.project.version - 1, take_id: 'take1', unchanged: true })).toEqual({ ok: false, status: 409, message: 'Project changed. Reload before continuing.' });
});
