import { expect, test } from 'bun:test';
import { noteMarks, orderedNotes, type ReviewNote } from '../../src/lib/domain/review-notes';

const note = (id: string, over: Partial<ReviewNote> = {}): ReviewNote => ({ id, body: `note ${id}`, timecodeSec: null, authorName: 'Ana', authorRole: 'client', createdAt: 1000, completedAt: null, ...over });

test('notes read in the order of the picture; notes with no timecode come last, oldest first', () => {
	const notes = [note('late', { timecodeSec: 8 }), note('none-new', { createdAt: 3000 }), note('early', { timecodeSec: 1.5 }), note('none-old', { createdAt: 2000 }), note('same', { timecodeSec: 1.5, createdAt: 500 })];
	expect(orderedNotes(notes).map((entry) => entry.id)).toEqual(['same', 'early', 'late', 'none-old', 'none-new']);
});

test('a note is marked on the scrub bar at its timecode, as a share of the take', () => {
	const marks = noteMarks([note('a', { timecodeSec: 2.5 }), note('b', { timecodeSec: 10 }), note('c')], 10);
	expect(marks).toEqual([{ id: 'a', at: 2.5, left: 25, done: false, title: 'Ana · 00:02.50 — note a' }, { id: 'b', at: 10, left: 100, done: false, title: 'Ana · 00:10.00 — note b' }]);
});

test('a timecode past the end of this take is not marked (the note may be about a longer take of the shot)', () => {
	expect(noteMarks([note('a', { timecodeSec: 12 })], 10)).toEqual([]);
	expect(noteMarks([note('a', { timecodeSec: 2 })], 0)).toEqual([]);
});

test('a note already dealt with is marked as done', () => {
	expect(noteMarks([note('a', { timecodeSec: 1, completedAt: 5000 })], 4)[0].done).toBe(true);
});
