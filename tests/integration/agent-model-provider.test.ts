import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { CONFIDENCE_DIMENSIONS } from '../../src/lib/domain/schemas';
import type { ModelChoice } from '../../src/lib/domain/model-provider';
import { AppSettingsStore, appSettingsPath } from '../../src/lib/server/app-settings';
import { resolveAgentModel } from '../../src/lib/server/model-provider';
import type { AgentModelClient } from '../../src/lib/server/model-provider';
import { handleProjectModelChange } from '../../src/lib/server/project-model-handler';
import { createStageAgent } from '../../src/lib/server/stage-agent';
import { handleStageAgent } from '../../src/lib/server/stage-agent-handler';
import type { StageAgentSource } from '../../src/lib/server/stage-agent-handler';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const HYPER = 'https://hyper.charm.land/v1';
const deepseek: ModelChoice = { provider: 'hyper', model: 'deepseek-v4.1-flash', base_url: HYPER };
const glm: ModelChoice = { provider: 'hyper', model: 'glm-5.3-flash', base_url: HYPER };
const SECRET = 'hyper-secret-never-in-ledger';

const goodAnswer = JSON.stringify({
	message: 'Recorded.',
	scores: CONFIDENCE_DIMENSIONS.map((dimension) => ({ dimension, score: 75, notes: 'Known from evidence' })),
	overall: 75,
	resolutions: ['Climax choice'],
	next_question: 'Which constraint is non-negotiable?'
});
const badAnswer = JSON.stringify({ message: 'Recorded.', scores: [], overall: 'high' });

/** Fake provider client: canned answers in order, counts calls. */
function fakeProvider(answers: string[], choice: ModelChoice = deepseek) {
	const calls: string[] = [];
	const client: AgentModelClient = {
		choice,
		async generate({ prompt }) { calls.push(prompt); return answers[Math.min(calls.length - 1, answers.length - 1)] ?? ''; }
	};
	return { client, calls };
}

async function setup() {
	const root = await mkdtemp(join(tmpdir(), 'csp-model-')); roots.push(root);
	const projectRoot = join(root, 'projects');
	const store = new ProjectStore({ root: projectRoot });
	const gateway = new ProjectCommandGateway(store);
	const settings = new AppSettingsStore(appSettingsPath(projectRoot));
	await settings.update((current) => ({ ...current, hyper: { api_key: SECRET }, default_model: deepseek }));
	const created = await gateway.createProject({ command: 'create_project', title: 'Model Project', brief: 'A rain-soaked crime trailer', creative_focus: 'full room', created_by: 'gordo' });
	if (!created.ok) throw new Error(created.error.message);
	const saved = await gateway.saveBrief({ command: 'save_brief', project_id: created.data.project_id, expected_version: created.data.version, brief: {
		title: 'Model Project', slug: 'model-project', logline: 'Nina must choose whether to destroy the formula.',
		format: { type: 'teaser', runtime: '60s', aspect: '16:9', platform: 'pitch' }, tone_visual_rules: 'Anamorphic realism',
		must_haves: ['Nina'], must_nots: ['No season ending'], continuity_model: 'Locked character sheets',
		audio_approach: 'Trailer House', success_criteria: ['Pilot-first story']
	} });
	if (!saved.ok) throw new Error(saved.error.message);
	const brief = saved.data.brief_state.versions.at(-1)!;
	const locked = await gateway.lockBrief({ command: 'lock_brief', project_id: saved.data.project_id, expected_version: saved.data.version, brief_version: brief.version, brief_hash: brief.content_hash, operator: 'gordo' });
	if (!locked.ok) throw new Error(locked.error.message);
	return { root, projectRoot, store, gateway, settings, project: locked.data };
}

/** The app's resolver path (lock → default → env) with a fake client in place of the network. */
function resolver(settings: AppSettingsStore, clients: Partial<Record<string, AgentModelClient>>): StageAgentSource {
	return async (project) => {
		const resolved = await resolveAgentModel(project, { settings: await settings.read(), env: {}, raycast: null });
		if (!resolved.ok) return { ok: false, code: resolved.code, message: resolved.message };
		const client = clients[resolved.connection.choice.model];
		if (!client) throw new Error(`test asked for unexpected model ${resolved.connection.choice.model}`);
		return { ok: true, agent: createStageAgent({ client }) };
	};
}

const answer = (version: number) => ({ mode: 'answer', expected_version: version, question: 'Who makes the final choice?', answer: 'Nina destroys the formula live on camera.' });

