/**
 * Handle compile (V1S-327): writers type `@Kai`; before a prompt is linted or sent, each `@Handle` is swapped
 * for its reference's image label and exact name (`@Image_1 (Kai "Hoodie" Santana)`), the image is declared
 * once at the top (`@Image_1 = Kai "Hoodie" Santana — definitive identity and wardrobe lock`), and the
 * reference is listed for attaching. Images are numbered per prompt: characters → location → props, then in
 * order of first mention. Only `@Handles` are touched; plain words are left alone. Deterministic, no LLM.
 */

import { extractDeclarations, promptToText } from './prompt-lint';

export type HandleTarget = 'seedance' | 'nano_banana';

/** A reference as the compile needs it (a SeriesReference fits). */
export interface HandleReference { name: string; kind: string; handles: string[] }

export interface CompiledImage<R extends HandleReference = HandleReference> { image: number; reference: R }

export interface CompileResult<R extends HandleReference = HandleReference> {
	prompt: string;
	/** The references to attach, in image order. */
	images: CompiledImage<R>[];
	/** Handles that match no reference (left in the prompt for the linter to flag). */
	unknown: string[];
	/** Handles that match more than one reference (also left in place). */
	ambiguous: string[];
}

/** `@Kai`, `@Old-Man`, never `@Image_1` / `@Image 2`; a trailing `'s` is not part of the handle. */
const HANDLE = /@(?!Image[ _]?\d)([A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*)/g;

const kindKey = (kind: string) => kind.trim().toLowerCase().replace(/s$/, '');
const KIND_RANK: Record<string, number> = { character: 0, location: 1, prop: 2 };
const LOCK: Record<string, string> = {
	character: 'definitive identity and wardrobe lock',
	location: 'exact location lock',
	prop: 'exact prop lock'
};
const norm = (handle: string) => handle.replace(/^@/, '').toLowerCase();

export const imageLabel = (target: HandleTarget, image: number) => (target === 'seedance' ? `@Image_${image}` : `Image ${image}`);

/** Every `@Handle` in a prompt, in order (repeats included). */
export function handlesIn(prompt: string): string[] {
	return [...prompt.matchAll(HANDLE)].map((m) => `@${m[1]}`);
}

/** `firstImage` defaults to one past the highest image the prompt already declares. */
export function compileHandles<R extends HandleReference>(prompt: string, references: R[], target: HandleTarget, options: { firstImage?: number } = {}): CompileResult<R> {
	const byHandle = new Map<string, R[]>();
	for (const reference of references) {
		for (const handle of reference.handles) {
			const key = norm(handle);
			if (!key) continue;
			const list = byHandle.get(key) ?? [];
			if (!list.includes(reference)) list.push(reference);
			byHandle.set(key, list);
		}
	}
	const unknown: string[] = [];
	const ambiguous: string[] = [];
	const used: R[] = [];
	for (const m of prompt.matchAll(HANDLE)) {
		const found = byHandle.get(norm(m[1])) ?? [];
		const handle = `@${m[1]}`;
		if (found.length === 0) { if (!unknown.includes(handle)) unknown.push(handle); continue; }
		if (found.length > 1) { if (!ambiguous.includes(handle)) ambiguous.push(handle); continue; }
		if (!used.includes(found[0])) used.push(found[0]);
	}
	if (used.length === 0) return { prompt, images: [], unknown, ambiguous };

	const rank = (reference: R) => KIND_RANK[kindKey(reference.kind)] ?? 3;
	const ordered = used.map((reference, mention) => ({ reference, mention })).sort((a, b) => rank(a.reference) - rank(b.reference) || a.mention - b.mention);
	// Images the prompt already declares (a start frame, a hand-written block) keep their numbers.
	const declared = extractDeclarations(promptToText(prompt)).declarations.flatMap((d) => (d.image === null ? [] : [d.image]));
	const first = options.firstImage ?? Math.max(0, ...declared) + 1;
	const images = ordered.map(({ reference }, i) => ({ image: first + i, reference }));
	const imageOf = new Map(images.map((entry) => [entry.reference, entry.image]));

	const body = prompt.replace(HANDLE, (whole, name: string) => {
		const found = byHandle.get(norm(name)) ?? [];
		if (found.length !== 1) return whole;
		return `${imageLabel(target, imageOf.get(found[0])!)} (${found[0].name})`;
	});
	const declarations = images.map(({ image, reference }) => `${imageLabel(target, image)} = ${reference.name} — ${LOCK[kindKey(reference.kind)] ?? 'exact reference lock'}`);
	return { prompt: `${declarations.join('\n')}\n\n${body.trimStart()}`, images, unknown, ambiguous };
}
