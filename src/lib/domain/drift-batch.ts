import type { DriftChoice, DriftItem } from './drift';
import type { PrepKind } from './prep';

/**
 * One answer for several drift items (Drift 10, GitHub #38 / V1S-514; spec GitHub #28, story 40). "add all six",
 * "add the locations" or a press on a group picks the items it covers; the server then writes them one at a time,
 * the first alone and checked (`src/lib/server/drift-batch.ts`). A count that does not match what is listed picks
 * nothing, so a misheard number never writes the wrong set. Only "add to Notion" can be batched today; link and
 * mark as old join by adding their verb here and their writer on the server.
 */

/** One line the Agent says while several items are answered: a write, or the check of the first, as it runs and ends. */
export interface BatchEvent { key: string; state: 'doing' | 'done' | 'failed'; text: string; /** The check of the first write, not a write. */ check?: true }

export type BatchAnswer = { ok: true; choice: DriftChoice; keys: string[] } | { ok: false; message: string };

/** The items one choice can be pressed for in a batch: "add to Notion" needs a Prep it was found in. */
export function batchable(items: DriftItem[], choice: DriftChoice = 'add_to_notion'): DriftItem[] {
	return items.filter((item) => item.choices.includes(choice) && (choice !== 'add_to_notion' || item.found.prep.length > 0));
}

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const KIND_WORDS: Record<string, { kinds: PrepKind[] | null; one: boolean }> = {
	character: { kinds: ['character'], one: true }, characters: { kinds: ['character'], one: false }, person: { kinds: ['character'], one: true }, people: { kinds: ['character'], one: false },
	location: { kinds: ['location'], one: true }, locations: { kinds: ['location'], one: false }, place: { kinds: ['location'], one: true }, places: { kinds: ['location'], one: false },
	prop: { kinds: ['prop'], one: true }, props: { kinds: ['prop'], one: false },
	reference: { kinds: null, one: true }, references: { kinds: null, one: false }, item: { kinds: null, one: true }, items: { kinds: null, one: false }, thing: { kinds: null, one: true }, things: { kinds: null, one: false }
};
const QUANTIFIERS = new Set(['all', 'both', 'every', 'each', 'them', 'these', 'those']);
const FILLER = new Set(['the', 'of', 'and', 'to', 'into', 'in', 'notion', 'notions', 'please', 'now']);
const LEADING = new Set(['yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'please', 'go', 'ahead', 'then']);
const KIND_PLURAL: Record<PrepKind, string> = { character: 'characters', location: 'locations', prop: 'props' };

/**
 * Reads the operator's words as an answer for several items, or returns null when they are not one ("add Pool",
 * "what's out of step?"). Every word after "add" must be a count, a kind, "all"/"both"/"them", or "to Notion".
 */
export function batchAnswer(text: string, items: DriftItem[]): BatchAnswer | null {
	const words = text.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(Boolean);
	let at = 0;
	while (at < words.length && LEADING.has(words[at])) at += 1;
	if (words[at] !== 'add') return null;
	let count: number | null = null;
	let kinds: Set<PrepKind> | null = null;
	let singular = false;
	let sure = false;
	for (const word of words.slice(at + 1)) {
		const number = /^\d+$/.test(word) ? Number(word) : NUMBERS.indexOf(word);
		if (number > 0) { if (count !== null) return null; count = number; sure = true; }
		else if (Object.hasOwn(KIND_WORDS, word)) {
			const kind = KIND_WORDS[word];
			if (kind.kinds) { kinds ??= new Set(); kind.kinds.forEach((one) => kinds!.add(one)); }
			singular ||= kind.one;
			sure = true;
		}
		else if (QUANTIFIERS.has(word)) { if (word === 'both') count ??= 2; sure = true; }
		else if (!FILLER.has(word)) return null;
	}
	if (!sure) return null;
	if (singular && count === null) count = 1;

	const target = batchable(items).filter((item) => !kinds || kinds.has(item.kind));
	const what = kinds ? [...kinds].map((kind) => KIND_PLURAL[kind]).join(' and ') : 'references';
	if (!target.length) return { ok: false, message: kinds ? `There are no ${what} to add to Notion here. Nothing was written.` : 'None of these can be added to Notion in one go. Nothing was written.' };
	if (count !== null && count !== target.length) {
		return { ok: false, message: `There ${target.length === 1 ? 'is 1' : `are ${target.length}`} ${target.length === 1 ? what.replace(/s$/, '') : what} to add to Notion, not ${count}. Nothing was written; say "add all ${target.length}${kinds ? ` ${what}` : ''}" to add ${target.length === 1 ? 'it' : 'them'}.` };
	}
	return { ok: true, choice: 'add_to_notion', keys: target.map((item) => item.key) };
}
