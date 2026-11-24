import { expect, test } from 'bun:test';
import { canOpenUnread, readOrder, readTimes, unreadTimes } from '../../src/lib/media/timeline-open';

test('a clip opens unread when its out point or its recorded length is known', () => {
	expect(canOpenUnread({ in: 1, out: 4 })).toBe(true);
	expect(canOpenUnread({ length: 8 })).toBe(true);
	expect(canOpenUnread({ in: 1 })).toBe(false);
	expect(canOpenUnread({})).toBe(false);
});

test('before the file is read, a clip keeps its asked-for span inside the best length known', () => {
	expect(unreadTimes({ in: 1, out: 4 }, 0.2)).toEqual({ in: 1, out: 4, duration: 4 });
	expect(unreadTimes({ in: 1, out: 4, length: 10 }, 0.2)).toEqual({ in: 1, out: 4, duration: 10 });
	expect(unreadTimes({ length: 8 }, 0.2)).toEqual({ in: 0, out: 8, duration: 8 });
	// An in point at or past the out point is pulled back to leave the shortest span.
	expect(unreadTimes({ in: 5, out: 4 }, 0.2)).toEqual({ in: 3.8, out: 4, duration: 4 });
});

test('once read, the span is kept and only pulled inside a file that turned out shorter', () => {
	expect(readTimes({ in: 1, out: 4 }, 10, 0.2)).toEqual({ in: 1, out: 4, duration: 10 });
	expect(readTimes({ in: 1, out: 4 }, 3.5, 0.2)).toEqual({ in: 1, out: 3.5, duration: 3.5 });
	expect(readTimes({ in: 3.4, out: 4 }, 3.5, 0.2)).toEqual({ in: 3.3, out: 3.5, duration: 3.5 });
});

test('files are read from the clip that plays first, round to the start', () => {
	expect(readOrder(4)).toEqual([0, 1, 2, 3]);
	expect(readOrder(4, 2)).toEqual([2, 3, 0, 1]);
	expect(readOrder(0)).toEqual([]);
});
