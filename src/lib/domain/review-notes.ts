/**
 * Notes left in Review Room, shown where they apply (SPEC story 55). A note belongs to a shot there, not to one
 * take, and may carry a timecode in seconds. In the viewer it is listed in the order of the picture and marked on
 * the scrub bar at its timecode.
 */
import { timecode } from './viewer-keys';

/** One note, as Review Room's `GET /api/v1/assets/{id}/notes` returns it. */
export interface ReviewNote {
	id: string;
	body: string;
	timecodeSec: number | null;
	authorName: string;
	authorRole: 'admin' | 'client';
	createdAt: number;
	completedAt: number | null;
}

/** Notes in the order of the picture; those with no timecode after them, oldest first. */
export function orderedNotes(notes: ReviewNote[]): ReviewNote[] {
	return notes.toSorted((a, b) => {
		if (a.timecodeSec === null || b.timecodeSec === null) return a.timecodeSec === b.timecodeSec ? a.createdAt - b.createdAt : a.timecodeSec === null ? 1 : -1;
		return a.timecodeSec - b.timecodeSec || a.createdAt - b.createdAt;
	});
}

export interface NoteMark { id: string; at: number; left: number; done: boolean; title: string }

/** Where each timed note sits on a take `duration` seconds long. A timecode past the end of this take is left out. */
export function noteMarks(notes: ReviewNote[], duration: number): NoteMark[] {
	if (!(duration > 0)) return [];
	return orderedNotes(notes).flatMap((note) => {
		if (note.timecodeSec === null || note.timecodeSec < 0 || note.timecodeSec > duration + 0.05) return [];
		return [{ id: note.id, at: note.timecodeSec, left: Math.min(100, (note.timecodeSec / duration) * 100), done: note.completedAt !== null, title: `${note.authorName} · ${timecode(note.timecodeSec)} — ${note.body}` }];
	});
}
