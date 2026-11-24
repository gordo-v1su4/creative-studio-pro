/**
 * Opening a timeline before its files have been read. A cut entry already says where its clip starts and
 * ends, and a take usually has its length recorded, so the timeline can be laid out and start playing at
 * once; each clip's real length, frame rate and sound arrive afterwards and settle it in place.
 */
export interface OpenItem { in?: number; out?: number; length?: number }
export interface ClipTimes { in: number; out: number; duration: number }

/** Whether a clip can be laid out without reading its file: its out point or its recorded length is known. */
export const canOpenUnread = (item: OpenItem) => (item.out ?? item.length ?? 0) > 0;

/** A clip's times before its file is read: the asked-for span, inside the best length known so far. */
export function unreadTimes(item: OpenItem, minSpan: number): ClipTimes {
	const duration = Math.max(item.length ?? 0, item.out ?? 0, minSpan);
	const out = Math.min(item.out ?? duration, duration);
	return { in: Math.max(0, Math.min(item.in ?? 0, out - minSpan)), out, duration };
}

/** A clip's times once its real length is known: the span is kept, pulled inside the file where it ran past it. */
export function readTimes(times: { in: number; out: number }, duration: number, minSpan: number): ClipTimes {
	const out = Math.min(times.out, duration);
	return { in: Math.max(0, Math.min(times.in, out - minSpan)), out, duration };
}

/** The order to read files in: from the clip that plays first, round to the start, so what plays next is read next. */
export function readOrder(count: number, from = 0): number[] {
	return Array.from({ length: count }, (_, i) => (from + i) % count);
}
