/**
 * The selection (CONTEXT.md: Selection): the shots gathered to be played together before anything is kept, in the
 * order they are arranged. Each plays its pick unless another of its takes is auditioned there, which never changes
 * the pick. These are the rules; the strip under the shot grid and the canvas both go through them.
 */
import type { Project } from './schemas';
import type { CutEntryInput } from './cuts';
import { programElapsed } from '../media/speed-curve';
import { isSlateId, slateFor } from './slate';

export interface SelectionItem {
	/** The shot (card id); a shot is in the selection once. */
	id: string;
	title: string;
	src: string;
	/** The take that plays: the shot's pick, or the take auditioned here. */
	assetId: string;
	/** Set while a take other than the pick is auditioned; such an entry no longer follows the pick. */
	auditioned?: boolean;
}

type Playable = Pick<SelectionItem, 'id' | 'title' | 'src' | 'assetId'>;

const clampIndex = (index: number, length: number) => Math.min(length, Math.max(0, Math.round(index)));

/** Add the shot at the end, or take it out when it is already in. */
export function toggled(items: SelectionItem[], item: Playable): SelectionItem[] {
	return items.some((entry) => entry.id === item.id) ? items.filter((entry) => entry.id !== item.id) : [...items, item];
}

/** Put the shot before position `at` (0 = first, length = last): a new shot is added there, one already in moves there. */
export function placed(items: SelectionItem[], item: Playable, at: number): SelectionItem[] {
	const from = items.findIndex((entry) => entry.id === item.id);
	const entry = from >= 0 ? items[from] : item;
	const rest = items.filter((other) => other.id !== item.id);
	const to = clampIndex(from >= 0 && from < at ? at - 1 : at, rest.length);
	return [...rest.slice(0, to), entry, ...rest.slice(to)];
}

/** Move the shot one place earlier (-1) or later (1); the ends stay put. */
export function nudged(items: SelectionItem[], id: string, by: -1 | 1): SelectionItem[] {
	const from = items.findIndex((entry) => entry.id === id);
	const to = from + by;
	if (from < 0 || to < 0 || to >= items.length) return items;
	const next = [...items];
	[next[from], next[to]] = [next[to], next[from]];
	return next;
}

/** Play another take of the shot in its place. Choosing the pick again makes the entry follow the pick once more. */
export function auditioned(items: SelectionItem[], id: string, take: { assetId: string; src: string }, pickId: string | null): SelectionItem[] {
	return items.map((entry) => {
		if (entry.id !== id) return entry;
		const { auditioned: _was, ...plain } = entry;
		return { ...plain, assetId: take.assetId, src: take.src, ...(take.assetId !== pickId ? { auditioned: true } : {}) };
	});
}

/**
 * Keep an entry true to its shot: it follows the pick (`item`; null when the shot no longer plays, which drops it)
 * unless a take is auditioned there and that take can still be used.
 */
export function synced(items: SelectionItem[], id: string, item: Playable | null, usable: (assetId: string) => boolean = () => true): SelectionItem[] {
	const index = items.findIndex((entry) => entry.id === id);
	if (index < 0) return items;
	const current = items[index];
	if (!item) return items.filter((entry) => entry.id !== id);
	if (current.auditioned && usable(current.assetId)) return current.title === item.title ? items : items.with(index, { ...current, title: item.title });
	if (!current.auditioned && current.assetId === item.assetId && current.src === item.src && current.title === item.title) return items;
	return items.with(index, { ...item });
}

/** Lengths read from the files themselves (seconds by take id), for takes that arrived before lengths were recorded. */
export type ReadLengths = Readonly<Record<string, number>>;

/** How long an entry runs, in seconds, as its trim and ramp play it; null when the take's length is not known. */
export function itemSeconds(project: Project, item: SelectionItem, read: ReadLengths = {}): number | null {
	if (isSlateId(item.assetId)) {
		const card = project.production.cards.find((entry) => entry.card_id === item.id);
		return card ? slateFor(project, card).duration_s : null;
	}
	const take = project.production.assets.find((asset) => asset.asset_id === item.assetId);
	const out = take?.out_s ?? take?.duration_s ?? read[item.assetId];
	if (!take || out === undefined) return null;
	return programElapsed(take.speed, Math.max(0, out - (take.in_s ?? 0)));
}

/** "4 shots · 20s": the count, and the running length when every entry's length is known. */
export function selectionSummary(project: Project, items: SelectionItem[], read: ReadLengths = {}): string {
	if (!items.length) return '';
	const lengths = items.map((item) => itemSeconds(project, item, read));
	const count = `${items.length} ${items.length === 1 ? 'shot' : 'shots'}`;
	if (lengths.some((length) => length === null)) return count;
	const total = lengths.reduce<number>((sum, length) => sum + (length ?? 0), 0);
	return `${count} · ${Math.round(total * 10) / 10}s`;
}

/**
 * What a push saves: each entry's shot, take, trim and ramp, in the selection's order. A take whose length is not
 * known yet cannot be pushed; its shot is named.
 */
export function selectionEntries(project: Project, items: SelectionItem[], read: ReadLengths = {}): { ok: true; entries: CutEntryInput[] } | { ok: false; unknown: string[] } {
	const unknown: string[] = [];
	const entries = items.flatMap((item): CutEntryInput[] => {
		if (isSlateId(item.assetId)) {
			const length = itemSeconds(project, item, read);
			if (length === null) { unknown.push(item.title); return []; }
			return [{ card_id: item.id, asset_id: item.assetId, in_s: 0, out_s: length }];
		}
		const take = project.production.assets.find((asset) => asset.asset_id === item.assetId);
		const out = take?.out_s ?? take?.duration_s ?? read[item.assetId];
		if (!take || out === undefined) { unknown.push(item.title); return []; }
		return [{ card_id: item.id, asset_id: item.assetId, in_s: take.in_s ?? 0, out_s: out, ...(take.speed ? { speed: take.speed.map((point) => ({ ...point })) } : {}) }];
	});
	return unknown.length ? { ok: false, unknown } : { ok: true, entries };
}
