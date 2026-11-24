import { queued, settled, worthKeeping, type Outbox, type ReviewChange } from '$lib/domain/review-poll';
import type { Project } from '$lib/domain/schemas';

/**
 * Where this app stands with Review Room (ADR 0008), shared by the shell (the check, the top bar's line) and the
 * shot screens (marks on shots): when the last check ran, whether it reached Review Room, the reviews waiting to
 * be sent again, and the shots a check has just changed.
 */
class RoomState {
	lastAt = $state<number | null>(null);
	error = $state<string | null>(null);
	checking = $state(false);
	outbox = $state<Outbox>([]);
	/** Shots Review Room just changed, by card id, with the time each mark fades. */
	marks = $state<Record<string, number>>({});
	/** Ticks once a second while a connected project is open, for the "in step · 4s" line and fading marks. */
	now = $state(Date.now());

	mark(cardIds: string[], forMs = 8000): void {
		if (!cardIds.length) return;
		const until = Date.now() + forMs;
		this.marks = { ...this.marks, ...Object.fromEntries(cardIds.map((id) => [id, until])) };
	}
	/** A change from Review Room reached this shot in the last few seconds. */
	marked(cardId: string): boolean { return (this.marks[cardId] ?? 0) > this.now; }
	/** A review of this shot has not reached Review Room yet; the message says why. */
	waiting(cardId: string): string | null { return this.outbox.find((entry) => entry.card_id === cardId)?.error ?? null; }
	reset(): void { this.lastAt = null; this.error = null; this.checking = false; this.outbox = []; this.marks = {}; }

	/**
	 * Send one review decision. Sent: it leaves the waiting list and the updated project comes back. Not sent
	 * because nothing could be reached: it is kept and tried again with the next check.
	 */
	async send(project: Project, change: ReviewChange): Promise<{ ok: true; project: Project } | { ok: false; message: string; kept: boolean }> {
		let status = 0, message = 'Review Room could not be reached';
		try {
			const response = await fetch(`/api/projects/${project.project_id}/review-room`, {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'review', take_id: change.take_id, expected_version: project.version, ...(change.status !== undefined ? { status: change.status } : {}), ...(change.excluded !== undefined ? { excluded: change.excluded } : {}) })
			});
			status = response.status;
			const text = await response.text();
			let body: { ok?: boolean; data?: Project; error?: { message?: string } } = {};
			// A server in front of the app can answer with its own page; that is "not reached", not a refusal.
			try { body = JSON.parse(text); } catch { status = status < 500 ? 502 : status; message = `HTTP ${response.status}`; }
			if (body.ok && body.data) { this.outbox = settled(this.outbox, change.take_id); return { ok: true, project: body.data }; }
			if (body.error?.message) message = body.error.message;
		} catch (cause) { message = cause instanceof Error ? cause.message : message; }
		const kept = worthKeeping({ status, message });
		if (kept) this.outbox = queued(this.outbox, change, message);
		else this.outbox = settled(this.outbox, change.take_id);
		return { ok: false, message, kept };
	}
}

export const roomState = new RoomState();
