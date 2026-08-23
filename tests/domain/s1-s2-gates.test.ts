import { describe, expect, test } from 'bun:test';
import { applyBriefLock, applyInterviewRound, evaluateInterviewRound } from '../../src/lib/domain/gates';
import { CONFIDENCE_DIMENSIONS, briefVersionSchema, idSchema, projectSchema, recordInterviewRoundCommandSchema } from '../../src/lib/domain/schemas';
import { matchAnswerToLabel } from '../../src/lib/adapters/m3-bridge';
import { applyReconcile } from '../../src/lib/application/gateway';

const base = projectSchema.parse({
	schema_version: 1, project_id: 'project', title: 'Test', created_at: '2026-08-22T00:00:00Z',
	updated_at: '2026-08-22T00:00:00Z', version: 0, stage: { id: 'S0', state: 'BLOCKED', confidence: null },
	seed: { seed_id: 'seed', title: 'Test', brief: '', creative_focus: 'full room', created_by: 'gordo' },
	catalog_snapshot: null, creative_room: null, voices: []
});

const briefVersion = briefVersionSchema.parse({
	brief_id: 'b1', version: 1, title: 'Title', slug: 'title', logline: 'Logline',
	format: { type: 'spot', runtime: '15s', aspect: '16:9', platform: 'web' },
	tone_visual_rules: 'Rules', must_haves: ['One'], must_nots: ['Two'], continuity_model: 'Chain',
	audio_approach: 'Score', success_criteria: ['Done'], content_hash: 'a'.repeat(64), created_at: '2026-08-22T00:00:00Z'
});
const baseWithBrief = projectSchema.parse({ ...base, brief_state: { current_version: 1, versions: [briefVersion] } });
const lockedBase = applyBriefLock(baseWithBrief, {
	briefVersion: 1, briefHash: briefVersion.content_hash, operator: 'gordo', now: '2026-08-22T00:30:00Z'
});

function round(number: number, overall: number, floor = 80) {
	const questions = [{ question_id: `q-${number}`, prompt: 'Owner decision?' }];
	return evaluateInterviewRound({ round_id: `r-${number}`, round_number: number, questions,
		answers: [{ question_id: `q-${number}`, raw_text: 'Exact answer' }],
		scores: CONFIDENCE_DIMENSIONS.map((dimension, index) => ({ dimension, score: index === 0 ? floor : 90, notes: floor < 70 && index === 0 ? 'Resolve this blocker' : '' })),
		overall, lowest_dimension: 'goal_clarity', lowest_score: floor, resolutions: ['Resolved'], created_at: '2026-08-22T00:00:00Z' });
}

describe('S1 confidence gate', () => {
	test('passes only at overall 80 and every dimension 70', () => {
		expect(round(1, 80, 70).status).toBe('PASSED');
		expect(round(1, 90, 69).status).toBe('BLOCKED');
		expect(round(1, 79, 90).status).toBe('BLOCKED');
	});
	test('persists STALLED after three loops below 60', () => {
		let project = applyInterviewRound(lockedBase, round(1, 55, 55));
		project = applyInterviewRound(project, round(2, 58, 58));
		project = applyInterviewRound(project, round(3, 59, 59));
		expect(project.interview.status).toBe('STALLED');
		expect(project.stage.id).toBe('S1');
		expect(project.interview.rounds.at(-1)?.scores.find((score) => score.score < 70)?.notes).toBe('Resolve this blocker');
	});
	test('rejects a stalled round without explicit notes for every below-floor dimension', () => {
		let project = applyInterviewRound(lockedBase, round(1, 55, 55));
		project = applyInterviewRound(project, round(2, 55, 55));
		const third = round(3, 55, 55);
		third.scores[0].notes = '   ';
		expect(() => applyInterviewRound(project, third)).toThrow('blocker notes');
	});
	test('rejects interview evidence before the current brief is locked', () => {
		expect(() => applyInterviewRound(baseWithBrief, round(1, 85, 80))).toThrow('Lock the current brief');
	});
	test('rejects more than five owner questions', () => {
		const parsed = recordInterviewRoundCommandSchema.safeParse({ command: 'record_interview_round', project_id: 'p', expected_version: 0,
			questions: Array.from({ length: 6 }, (_, index) => ({ prompt: `Q${index}`, answer: 'A' })),
			scores: CONFIDENCE_DIMENSIONS.map((dimension) => ({ dimension, score: 80, notes: '' })), overall: 80 });
		expect(parsed.success).toBeFalse();
	});
});

test('IDs are path-safe and S1/S2 required text rejects whitespace-only values', () => {
	expect(idSchema.safeParse('valid_ID-7').success).toBeTrue();
	expect(idSchema.safeParse('../escape').success).toBeFalse();
	expect(recordInterviewRoundCommandSchema.safeParse({ command: 'record_interview_round', project_id: 'p', expected_version: 0,
		questions: [{ prompt: '   ', answer: '\n' }], scores: CONFIDENCE_DIMENSIONS.map((dimension) => ({ dimension, score: 80, notes: '' })), overall: 80 }).success).toBeFalse();
	expect(briefVersionSchema.safeParse({ brief_id: 'b', version: 1, title: ' ', slug: 'ok', logline: 'ok', format: { type: 'ok', runtime: 'ok', aspect: 'ok', platform: 'ok' }, tone_visual_rules: 'ok', must_haves: [' '], must_nots: ['ok'], continuity_model: 'ok', audio_approach: 'ok', success_criteria: ['ok'], content_hash: 'a'.repeat(64), created_at: 'now' }).success).toBeFalse();
});

