import { auditioned, nudged, placed, synced, toggled, type SelectionItem } from '$lib/domain/selection';

/** One entry of the selection: a shot and the take that plays for it (see $lib/domain/selection). */
export type SequenceItem = SelectionItem;

/** The selection (CONTEXT.md: Selection), shared by the shot grid's strip, the canvas and the sequence player. */
class ReviewSequence {
	items = $state<SequenceItem[]>([]);
	playing = $state(false);

	/** 1-based position in the selection, or 0 when the shot isn't in it. */
	position(id: string): number {
		return this.items.findIndex((item) => item.id === id) + 1;
	}

	private set(next: SequenceItem[]): void {
		if (next !== this.items) this.items = next;
		if (this.items.length === 0) this.playing = false;
	}

	toggle(item: SequenceItem): void { this.set(toggled(this.items, item)); }
	/** Add the shot before position `at`, or move it there when it is already in. */
	place(item: SequenceItem, at: number): void { this.set(placed(this.items, item, at)); }
	nudge(id: string, by: -1 | 1): void { this.set(nudged(this.items, id, by)); }
	remove(id: string): void { this.set(this.items.filter((item) => item.id !== id)); }
	/** Play another take of the shot in its place; the shot's pick is not touched. */
	audition(id: string, take: { assetId: string; src: string }, pickId: string | null): void { this.set(auditioned(this.items, id, take, pickId)); }

	/** Keep a selected shot on its pick (or its auditioned take while that take is usable); drop it when it no longer plays. */
	sync(id: string, item: SequenceItem | null, usable?: (assetId: string) => boolean): void { this.set(synced(this.items, id, item, usable)); }

	clear(): void { this.set([]); }
}

export const reviewSequence = new ReviewSequence();
