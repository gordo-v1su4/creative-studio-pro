import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { CONFIDENCE_DIMENSIONS, type Project } from '../../src/lib/domain/schemas';
import type { StageAgent, StageAgentEvaluation } from '../../src/lib/server/stage-agent';
import { handleStageAgent } from '../../src/lib/server/stage-agent-handler';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function evaluation(score: number, nextQuestion: string | null = 'Which constraint is non-negotiable?'): StageAgentEvaluation {
	return {
		message: 'I recorded that decision.',
		scores: CONFIDENCE_DIMENSIONS.map((dimension) => ({ dimension, score, notes: score >= 70 ? 'Known from evidence' : `Resolve ${dimension}` })),
		overall: score,
		resolutions: ['Latest owner decision'],
		next_question: nextQuestion
	};
}

function fakeAgent(options: { score?: number; fail?: boolean; calls?: { starts: number; evaluations: number }; projects?: Project[] } = {}): StageAgent {
	return {
		provider: 'kimi', model: 'k3',
		async start(project) { if (options.calls) options.calls.starts += 1; options.projects?.push(project); return { message: 'Let us sharpen the brief.', next_question: 'What is the irreversible climax choice?' }; },
		async evaluate(project) { if (options.calls) options.calls.evaluations += 1; options.projects?.push(project); if (options.fail) throw new Error('provider unavailable'); return evaluation(options.score ?? 75); }
	};
}

async function setup(options: { lockBrief?: boolean } = {}) {
	const root = await mkdtemp(join(tmpdir(), 'csp-stage-agent-')); roots.push(root);
	const store = new ProjectStore({ root });
	const gateway = new ProjectCommandGateway(store);
	const created = await gateway.createProject({ command: 'create_project', title: 'Agent Project', brief: 'A neon crime trailer', creative_focus: 'full room', created_by: 'gordo' });
	if (!created.ok) throw new Error(created.error.message);
	if (options.lockBrief === false) return { root, store, gateway, project: created.data };
	const saved = await gateway.saveBrief({ command: 'save_brief', project_id: created.data.project_id, expected_version: created.data.version, brief: {
		title: 'Agent Project', slug: 'agent-project', logline: 'Nina must choose whether to destroy the formula.',
		format: { type: 'teaser', runtime: '60s', aspect: '16:9', platform: 'pitch' }, tone_visual_rules: 'Neon anamorphic realism',
		must_haves: ['Nina', 'Jess'], must_nots: ['No full season ending'], continuity_model: 'Locked character sheets',
		audio_approach: 'Trailer House', success_criteria: ['Pilot-first story']
	} });
	if (!saved.ok) throw new Error(saved.error.message);
	const brief = saved.data.brief_state.versions.at(-1)!;
	const locked = await gateway.lockBrief({ command: 'lock_brief', project_id: saved.data.project_id, expected_version: saved.data.version, brief_version: brief.version, brief_hash: brief.content_hash, operator: 'gordo' });
	if (!locked.ok) throw new Error(locked.error.message);
	return { root, store, gateway, project: locked.data };
}

describe('Stage Agent HTTP application boundary', () => {
	test('opens with one generated question without mutating the project', async () => {
		const { root, store, gateway, project } = await setup();
		const projects: Project[] = [];
		const result = await handleStageAgent(project.project_id, { mode: 'start' }, { store, gateway, agent: fakeAgent({ projects }) });
		expect(result.status).toBe(200);
		expect((result.body.data as { next_question: string }).next_question).toContain('climax');
		expect((await store.readProject(project.project_id))?.version).toBe(project.version);
		expect(projects[0]?.brief_state.current_version).toBe(1);
		expect(projects[0]?.approval_history[0]?.brief_hash).toBe(projects[0]?.brief_state.versions[0]?.content_hash);
	});

	test('refuses to start or answer before the current brief is locked', async () => {
		const { store, gateway, project } = await setup({ lockBrief: false });
		const calls = { starts: 0, evaluations: 0 };
		expect((await handleStageAgent(project.project_id, { mode: 'start' }, { store, gateway, agent: fakeAgent({ calls }) })).status).toBe(409);
		expect((await handleStageAgent(project.project_id, { mode: 'answer', expected_version: project.version, question: 'Ready?', answer: 'Yes' }, { store, gateway, agent: fakeAgent({ calls }) })).status).toBe(409);
		expect(calls).toEqual({ starts: 0, evaluations: 0 });
	});

	test('records an answered round, returns one next question, and reconstructs after restart', async () => {
		const { root, store, gateway, project } = await setup();
		const result = await handleStageAgent(project.project_id, { mode: 'answer', expected_version: project.version, question: 'Who makes the final choice?', answer: 'Nina destroys the formula live on camera.' }, { store, gateway, agent: fakeAgent({ score: 75 }) });
		expect(result.status).toBe(200);
		const data = result.body.data as { project: typeof project; next_question: string };
		expect(data.project.interview.rounds[0]?.answers[0]?.raw_text).toContain('destroys the formula');
		expect(data.next_question).toContain('constraint');
		const reopened = await new ProjectStore({ root }).readProject(project.project_id);
		expect(reopened?.interview.rounds).toHaveLength(1);
	});

	test('uses the gateway result to pass S1 and moves the canonical project to S2', async () => {
		const { store, gateway, project } = await setup();
		const result = await handleStageAgent(project.project_id, { mode: 'answer', expected_version: project.version, question: 'Is everything approved?', answer: 'Yes, all eight dimensions are explicitly locked.' }, { store, gateway, agent: fakeAgent({ score: 85 }) });
		const data = result.body.data as { project: typeof project; next_question: null; message: string };
		expect(data.project.stage.id).toBe('S2');
		expect(data.next_question).toBeNull();
		expect(data.message).toContain('S1 is passed');
	});

	test('provider failure and stale version append nothing and preserve retryability', async () => {
		const { store, gateway, project } = await setup();
		const failed = await handleStageAgent(project.project_id, { mode: 'answer', expected_version: project.version, question: 'Decision?', answer: 'Keep this editable for retry.' }, { store, gateway, agent: fakeAgent({ fail: true }) });
		expect(failed.status).toBe(502);
		expect((await store.readProject(project.project_id))?.version).toBe(project.version);

		const calls = { starts: 0, evaluations: 0 };
		const stale = await handleStageAgent(project.project_id, { mode: 'answer', expected_version: 9, question: 'Decision?', answer: 'Do not spend a provider call.' }, { store, gateway, agent: fakeAgent({ calls }) });
		expect(stale.status).toBe(409);
		expect(calls.evaluations).toBe(0);
		expect((await store.readProject(project.project_id))?.interview.rounds).toHaveLength(0);
	});

	test('reports unconfigured Kimi and missing projects explicitly', async () => {
		const { store, gateway, project } = await setup();
		expect((await handleStageAgent(project.project_id, { mode: 'start' }, { store, gateway, agent: null })).status).toBe(503);
		expect((await handleStageAgent('missing', { mode: 'start' }, { store, gateway, agent: fakeAgent() })).status).toBe(404);
	});
});