describe('brief-first lock', () => {
	test('rejects a stale hash, records the owner, then lets a passing interview satisfy S2', () => {
		expect(() => applyBriefLock(baseWithBrief, { briefVersion: 1, briefHash: 'b'.repeat(64), operator: 'gordo', now: '2026-08-22T01:00:00Z' })).toThrow('stale');
		const locked = applyBriefLock(baseWithBrief, { briefVersion: 1, briefHash: 'a'.repeat(64), operator: 'gordo', now: '2026-08-22T01:00:00Z' });
		expect(locked.stage).toEqual({ id: 'S1', state: 'BLOCKED', confidence: null });
		expect(locked.approval_history[0]?.operator).toBe('gordo');
		expect(() => applyBriefLock(locked, { briefVersion: 1, briefHash: 'a'.repeat(64), operator: 'gordo', now: '2026-08-22T01:01:00Z' })).toThrow('already locked');
		expect(applyInterviewRound(locked, round(1, 85, 80)).stage).toEqual({ id: 'S2', state: 'PASSED', confidence: 85 });
	});
});

test('Raycast reconciliation never fuzzy-matches labels', () => {
	const slots = [{ label: 'ChatGPT', raycast_agent: 'Sora 2 - ChatGPT', model_class: 'raycast_ai' as const, provider: 'raycast' as const }];
	expect(matchAnswerToLabel('ChatGPT', slots)?.label).toBe('ChatGPT');
	expect(matchAnswerToLabel('ChatGPT Reasoning', slots)).toBeUndefined();
});

test('Raycast reconciliation adopts an exact model header renamed by the live bridge', () => {
	const project = projectSchema.parse({ ...base, creative_room: { run_id: 'run', bridge_run_id: 'bridge', catalog_hash: 'a'.repeat(64), prompt_hash: 'b'.repeat(64), status: 'running', started_at: 'now', updated_at: 'now', message: null }, voices: [{ voice_id: 'voice', label: 'Claude', raycast_agent: 'Sora 2 - Haiku', job_status: 'running', parse_status: 'pending', raw_text: null, parse_errors: [], content_hash: null, prompt_hash: null, answer_id: null, title: null, logline: null, summary: null, error: null }] });
	const result = applyReconcile(project, { run_id: 'bridge', run_status: 'running', capture_job_status: 'running', models: [{ label: 'Claude', raycast_agent: 'Claude Haiku 4.5', status: 'pending' }], answers_count: 0, captured_valid_count: 0, invalid_count: 0, pending_count: 1, ready_for_projects: false }, null);
	expect(result.changed).toBeTrue();
	expect(result.project.voices[0]?.raycast_agent).toBe('Claude Haiku 4.5');
});

test('invalid structured capture fails the voice and run instead of succeeding', () => {
	const project = projectSchema.parse({ ...base, creative_room: { run_id: 'run', bridge_run_id: 'bridge', catalog_hash: 'a'.repeat(64), prompt_hash: 'b'.repeat(64), status: 'running', started_at: 'now', updated_at: 'now', message: null }, voices: [{ voice_id: 'voice', label: 'Exact', raycast_agent: 'Agent', job_status: 'running', parse_status: 'pending', raw_text: null, parse_errors: [], content_hash: null, prompt_hash: null, answer_id: null, title: null, logline: null, summary: null, error: null }] });
	const result = applyReconcile(project, { run_id: 'bridge', run_status: 'answers_invalid', capture_job_status: 'complete', models: [{ label: 'Exact', raycast_agent: 'Agent', status: 'invalid', answer_id: 'answer' }], answers_count: 1, captured_valid_count: 0, invalid_count: 1, pending_count: 0, ready_for_projects: false }, { run_id: 'bridge', answers_count: 1, answers: [{ answer_id: 'answer', run_id: 'bridge', model_name: 'Exact', answer_text: 'bad', structure_status: 'invalid', structure_errors: ['missing sections'], created_at: 'now', content_sha256: 'c'.repeat(64), prompt_sha256: null, structured_prompt: null }] });
	expect(result.project.voices[0]?.job_status).toBe('failed');
	expect(result.project.creative_room?.status).toBe('failed');
});

test('Raycast reconciliation applies the latest exact-label correction', () => {
	const project = projectSchema.parse({ ...base, creative_room: { run_id: 'run', bridge_run_id: 'bridge', catalog_hash: 'a'.repeat(64), prompt_hash: 'b'.repeat(64), status: 'running', started_at: 'now', updated_at: 'now', message: null }, voices: [{ voice_id: 'voice', label: 'Exact', raycast_agent: 'Agent', job_status: 'running', parse_status: 'pending', raw_text: null, parse_errors: [], content_hash: null, prompt_hash: null, answer_id: null, title: null, logline: null, summary: null, error: null }] });
	const answer = (answer_id: string, title: string) => ({ answer_id, run_id: 'bridge', model_name: 'Exact', answer_text: `TITLE: ${title}`, structure_status: 'valid' as const, structure_errors: [], created_at: 'now', content_sha256: answer_id.padEnd(64, 'c'), prompt_sha256: null, structured_prompt: { title, logline: `${title} logline`, summary: `${title} summary` } });
	const result = applyReconcile(project, { run_id: 'bridge', run_status: 'answers_collected', capture_job_status: 'complete', models: [{ label: 'Exact', raycast_agent: 'Agent', status: 'captured', answer_id: 'latest' }], answers_count: 2, captured_valid_count: 1, invalid_count: 0, pending_count: 0, ready_for_projects: true }, { run_id: 'bridge', answers_count: 2, answers: [answer('first', 'First'), answer('latest', 'Corrected')] });
	expect(result.project.voices[0]?.answer_id).toBe('latest');
	expect(result.project.voices[0]?.title).toBe('Corrected');
});
