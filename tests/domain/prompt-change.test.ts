import { expect, test } from 'bun:test';
import { changeCount, promptChange, type ChangePart } from '../../src/lib/domain/prompt-change';

const after = (parts: ChangePart[]) => parts.filter((part) => part.kind !== 'removed').map((part) => part.text).join('');
const before = (parts: ChangePart[]) => parts.filter((part) => part.kind !== 'added').map((part) => part.text).join('');

test('an unchanged prompt is one plain part, and an empty one is nothing', () => {
	expect(promptChange('A slow push in.', 'A slow push in.')).toEqual([{ kind: 'same', text: 'A slow push in.' }]);
	expect(promptChange('', '')).toEqual([]);
});

test('a changed word is struck through and its replacement highlighted, word by word', () => {
	expect(promptChange('A slow push in on Kai.', 'A fast push in on Kai.')).toEqual([
		{ kind: 'same', text: 'A ' },
		{ kind: 'removed', text: 'slow' },
		{ kind: 'added', text: 'fast' },
		{ kind: 'same', text: ' push in on Kai.' }
	]);
});

test('words added or taken out leave the words around them plain', () => {
	expect(promptChange('Kai turns.', 'Kai slowly turns.')).toEqual([{ kind: 'same', text: 'Kai ' }, { kind: 'added', text: 'slowly ' }, { kind: 'same', text: 'turns.' }]);
	expect(promptChange('Kai slowly turns.', 'Kai turns.')).toEqual([{ kind: 'same', text: 'Kai ' }, { kind: 'removed', text: 'slowly ' }, { kind: 'same', text: 'turns.' }]);
});

test('punctuation is its own word, so a new comma does not mark the word before it', () => {
	expect(promptChange('Kai turns and runs.', 'Kai turns, and runs.')).toEqual([{ kind: 'same', text: 'Kai turns' }, { kind: 'added', text: ',' }, { kind: 'same', text: ' and runs.' }]);
});

test('the parts always read back as the two prompts, line breaks included', () => {
	const pairs: Array<[string, string]> = [
		['CAMERA\nHandheld, close.\n\nLOCKS\nFaces stay exact.', 'CAMERA\nLocked off on sticks, wide.\n\nLOCKS\nFaces and clothes stay exact.\n'],
		['', 'All new.'],
		['All gone.', ''],
		['one two three', 'three two one'],
		['@Image_1 walks  left', '@Image_2 walks left']
	];
	for (const [a, b] of pairs) {
		const parts = promptChange(a, b);
		expect([before(parts), after(parts)]).toEqual([a, b]);
		// neighbours of one kind are joined, so the highlight is not chopped up
		for (let i = 1; i < parts.length; i++) expect(parts[i].kind).not.toBe(parts[i - 1].kind);
	}
});

test('a very long rewrite still answers: the middle is shown as taken out and put in', () => {
	const a = Array.from({ length: 4000 }, (_, i) => `a${i}`).join(' ');
	const b = Array.from({ length: 4000 }, (_, i) => `b${i}`).join(' ');
	const parts = promptChange(`Start. ${a} End.`, `Start. ${b} End.`);
	expect([before(parts), after(parts)]).toEqual([`Start. ${a} End.`, `Start. ${b} End.`]);
	expect(parts[0]).toEqual({ kind: 'same', text: 'Start. ' });
	expect(parts.at(-1)).toEqual({ kind: 'same', text: ' End.' });
});

test('the count of words put in and taken out leaves spaces out', () => {
	expect(changeCount(promptChange('A slow push in on Kai.', 'A fast, hard push on Kai.'))).toEqual({ added: 3, removed: 2 });
	expect(changeCount(promptChange('Same.', 'Same.'))).toEqual({ added: 0, removed: 0 });
});
