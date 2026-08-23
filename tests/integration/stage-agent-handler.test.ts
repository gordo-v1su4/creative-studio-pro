import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { CONFIDENCE_DIMENSIONS } from '../../src/lib/domain/schemas';
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

function fakeAgent(options: { score?: number; fail?: boolean; calls?: { starts: number; evaluations: number } } = {}): StageAgent {
	return {
		provider: 'kimi', model: 'k3',
		async start() { if (options.calls) options.calls.starts += 1; return { message: 'Let us sharpen the brief.', next_question: 'What is the irreversible climax choice?' }; },
		async evaluate() { if (options.calls) options.calls.evaluations += 1; if (options.fail) throw new Error('provider unavailable'); return evaluation(options.score ?? 75); }
	};
}

async function setup() {
	const root = await mkdtemp(join(tmpdir(), 'csp-stage-agent-')); roots.push(root);
	const store = new ProjectStore({ root });
	const gateway = new ProjectCommandGateway(store);
	const created = await gateway.createProject({ command: 'create_project', title: 'Agent Project', brief: 'A neon crime trailer', creative_focus: 'full room', created_by: 'gordo' });
	if (!created.ok) throw new Error(created.error.message);
	return { root, store, gateway, project: created.data };
}

describe('Stage Agent HTTP application boundary', () => {
	test('opens with one generated question without mutating the project', async () => {
		const { root, store, gateway, project } = await setup();
		const result = await handleStageAgent(project.project_id, { mode: 'start' }, { store, gateway, agent: fakeAgent() });
		expect(result.status).toBe(200);
		expect((result.body.data as { next_question: string }).next_question).toContain('climax');
		expect((await store.readProject(project.project_id))?.version).toBe(0);
	});

	test('records an answered round, returns one next question, and reconstructs after restart', async () => {
		const { root, store, gateway, project } = await setup();
		const result = await handleStageAgent(project.project_id, { mode: 'answer', expected_version: 0, question: 'Who makes the final choice?', answer: 'Nina destroys the formula live on camera.' }, { store, gateway, agent: fakeAgent({ score: 75 }) });
		expect(result.status).toBe(200);
		const data = result.body.data as { project: typeof project; next_question: string };
		expect(data.project.interview.rounds[0]?.answers[0]?.raw_text).toContain('destroys the formula');
		expect(data.next_question).toContain('constraint');
		const reopened = await new ProjectStore({ root }).readProject(project.project_id);
		expect(reopened?.interview.rounds).toHaveLength(1);
	});

	test('uses the gateway result to pass S1 and moves the canonical project to S2', async () => {
		const { store, gateway, project } = await setup();
		const result = await handleStageAgent(project.project_id, { mode: 'answer', expected_version: 0, question: 'Is everything approved?', answer: 'Yes, all eight dimensions are explicitly locked.' }, { store, gateway, agent: fakeAgent({ score: 85 }) });
		const data = result.body.data as { project: typeof project; next_question: null; message: string };
		expect(data.project.stage.id).toBe('S2');
		expect(data.next_question).toBeNull();
		expect(data.message).toContain('S1 is passed');
	});

	test('provider failure and stale version append nothing and preserve retryability', async () => {
		const { store, gateway, project } = await setup();
		const failed = await handleStageAgent(project.project_id, { mode: 'answer', expected_version: 0, question: 'Decision?', answer: 'Keep this editable for retry.' }, { store, gateway, agent: fakeAgent({ fail: true }) });
		expect(failed.status).toBe(502);
		expect((await store.readProject(project.project_id))?.version).toBe(0);

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