describe('Agent on a Model provider (fake provider)', () => {
	test('good answer: round recorded and the project locks to the model that ran, logged in the ledger', async () => {
		const { projectRoot, store, gateway, settings, project } = await setup();
		const provider = fakeProvider([goodAnswer]);
		const result = await handleStageAgent(project.project_id, answer(project.version), { store, gateway, agent: resolver(settings, { 'deepseek-v4.1-flash': provider.client }), operator: 'gordo' });
		expect(result.status).toBe(200);
		expect(result.body.data).toMatchObject({ provider: 'hyper', model: 'deepseek-v4.1-flash' });
		const reopened = await new ProjectStore({ root: projectRoot }).readProject(project.project_id);
		expect(reopened?.interview.rounds).toHaveLength(1);
		expect(reopened?.agent_model.override).toEqual(deepseek);
		expect(reopened?.agent_model.locked_at).not.toBeNull();
		expect(reopened?.agent_model.history.at(-1)).toMatchObject({ event: 'locked', to: deepseek, operator: 'gordo' });
		const ledger = await readFile(join(projectRoot, project.project_id, 'ledger.jsonl'), 'utf8');
		const types = ledger.trim().split('\n').map((line) => JSON.parse(line).type);
		expect(types.slice(-2)).toEqual(['project.agent_model_locked.v1', 'project.interview_round_recorded.v1']);
		expect(ledger).not.toContain(SECRET);
		expect(provider.calls).toHaveLength(1);
	});

	test('locked project ignores a new app default; the next run uses the locked model', async () => {
		const { store, gateway, settings, project } = await setup();
		const first = await handleStageAgent(project.project_id, answer(project.version), { store, gateway, agent: resolver(settings, { 'deepseek-v4.1-flash': fakeProvider([goodAnswer]).client }) });
		const version = (first.body.data as { project: { version: number } }).project.version;
		await settings.update((current) => ({ ...current, default_model: glm }));
		const locked = fakeProvider([goodAnswer]);
		const second = await handleStageAgent(project.project_id, answer(version), { store, gateway, agent: resolver(settings, { 'deepseek-v4.1-flash': locked.client }) });
		expect(second.status).toBe(200);
		expect(locked.calls).toHaveLength(1);
	});

	test('bad answer: retried once with the error, then a visible stop; nothing appended, nothing locked', async () => {
		const { store, gateway, settings, project } = await setup();
		const provider = fakeProvider([badAnswer, badAnswer]);
		const result = await handleStageAgent(project.project_id, answer(project.version), { store, gateway, agent: resolver(settings, { 'deepseek-v4.1-flash': provider.client }) });
		expect(result.status).toBe(422);
		expect(result.body.error).toMatchObject({ code: 'AGENT_RULE_BREAK' });
		expect((result.body.error as { message: string }).message).toContain('No other model was tried');
		expect(provider.calls).toHaveLength(2);
		expect(provider.calls[1]).toContain('YOUR PREVIOUS ANSWER BROKE THE RULES');
		const reopened = await store.readProject(project.project_id);
		expect(reopened?.version).toBe(project.version);
		expect(reopened?.agent_model.locked_at).toBeNull();
	});

	test('bad then good answer: the single retry recovers', async () => {
		const { store, gateway, settings, project } = await setup();
		const provider = fakeProvider([badAnswer, goodAnswer]);
		const result = await handleStageAgent(project.project_id, answer(project.version), { store, gateway, agent: resolver(settings, { 'deepseek-v4.1-flash': provider.client }) });
		expect(result.status).toBe(200);
		expect(provider.calls).toHaveLength(2);
	});

	test('a fixed agent on another model cannot run a locked project', async () => {
		const { store, gateway, settings, project } = await setup();
		const first = await handleStageAgent(project.project_id, answer(project.version), { store, gateway, agent: resolver(settings, { 'deepseek-v4.1-flash': fakeProvider([goodAnswer]).client }) });
		const version = (first.body.data as { project: { version: number } }).project.version;
		const other = fakeProvider([goodAnswer], glm);
		const blocked = await handleStageAgent(project.project_id, answer(version), { store, gateway, agent: createStageAgent({ client: other.client }) });
		expect(blocked.status).toBe(409);
		expect(blocked.body.error).toMatchObject({ code: 'MODEL_LOCKED' });
		expect(other.calls).toHaveLength(0);
	});

	test('missing provider key stops with NOT_CONFIGURED instead of falling back', async () => {
		const { store, gateway, settings, project } = await setup();
		await settings.update((current) => ({ ...current, hyper: { api_key: null } }));
		const result = await handleStageAgent(project.project_id, { mode: 'start' }, { store, gateway, agent: resolver(settings, {}) });
		expect(result.status).toBe(503);
		expect(result.body.error).toMatchObject({ code: 'NOT_CONFIGURED' });
	});
});

