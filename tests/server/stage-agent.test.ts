import { describe, expect, test } from 'bun:test';
import { CONFIDENCE_DIMENSIONS, projectSchema } from '../../src/lib/domain/schemas';
import { buildStageAgentProjectEvidence, createStageAgent, extractJsonObject, fallbackQuestion, stageAgentEvaluationSchema, stageAgentStartSchema } from '../../src/lib/server/stage-agent';

describe('Stage Agent response contract', () => {
	test('accepts strict start and complete eight-dimension evaluation objects', () => {
		expect(stageAgentStartSchema.parse({ message: 'Let us resolve the story.', next_question: 'What changes at the climax?' }).next_question).toContain('climax');
		const parsed = stageAgentEvaluationSchema.parse({
			message: 'That establishes the climax.',
			scores: CONFIDENCE_DIMENSIONS.map((dimension) => ({ dimension, score: 80, notes: 'Supported by the owner answer' })),
			overall: 80,
			resolutions: ['Climax choice'],
			next_question: null
		});
		expect(parsed.scores).toHaveLength(8);
	});

	test('rejects duplicate dimensions and malformed provider text', () => {
		const duplicate = CONFIDENCE_DIMENSIONS.map(() => ({ dimension: 'goal_clarity' as const, score: 80, notes: 'Repeated' }));
		expect(stageAgentEvaluationSchema.safeParse({ message: 'No', scores: duplicate, overall: 80, resolutions: [], next_question: null }).success).toBeFalse();
		expect(() => extractJsonObject('not json')).toThrow('no JSON object');
	});

	test('extracts a fenced JSON response and supplies a deterministic gap question', () => {
		expect(extractJsonObject('```json\n{"message":"Hi","next_question":"Why?"}\n```')).toEqual({ message: 'Hi', next_question: 'Why?' });
		expect(fallbackQuestion('story_beats', 'Climax is unresolved')).toContain('Climax is unresolved');
	});

	test('serializes the exact owner-approved brief as locked interview evidence', () => {
		const hash = 'a'.repeat(64);
		const project = projectSchema.parse({ schema_version: 1, project_id: 'p', title: 'Pilot', created_at: 'now', updated_at: 'now', version: 2,
			stage: { id: 'S1', state: 'BLOCKED', confidence: null }, seed: { seed_id: 's', title: 'Old seed', brief: 'Historical only', creative_focus: 'full room', created_by: 'gordo' },
			brief_state: { current_version: 1, versions: [{ brief_id: 'b', version: 1, title: 'Locked pilot', slug: 'locked-pilot', logline: 'Exact logline', format: { type: 'teaser', runtime: '60s', aspect: '16:9', platform: 'pitch' }, tone_visual_rules: 'Teal night', must_haves: ['Nina'], must_nots: ['No season ending'], continuity_model: 'Locked faces', audio_approach: 'Trailer House', success_criteria: ['Pilot-first'], content_hash: hash, created_at: 'now' }] },
			approval_history: [{ event: 'brief_locked', brief_id: 'b', brief_version: 1, brief_hash: hash, operator: 'gordo', timestamp: 'now' }], catalog_snapshot: null, creative_room: null, voices: [] });
		const evidence = JSON.parse(buildStageAgentProjectEvidence(project));
		expect(evidence.locked_brief.logline).toBe('Exact logline');
		expect(evidence.locked_brief.content_hash).toBe(hash);
		expect(evidence.locked_brief.approval.operator).toBe('gordo');
	});

	test('starts from an unresolved story choice instead of re-asking locked format facts', async () => {
		const project = projectSchema.parse({ schema_version: 1, project_id: 'p', title: 'Pilot', created_at: 'now', updated_at: 'now', version: 2,
			stage: { id: 'S1', state: 'BLOCKED', confidence: null }, seed: { seed_id: 's', title: 'Pilot', brief: '', creative_focus: 'full room', created_by: 'gordo' }, catalog_snapshot: null, creative_room: null, voices: [] });
		const opening = await createStageAgent({ apiKey: 'not-used-for-start' }).start(project);
		expect(opening.next_question).toContain('climax shape');
		expect(opening.next_question).not.toContain('delivery format');
	});
});
