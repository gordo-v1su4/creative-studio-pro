import type { CatalogModel, RosterSlot } from '$lib/domain/schemas';

export const DEFAULT_ROSTER_COUNT = 5;

/** Deterministic shuffle from a persisted hex seed (NFR-010). */
function seededRandom(seedHex: string): () => number {
	let t = 0;
	for (let i = 0; i < seedHex.length; i++) t = (t * 33 + seedHex.charCodeAt(i)) >>> 0;
	return () => {
		t += 0x6d2b79f5;
		let r = t;
		r = Math.imul(r ^ (r >>> 15), r | 1);
		r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

export function selectRoster(
	models: CatalogModel[],
	requestedCount: number,
	selectionSeed: string,
	pinnedLabels: string[] = []
): { selected: RosterSlot[]; shortfall: number } {
	const byLabel = new Map(models.map((model) => [model.label, model]));
	const pinned: RosterSlot[] = [];
	for (const label of pinnedLabels) {
		const model = byLabel.get(label);
		if (model) pinned.push({ ...model, pinned: true });
	}
	const pinnedSet = new Set(pinned.map((slot) => slot.label));
	const rest = models.filter((model) => !pinnedSet.has(model.label));
	const rand = seededRandom(selectionSeed);
	const shuffled = [...rest];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	const capacity = Math.max(requestedCount, pinned.length);
	const selected = [
		...pinned,
		...shuffled.slice(0, Math.max(0, capacity - pinned.length)).map((model) => ({
			...model,
			pinned: false
		}))
	];
	return {
		selected,
		shortfall: Math.max(0, requestedCount - selected.length)
	};
}
