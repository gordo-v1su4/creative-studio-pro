/** Clips the reviewer shift-clicked, in click order, to play back to back. */
export interface SequenceItem {
	id: string;
	title: string;
	src: string;
	/** The production asset carrying the clip's in/out trim. */
	assetId: string;
}

class ReviewSequence {
	items = $state<SequenceItem[]>([]);
	playing = $state(false);

	/** 1-based position in the sequence, or 0 when the clip isn't in it. */
	position(id: string): number {
		return this.items.findIndex((item) => item.id === id) + 1;
	}

	toggle(item: SequenceItem): void {
		this.items = this.position(item.id) ? this.items.filter((entry) => entry.id !== item.id) : [...this.items, item];
		if (this.items.length === 0) this.playing = false;
	}

	/** Keep a selected beat on its current pick: swap the clip in place, or drop it when the pick has no video. */
	sync(id: string, item: SequenceItem | null): void {
		const index = this.items.findIndex((entry) => entry.id === id);
		if (index < 0) return;
		const current = this.items[index];
		if (item && current.assetId === item.assetId && current.src === item.src) return;
		this.items = item ? this.items.with(index, item) : this.items.filter((entry) => entry.id !== id);
		if (this.items.length === 0) this.playing = false;
	}

	clear(): void {
		this.items = [];
		this.playing = false;
	}
}

export const reviewSequence = new ReviewSequence();
