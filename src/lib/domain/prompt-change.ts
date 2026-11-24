/**
 * The highlight of a prompt change (CONTEXT.md: Prompt change; decision 30):
 * what was added and what was taken out, word by word. It is a light
 * highlight for reading, not a line diff: the parts read back as either
 * prompt, with every space and line break where it was.
 */

export interface ChangePart {
	kind: 'same' | 'added' | 'removed';
	text: string;
}

/** A word, a run of white space, or one punctuation mark. */
const TOKEN = /\s+|[\p{L}\p{N}@_'’-]+|[^\s]/gu;
/** Above this many comparisons the changed middle is shown whole instead of aligned. */
const MAX_CELLS = 4_000_000;

function push(parts: ChangePart[], kind: ChangePart['kind'], text: string) {
	if (!text) return;
	const last = parts.at(-1);
	if (last?.kind === kind) last.text += text;
	else parts.push({ kind, text });
}

export function promptChange(before: string, after: string): ChangePart[] {
	const a = before.match(TOKEN) ?? [];
	const b = after.match(TOKEN) ?? [];
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

	const parts: ChangePart[] = [];
	push(parts, 'same', a.slice(0, start).join(''));
	const midA = a.slice(start, endA);
	const midB = b.slice(start, endB);
	const n = midA.length;
	const m = midB.length;
	if (n * m > MAX_CELLS || n === 0 || m === 0) {
		push(parts, 'removed', midA.join(''));
		push(parts, 'added', midB.join(''));
	} else {
		// The heaviest common run, read from the end so the walk goes forward. A kept word
		// outweighs any number of kept spaces, so spaces never decide which words line up.
		const width = m + 1;
		const table = new Uint32Array((n + 1) * width);
		const weight = (token: string) => (token.trim() ? 10_000 : 1);
		for (let i = n - 1; i >= 0; i--) {
			for (let j = m - 1; j >= 0; j--) {
				table[i * width + j] = midA[i] === midB[j] ? table[(i + 1) * width + j + 1] + weight(midA[i]) : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
			}
		}
		// Taken-out words are held until the words put in their place are known, so a swap reads "old new".
		let removed = '';
		let added = '';
		const flush = () => { push(parts, 'removed', removed); push(parts, 'added', added); removed = ''; added = ''; };
		let i = 0;
		let j = 0;
		while (i < n && j < m) {
			if (midA[i] === midB[j]) { flush(); push(parts, 'same', midA[i]); i++; j++; }
			else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) removed += midA[i++];
			else added += midB[j++];
		}
		removed += midA.slice(i).join('');
		added += midB.slice(j).join('');
		flush();
	}
	push(parts, 'same', a.slice(endA).join(''));
	return parts;
}

/** How many words were put in and taken out; white space is not counted. */
export function changeCount(parts: readonly ChangePart[]): { added: number; removed: number } {
	const words = (kind: ChangePart['kind']) => parts.filter((part) => part.kind === kind).reduce((sum, part) => sum + (part.text.match(TOKEN) ?? []).filter((token) => token.trim()).length, 0);
	return { added: words('added'), removed: words('removed') };
}
