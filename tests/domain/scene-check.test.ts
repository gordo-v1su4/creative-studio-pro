import { describe, expect, test } from 'bun:test';
import { checkDialogue, dialogueLines, sceneProblems, strayHandles } from '../../src/lib/domain/scene-check';

const script = 'KAI (low, to Mara): "Don\'t look at it."\nMARA (whispering): “What is it?”\nKAI: "Nothing you need."';
const spoken = (title: string, dialogue: string, prompt = dialogue) => ({ title, dialogue, video_prompt: prompt });

describe('dialogue lines', () => {
	test('parses SPEAKER (delivery): "line", curly quotes too', () => {
		expect(dialogueLines(script)).toEqual([
			{ speaker: 'KAI', delivery: 'low, to Mara', line: "Don't look at it." },
			{ speaker: 'MARA', delivery: 'whispering', line: 'What is it?' },
			{ speaker: 'KAI', delivery: '', line: 'Nothing you need.' }
		]);
	});
});

describe('dialogue placement', () => {
	test('every line once, verbatim, spoken in its prompt: passes', () => {
		const shots = [
			spoken('A.01', 'KAI (low, to Mara): "Don\'t look at it."', '@Kai turns.\nKAI, to Mara, low:\n"Don\'t look at it."'),
			spoken('A.02', 'MARA (whispering): "What is it?"\nKAI: "Nothing you need."', 'MARA: "What is it?" KAI: "Nothing you need."')
		];
		expect(sceneProblems(checkDialogue(script, shots), [])).toEqual([]);
	});

	test('missing, changed, invented, repeated and unspoken lines are all caught', () => {
		const shots = [
			spoken('A.01', 'KAI: "Don\'t look at that."'),
			spoken('A.02', 'MARA: "What is it?"'),
			spoken('A.03', 'MARA: "What is it?"\nMARA: "I love the rain."', 'nothing quoted')
		];
		const check = checkDialogue(script, shots);
		expect(check.changed.map((entry) => entry.script.line)).toEqual(["Don't look at it."]);
		expect(check.missing.map((line) => line.line)).toEqual(['Nothing you need.']);
		expect(check.invented.map((entry) => entry.line.line)).toEqual(['I love the rain.']);
		expect(check.repeated.map((entry) => entry.shots)).toEqual([['A.02', 'A.03']]);
		expect(check.unspoken.map((entry) => entry.shot)).toEqual(['A.03']);
		expect(sceneProblems(check, [])).toHaveLength(5);
	});

	test('lines already in the scene\'s existing shots count as placed', () => {
		const placed = [spoken('A.01', 'KAI (low, to Mara): "Don\'t look at it."', 'older prompt')];
		const shots = [spoken('A.02', 'MARA (whispering): "What is it?"\nKAI: "Nothing you need."', '"What is it?" "Nothing you need."')];
		expect(sceneProblems(checkDialogue(script, shots, placed), [])).toEqual([]);
	});

	test('a scene with no dialogue passes when no one speaks, and fails a made-up line', () => {
		expect(sceneProblems(checkDialogue('', [spoken('A.01', '')]), [])).toEqual([]);
		expect(sceneProblems(checkDialogue('', [spoken('A.01', 'KAI: "Hey."')]), [])).toEqual(['A.01: dialogue not in the script: KAI: "Hey."']);
	});
});

describe('references', () => {
	test('a handle outside the scene\'s references is flagged', () => {
		expect(strayHandles([{ title: 'A.01', video_prompt: '@Kai and @Bryce at @VideoHaven' }], ['@Kai', '@VideoHaven'])).toEqual([{ shot: 'A.01', handle: '@Bryce' }]);
	});
});
