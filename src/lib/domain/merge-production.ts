/**
 * Unsaved edits and a project that changed underneath them (ADR 0008). Review Room's changes arrive every few
 * seconds while the operator may be half-way through typing a prompt. The edits are kept and the arrival is taken,
 * field by field: whatever the operator changed since the last load stays, everything else comes from the incoming
 * project. Where both changed the same field, the unsaved edit stays; it is the later change once it is saved.
 */
import type { ProductionState } from './schemas';

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** One record three ways: the incoming one, with every field the operator changed since `base` put back. */
function mergeRecord<T extends object>(base: T | undefined, mine: T, theirs: T): T {
	if (!base) return mine;
	const out = { ...theirs } as Record<string, unknown>;
	const before = base as Record<string, unknown>, edited = mine as Record<string, unknown>;
	for (const key of new Set([...Object.keys(before), ...Object.keys(edited)])) {
		if (same(before[key], edited[key])) continue;
		if (edited[key] === undefined) delete out[key];
		else out[key] = edited[key];
	}
	return out as T;
}

/** A list of records by id: the incoming list and order, each record merged, plus anything only the draft has added. */
function mergeList<T extends object>(base: T[], mine: T[], theirs: T[], id: (item: T) => string): T[] {
	const before = new Map(base.map((item) => [id(item), item]));
	const edited = new Map(mine.map((item) => [id(item), item]));
	const incoming = new Set(theirs.map(id));
	return [
		...theirs.map((item) => { const local = edited.get(id(item)); return local ? mergeRecord(before.get(id(item)), local, item) : item; }),
		...mine.filter((item) => !before.has(id(item)) && !incoming.has(id(item)))
	];
}

/**
 * `base` is the production the draft was loaded from, `draft` is that plus the operator's unsaved edits, `next` is
 * the production that has just arrived. Returns what the draft should now be.
 */
export function mergeProduction(base: ProductionState, draft: ProductionState, next: ProductionState): ProductionState {
	if (same(base, draft)) return next;
	const out = mergeRecord(
		{ ...base, cards: undefined, assets: undefined } as unknown as ProductionState,
		{ ...draft, cards: undefined, assets: undefined } as unknown as ProductionState,
		next
	);
	return {
		...out,
		cards: mergeList(base.cards, draft.cards, next.cards, (card) => card.card_id),
		assets: mergeList(base.assets, draft.assets, next.assets, (asset) => asset.asset_id)
	};
}
