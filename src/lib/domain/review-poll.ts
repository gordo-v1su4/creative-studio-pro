/**
 * Keeping in step with Review Room without a button (ADR 0008): when a check is due, what the top bar says, and
 * the reviews that could not be sent and are waiting to be tried again.
 */
export const POLL_MS = 10_000;

/** A check is due every POLL_MS while the project is connected and in view, and at once on coming back to the window. */
export function due(input: { connected: boolean; visible: boolean; checking: boolean; lastAt: number | null; now: number; focused?: boolean }): boolean {
	if (!input.connected || !input.visible || input.checking) return false;
	return input.focused === true || input.lastAt === null || input.now - input.lastAt >= POLL_MS;
}

/** The top bar's line after "Review Room". */
export function roomLine(input: { connected: boolean; lastAt: number | null; error: string | null; waiting: number; now: number }): { text: string; tone: 'ok' | 'bad' | 'off' } {
	if (!input.connected) return { text: 'not connected', tone: 'off' };
	if (input.waiting > 0) return { text: `${input.waiting} ${input.waiting === 1 ? 'change' : 'changes'} not sent · retrying`, tone: 'bad' };
	if (input.error) return { text: 'not reached · retrying', tone: 'bad' };
	if (input.lastAt === null) return { text: 'checking', tone: 'ok' };
	return { text: `in step · ${Math.max(0, Math.floor((input.now - input.lastAt) / 1000))}s`, tone: 'ok' };
}

export type ReviewStatus = 'awaiting_review' | 'in_progress' | 'needs_changes' | 'approved';
/** A review decision on one take: the shot's status, excluding or restoring the take, or both. */
export interface ReviewChange { take_id: string; card_id: string; status?: ReviewStatus; excluded?: boolean }
/** Decisions that could not be sent, one entry per take, with why the last try failed. */
export type Outbox = Array<ReviewChange & { error: string }>;

/** Keep a decision that could not be sent. A later decision on the same take replaces the same part of it. */
export function queued(outbox: Outbox, change: ReviewChange, error: string): Outbox {
	const at = outbox.findIndex((entry) => entry.take_id === change.take_id);
	if (at < 0) return [...outbox, { ...change, error }];
	return outbox.with(at, { ...outbox[at], ...change, error });
}

/** A kept decision was sent: it leaves the list. */
export function settled(outbox: Outbox, takeId: string): Outbox {
	return outbox.some((entry) => entry.take_id === takeId) ? outbox.filter((entry) => entry.take_id !== takeId) : outbox;
}

/**
 * Whether a review that failed should be kept and tried again: yes when Review Room or the server could not be
 * reached, or the project moved on underneath it; no when the request itself can never succeed.
 */
export function worthKeeping(failure: { status: number; message: string }): boolean {
	if (failure.status === 0 || failure.status >= 500) return true;
	return /Review Room .* failed \(\d+\)|Project changed|fetch|network|offline|timed? ?out/i.test(failure.message);
}
