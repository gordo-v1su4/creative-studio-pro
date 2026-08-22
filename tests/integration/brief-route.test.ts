import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { CONFIDENCE_DIMENSIONS } from '../../src/lib/domain/schemas';
import { verifyOperatorCredentials } from '../../src/lib/server/operator-credentials';
import { handleBriefLockRequest } from '../../src/lib/server/brief-lock-handler';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const request = (body: object, authorization?: string) => new Request('http://local/api/brief', { method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body) });

describe('brief lock route authentication and gate ownership', () => {
	test('rejects unconfigured, missing, wrong, pre-S1, and no-brief requests without approval events', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-route-')); roots.push(root);
		const store = new ProjectStore({ root }); const gateway = new ProjectCommandGateway(store);
		const created = await gateway.createProject({ command: 'create_project', title: 'Route', brief: '', creative_focus: 'full room', created_by: 'gordo' });
		if (!created.ok) throw new Error(created.error.message);
		const body = { expected_version: 0, brief_version: 1, brief_hash: 'a'.repeat(64), operator: 'mallory' };
		expect((await handleBriefLockRequest(request(body, 'Bearer secret'), created.data.project_id, { gateway, authenticate: (r) => verifyOperatorCredentials(r, undefined, undefined) })).status).toBe(503);
		expect((await handleBriefLockRequest(request(body), created.data.project_id, { gateway, authenticate: (r) => verifyOperatorCredentials(r, 'secret', 'gordo') })).status).toBe(401);
		expect((await handleBriefLockRequest(request(body, 'Bearer wrong'), created.data.project_id, { gateway, authenticate: (r) => verifyOperatorCredentials(r, 'secret', 'gordo') })).status).toBe(401);
		expect((await handleBriefLockRequest(request(body, 'Bearer secret'), created.data.project_id, { gateway, authenticate: (r) => verifyOperatorCredentials(r, 'secret', 'gordo') })).status).toBe(400);
		const passed = await gateway.recordInterviewRound({ command: 'record_interview_round', project_id: created.data.project_id, expected_version: 0, questions: [{ prompt: 'Ready?', answer: 'Yes' }], scores: CONFIDENCE_DIMENSIONS.map((dimension) => ({ dimension, score: 85, notes: 'Known' })), overall: 85, resolutions: [] });
		if (!passed.ok) throw new Error(passed.error.message);
		expect((await handleBriefLockRequest(request({ ...body, expected_version: passed.data.version }, 'Bearer secret'), created.data.project_id, { gateway, authenticate: (r) => verifyOperatorCredentials(r, 'secret', 'gordo') })).status).toBe(400);
		expect((await store.readProject(created.data.project_id))?.approval_history).toHaveLength(0);
	});

	test('ignores body operator override and attributes a valid lock to the server operator', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-route-valid-')); roots.push(root);
		const store = new ProjectStore({ root }); const gateway = new ProjectCommandGateway(store);
		const created = await gateway.createProject({ command: 'create_project', title: 'Route', brief: '', creative_focus: 'full room', created_by: 'gordo' }); if (!created.ok) throw new Error(created.error.message);
		const passed = await gateway.recordInterviewRound({ command: 'record_interview_round', project_id: created.data.project_id, expected_version: 0, questions: [{ prompt: 'Ready?', answer: 'Yes' }], scores: CONFIDENCE_DIMENSIONS.map((dimension) => ({ dimension, score: 85, notes: 'Known' })), overall: 85, resolutions: [] }); if (!passed.ok) throw new Error(passed.error.message);
		const saved = await gateway.saveBrief({ command: 'save_brief', project_id: created.data.project_id, expected_version: passed.data.version, brief: { title: 'Title', slug: 'title', logline: 'Logline', format: { type: 'spot', runtime: '15s', aspect: '16:9', platform: 'web' }, tone_visual_rules: 'Rules', must_haves: ['Hero'], must_nots: ['Artifacts'], continuity_model: 'Chain', audio_approach: 'Score', success_criteria: ['Readable'] } }); if (!saved.ok) throw new Error(saved.error.message);
		const brief = saved.data.brief_state.versions.at(-1)!;
		const response = await handleBriefLockRequest(request({ expected_version: saved.data.version, brief_version: brief.version, brief_hash: brief.content_hash, operator: 'mallory' }, 'Bearer secret'), saved.data.project_id, { gateway, authenticate: (r) => verifyOperatorCredentials(r, 'secret', 'gordo') });
		expect(response.status).toBe(200);
		expect((await store.readProject(saved.data.project_id))?.approval_history.at(-1)?.operator).toBe('gordo');
	});
});
