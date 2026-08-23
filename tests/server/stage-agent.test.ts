import { describe, expect, test } from 'bun:test';
import { CONFIDENCE_DIMENSIONS } from '../../src/lib/domain/schemas';
import { extractJsonObject, fallbackQuestion, stageAgentEvaluationSchema, stageAgentStartSchema } from '../../src/lib/server/stage-agent';

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
});
