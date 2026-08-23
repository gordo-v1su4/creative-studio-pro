import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { CONFIDENCE_DIMENSIONS } from '../../src/lib/domain/schemas';
import { verifyOperatorCredentials } from '../../src/lib/server/operator-credentials';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const briefInput = {
	title: 'Project', slug: 'project', logline: 'A complete logline',
	format: { type: 'spot', runtime: '15s', aspect: '16:9', platform: 'web' },
	tone_visual_rules: 'Dark editorial', must_haves: ['Hero'], must_nots: ['No text artifacts'],
	continuity_model: 'Independent scenes', audio_approach: 'Score', success_criteria: ['Readable title']
};

describe('S1/S2 append-only restart flow', () => {
	test('serializes concurrent same-version mutations so exactly one event appends', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-lock-')); roots.push(root);
		const store = new ProjectStore({ root });
		const project = await store.createProject({ title: 'Atomic', brief: '', creative_focus: 'full room', created_by: 'gordo' });
		const mutations = await Promise.allSettled([
			store.updateProject(project.project_id, 0, (current) => ({ ...current, title: 'Winner A' })),
			store.updateProject(project.project_id, 0, (current) => ({ ...current, title: 'Winner B' }))
		]);
		expect(mutations.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		expect(mutations.filter((result) => result.status === 'rejected')).toHaveLength(1);
		const lines = (await readFile(join(root, project.project_id, 'ledger.jsonl'), 'utf8')).trim().split('\n');
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[1]).payload.version).toBe(1);
	});

	test('survives restart and rejects stale lock versions', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-s1-s2-')); roots.push(root);
		const gateway = new ProjectCommandGateway(new ProjectStore({ root }));
		const created = await gateway.createProject({ command: 'create_project', title: 'Project', brief: 'seed', creative_focus: 'full room', created_by: 'gordo' });
		if (!created.ok) throw new Error(created.error.message);
		const saved = await gateway.saveBrief({ command: 'save_brief', project_id: created.data.project_id, expected_version: created.data.version, brief: briefInput });
		if (!saved.ok) throw new Error(saved.error.message);
		const brief = saved.data.brief_state.versions.at(-1)!;
		const stale = await gateway.lockBrief({ command: 'lock_brief', project_id: saved.data.project_id, expected_version: created.data.version, brief_version: brief.version, brief_hash: brief.content_hash, operator: 'gordo' });
		expect(stale.ok).toBeFalse();
		const locked = await gateway.lockBrief({ command: 'lock_brief', project_id: saved.data.project_id, expected_version: saved.data.version, brief_version: brief.version, brief_hash: brief.content_hash, operator: 'gordo' });
		if (!locked.ok) throw new Error(locked.error.message);
		const interview = await gateway.recordInterviewRound({ command: 'record_interview_round', project_id: created.data.project_id, expected_version: locked.data.version,
			questions: [{ prompt: 'Runtime?', answer: '15 seconds' }], scores: CONFIDENCE_DIMENSIONS.map((dimension) => ({ dimension, score: 85, notes: 'known' })), overall: 85, resolutions: ['Runtime'] });
		if (!interview.ok) throw new Error(interview.error.message);
		const reopened = await new ProjectStore({ root }).readProject(saved.data.project_id);
		expect(reopened?.stage).toEqual({ id: 'S2', state: 'PASSED', confidence: 85 });
		expect(reopened?.interview.rounds[0]?.answers[0]?.raw_text).toBe('15 seconds');
		expect(reopened?.approval_history[0]?.brief_hash).toBe(brief.content_hash);
	});

	test('unauthenticated and wrong credentials cannot yield an operator', () => {
		expect(verifyOperatorCredentials(new Request('http://local'), 'secret', 'gordo').ok).toBeFalse();
		expect(verifyOperatorCredentials(new Request('http://local', { headers: { authorization: 'Bearer wrong' } }), 'secret', 'gordo').ok).toBeFalse();
		expect(verifyOperatorCredentials(new Request('http://local', { headers: { authorization: 'Bearer secret' } }), 'secret', 'gordo')).toEqual({ ok: true, operator: 'gordo' });
		expect(verifyOperatorCredentials(new Request('http://local', { headers: { authorization: 'Bearer secret trailing' } }), 'secret', 'gordo').ok).toBeFalse();
	});

	test('persists a third-round stall across restart and rejects round four or brief replacement', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-stall-')); roots.push(root);
		let gateway = new ProjectCommandGateway(new ProjectStore({ root }));
		const created = await gateway.createProject({ command: 'create_project', title: 'Stall', brief: '', creative_focus: 'full room', created_by: 'gordo' });
		if (!created.ok) throw new Error(created.error.message);
		const saved = await gateway.saveBrief({ command: 'save_brief', project_id: created.data.project_id, expected_version: created.data.version, brief: { ...briefInput, title: 'Stall', slug: 'stall' } });
		if (!saved.ok) throw new Error(saved.error.message);
		const currentBrief = saved.data.brief_state.versions.at(-1)!;
		const locked = await gateway.lockBrief({ command: 'lock_brief', project_id: saved.data.project_id, expected_version: saved.data.version, brief_version: currentBrief.version, brief_hash: currentBrief.content_hash, operator: 'gordo' });
		if (!locked.ok) throw new Error(locked.error.message);
		let project = locked.data;
		for (let round = 1; round <= 3; round += 1) {
			const result = await gateway.recordInterviewRound({ command: 'record_interview_round', project_id: project.project_id, expected_version: project.version,
				questions: [{ prompt: `Decision ${round}?`, answer: 'Unknown' }], scores: CONFIDENCE_DIMENSIONS.map((dimension) => ({ dimension, score: 55, notes: `Blocker for ${dimension}` })), overall: 55, resolutions: [] });
			if (!result.ok) throw new Error(result.error.message);
			project = result.data;
		}
		gateway = new ProjectCommandGateway(new ProjectStore({ root }));
		const reopened = await new ProjectStore({ root }).readProject(project.project_id);
		expect(reopened?.interview.status).toBe('STALLED');
		const fourth = await gateway.recordInterviewRound({ command: 'record_interview_round', project_id: project.project_id, expected_version: project.version,
			questions: [{ prompt: 'Again?', answer: 'Still unknown' }], scores: CONFIDENCE_DIMENSIONS.map((dimension) => ({ dimension, score: 55, notes: 'Blocked' })), overall: 55, resolutions: [] });
		expect(fourth.ok).toBeFalse();
		const brief = await gateway.saveBrief({ command: 'save_brief', project_id: project.project_id, expected_version: project.version, brief: { title: 'No', slug: 'no', logline: 'No', format: { type: 'spot', runtime: '15s', aspect: '16:9', platform: 'web' }, tone_visual_rules: 'No', must_haves: ['No'], must_nots: ['No'], continuity_model: 'No', audio_approach: 'No', success_criteria: ['No'] } });
		expect(brief.ok).toBeFalse();
		expect((await new ProjectStore({ root }).readProject(project.project_id))?.approval_history).toHaveLength(1);
	});
});