describe('Project model commands (command in → persisted project out)', () => {
	test('override before the lock, then an explicit, confirmed, reasoned switch after it', async () => {
		const { projectRoot, gateway, settings, project } = await setup();
		const settingsDeps = { settings, env: {}, raycast: null };

		const override = await handleProjectModelChange(project.project_id, { expected_version: project.version, choice: { provider: 'hyper', model: 'glm-5.3-flash' } }, { gateway, settings: settingsDeps, operator: 'gordo' });
		expect(override.status).toBe(200);
		let current = override.body.data as typeof project;
		expect(current.agent_model.override).toEqual(glm);
		expect(current.agent_model.locked_at).toBeNull();

		const lock = await gateway.lockProjectModel({ command: 'lock_project_model', project_id: project.project_id, expected_version: current.version, choice: glm, operator: 'gordo' });
		if (!lock.ok) throw new Error(lock.error.message);
		current = lock.data;
		const again = await gateway.lockProjectModel({ command: 'lock_project_model', project_id: project.project_id, expected_version: current.version, choice: glm, operator: 'gordo' });
		expect(again.ok && again.data.version).toBe(current.version);

		const unconfirmed = await handleProjectModelChange(project.project_id, { expected_version: current.version, choice: { provider: 'hyper', model: 'deepseek-v4.1-flash' }, reason: 'cheaper' }, { gateway, settings: settingsDeps, operator: 'gordo' });
		expect(unconfirmed.status).toBe(400);
		const toDefault = await handleProjectModelChange(project.project_id, { expected_version: current.version, choice: null, reason: 'reset', confirm_switch: true }, { gateway, settings: settingsDeps, operator: 'gordo' });
		expect(toDefault.status).toBe(400);
		const notVision = await handleProjectModelChange(project.project_id, { expected_version: current.version, choice: { provider: 'hyper', model: 'text-only-1' }, reason: 'why not', confirm_switch: true }, {
			gateway, settings: { ...settingsDeps, fetch: async () => new Response(JSON.stringify({ data: [{ id: 'text-only-1', input_modalities: ['text'] }] })) }, operator: 'gordo'
		});
		expect(notVision.status).toBe(400);
		expect(notVision.body.error).toMatchObject({ code: 'NOT_VISION_CAPABLE' });

		const switched = await handleProjectModelChange(project.project_id, { expected_version: current.version, choice: { provider: 'hyper', model: 'deepseek-v4.1-flash' }, reason: 'Cheaper vision model', confirm_switch: true }, { gateway, settings: settingsDeps, operator: 'gordo' });
		expect(switched.status).toBe(200);

		const reopened = await new ProjectStore({ root: projectRoot }).readProject(project.project_id);
		expect(reopened?.agent_model.override).toEqual(deepseek);
		expect(reopened?.agent_model.history.map((entry) => entry.event)).toEqual(['override_set', 'locked', 'switched']);
		expect(reopened?.agent_model.history.at(-1)).toMatchObject({ from: glm, to: deepseek, reason: 'Cheaper vision model', operator: 'gordo' });
		const ledger = await readFile(join(projectRoot, project.project_id, 'ledger.jsonl'), 'utf8');
		const types = ledger.trim().split('\n').map((line) => JSON.parse(line).type);
		expect(types.filter((type) => type.startsWith('project.agent_model'))).toEqual(['project.agent_model_set.v1', 'project.agent_model_locked.v1', 'project.agent_model_switched.v1']);
		expect(ledger).not.toContain(SECRET);
	});

	test('stale versions are rejected and nothing is appended', async () => {
		const { gateway, settings, project } = await setup();
		const stale = await handleProjectModelChange(project.project_id, { expected_version: project.version + 5, choice: { provider: 'hyper', model: 'glm-5.3-flash' } }, { gateway, settings: { settings, env: {}, raycast: null }, operator: 'gordo' });
		expect(stale.status).toBe(409);
	});
});
