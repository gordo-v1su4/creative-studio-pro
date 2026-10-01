/**
 * Prompt linter: treats every reference declared at the top of a generation
 * prompt ("Image 1 is …", "Image 2 defines …'s identity", `"Image 4": "…"`,
 * "No image: …") as a variable, then flags anything later in the prompt that
 * refers to a declared thing by some other name — pronouns, first names only,
 * generic stand-ins ("the store", "the guy"), look/wardrobe re-description —
 * plus target syntax (`@` never on Nano Banana; `@Image_N` on Seedance) and
 * banned words.
 */

export type LintTarget = 'nano_banana' | 'seedance';
export type LintSeverity = 'error' | 'warning';

export interface LintIssue {
	rule: string;
	severity: LintSeverity;
	match: string;
	index: number;
	context: string;
	message: string;
}

export interface Declaration {
	image: number | null;
	name: string;
}

export interface LintResult {
	declarations: Declaration[];
	issues: LintIssue[];
}

const PRONOUNS = /\b(he|she|they|him|her|hers|his|their|theirs|them|himself|herself|themselves)\b/gi;
const PERSON_ALIASES = /\b(guy|girl|boy|man|men|woman|women|person|people|figure|dude|customer|kid)\b/gi;
const PLACE_ALIASES = /\b(store|shop|room|place|building|interior|storefront|location)\b/gi;
const LOOK_WORDS = /\b(blonde?|platinum|curls?|curly|bob|hoodie|jacket|blazer|choker|shades|sunglasses|necklace|jeans|sneakers|braids?|dreads?|tattoos?|piercings?|lip rings?)\b/gi;
// Operator bans: never in a prompt unless explicitly requested (a negative like "no fangs" still primes it).
const BANNED = /\b(neon|fangs?|fanged|vampires?|vampiric|vamp(?:ed)?)\b/gi;
const BLACK_AND_WHITE = /\bblack[- ]and[- ]white\b/gi;
// Operator rejections from Blood Rush reviews: each one has wrecked a generation before.
const REJECTED: Array<[RegExp, string]> = [
	[/\b(flicker(?:s|ing)?|strobe?s?|strobing|drop(?:ped)? frames?)\b/gi, 'Never prompt flicker — describe the edit pace and the beats instead.'],
	[/\bblood[- ]moon\b/gi, 'No blood moon.'],
	[/\b(pink|light[- ]blue|baby[- ]blue)\b[^.\n]{0,40}\b(sign|glow|light|tube)s?\b/gi, 'No pink or light-blue glowing signs.'],
	[/\b(drinks?|drinking|sips?|sipping|gulps?)\b[^.\n]{0,40}\bvial\b|\bvial\b[^.\n]{0,40}\b(drinks?|drinking)\b/gi, 'No vial drinking.'],
	[/\b(red|glowing)\s+(arc|line|trajectory|guide)s?\b|\b(trajectory|guide|arc)\s+line\b/gi, 'Never describe a guide line — the model draws it on screen.'],
	[/\bElias\b[^.\n]{0,80}\b(?:eyes?\b[^.\n]{0,20}\b(?:glow\w*|lit|shining)|(?:glow\w*|lit|shining)\b[^.\n]{0,20}\beyes?)\b|\b(?:glow\w*|lit|shining)\s+(?:blue\s+)?eyes?\b[^.\n]{0,60}\bElias\b/gi, 'Elias\'s eyes never glow.'],
];
const VAGUE = /\b(dark store|the dark)\b/gi;

/** Flatten a JSON prompt into plain lines so escaped quotes don't hide names. */
export function promptToText(raw: string): string {
	try {
		const value: unknown = JSON.parse(raw);
		const out: string[] = [];
		const walk = (node: unknown): void => {
			if (typeof node === 'string') out.push(node);
			else if (Array.isArray(node)) node.forEach(walk);
			else if (node && typeof node === 'object') {
				for (const [key, child] of Object.entries(node)) {
					if (/^Image[ _]?\d+$/.test(key) && typeof child === 'string') out.push(`${key}: ${child}`);
					else walk(child);
				}
			}
		};
		walk(value);
		return out.join('\n');
	} catch {
		return raw;
	}
}

export function extractDeclarations(text: string): { declarations: Declaration[]; spans: Array<[number, number]> } {
	const declarations: Declaration[] = [];
	const spans: Array<[number, number]> = [];
	const add = (image: number | null, name: string, start: number, end: number) => {
		const clean = name.split(/\s+[—–-]\s+/)[0].trim().replace(/\.$/, '');
		if (clean && !declarations.some((d) => d.name === clean && d.image === image)) declarations.push({ image, name: clean });
		spans.push([start, end]);
	};
	for (const m of text.matchAll(/@?Image[ _]?(\d+)((?:\s+and\s+@?Image[ _]?\d+)*)\s+defines?\s+(.+?)(?:’s|'s)\s+identity[^\n.]*\.?/g)) {
		// "Image 1 and Image 2 define X's identity" — several references for one character.
		for (const n of [m[1], ...[...m[2].matchAll(/(\d+)/g)].map((x) => x[1])]) add(Number(n), m[3], m.index, m.index + m[0].length);
	}
	for (const m of text.matchAll(/@?Image[ _]?(\d+)\s+(?:is|and\s+@?Image[ _]?\d+\s+are)\s+([^.\n]+)\.?/g)) add(Number(m[1]), m[2], m.index, m.index + m[0].length);
	for (const m of text.matchAll(/^[-*\s]*@?Image[ _]?(\d+)\s*[:=]\s*(.+)$/gm)) add(Number(m[1]), m[2], m.index, m.index + m[0].length);
	// Inline style (no declaration block): "Kai "Hoodie" Santana from Image 1 walks…" — the phrase since the
	// last clause break names the image. With a declaration block, "from Image N" is only a citation.
	const inline = declarations.some((d) => d.image !== null) ? [] : text.matchAll(/\bfrom\s+@?Image[ _]?(\d+)/g);
	for (const m of inline) {
		const before = text.slice(0, m.index);
		const cut = Math.max(...[':', ';', ',', '.', '\n'].map((c) => before.lastIndexOf(c))) + 1;
		const lead = before.slice(cut);
		const name = lead.trim();
		if (name) add(Number(m[1]), name, cut + lead.length - lead.trimStart().length, m.index + m[0].length);
	}
	for (const m of text.matchAll(/No image:\s*([^\n]+)/g)) add(null, m[1].split(/\s+[—–-]\s+/)[0], m.index, m.index + m[0].length);
	// Operator lock-template instructions talk about references in general, not about a shot.
	for (const m of text.matchAll(/(?:Whenever a named character appears|Identify characters in shot descriptions)[^\n]*/g)) spans.push([m.index, m.index + m[0].length]);
	return { declarations, spans };
}

function mask(text: string, start: number, end: number): string {
	return text.slice(0, start) + '§'.repeat(end - start) + text.slice(end);
}

function contextAt(text: string, index: number, length: number): string {
	const from = Math.max(0, index - 40);
	const to = Math.min(text.length, index + length + 40);
	return `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ')}${to < text.length ? '…' : ''}`;
}

export function lintPrompt(raw: string, target: LintTarget = 'nano_banana'): LintResult {
	const text = promptToText(raw);
	const { declarations, spans } = extractDeclarations(text);
	const issues: LintIssue[] = [];
	const push = (rule: string, severity: LintSeverity, m: RegExpMatchArray, message: string) =>
		issues.push({ rule, severity, match: m[0], index: m.index ?? 0, context: contextAt(text, m.index ?? 0, m[0].length), message });

	// Syntax rules run on the raw text so declarations are checked too.
	if (target === 'nano_banana') {
		for (const m of text.matchAll(/@\w*/g)) push('at-sign', 'error', m, 'Nano Banana: never use @ — write "Image 1".');
	} else {
		for (const m of text.matchAll(/@Image\s+\d+/g)) push('seedance-underscore', 'error', m, 'Seedance: use @Image_1 (underscore), not "@Image 1".');
	}
	for (const m of text.matchAll(BANNED)) push('banned-word', 'error', m, 'Banned word.');
	for (const [pattern, message] of REJECTED) for (const m of text.matchAll(pattern)) push('operator-rejected', 'error', m, message);
	// Seedance: continuity comes from several hard cuts in one generation, never a lone shot.
	if (target === 'seedance' && !/\bcut\b/i.test(text)) {
		issues.push({ rule: 'single-shot', severity: 'warning', match: '(whole prompt)', index: 0, context: contextAt(text, 0, 0), message: 'Seedance: prompt multi-cut shots (hard cuts into the action) in one generation.' });
	}
	for (const m of text.matchAll(BLACK_AND_WHITE)) {
		const before = text.slice(Math.max(0, (m.index ?? 0) - 12), m.index).toLowerCase();
		if (!/\b(no|not|never|nothing)\b[^.]*$/.test(before)) push('black-and-white', 'error', m, 'Nothing is ever black and white.');
	}

	// Everything else runs on the prompt with declarations and declared names masked out.
	let body = text;
	for (const [start, end] of spans) body = mask(body, start, end);
	const names = declarations.map((d) => d.name).sort((a, b) => b.length - a.length);
	for (const name of names) {
		// Sentence-initial capitalisation ("The man on the floor") still counts as the declared name.
		const pattern = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
		for (const m of [...body.matchAll(pattern)]) body = mask(body, m.index, m.index + m[0].length);
	}

	// Quoted text is on-screen labels or spoken dialogue, not a reference to anything declared.
	for (const m of [...body.matchAll(/"[^"\n]*"|“[^”\n]*”/g)]) body = mask(body, m.index, m.index + m[0].length);

	const declaredImages = new Set(declarations.flatMap((d) => (d.image === null ? [] : [d.image])));
	for (const m of body.matchAll(/@?Image[ _]?(\d+)/g)) {
		if (!declaredImages.has(Number(m[1]))) push('undeclared-image', 'error', m, `Image ${m[1]} is never declared.`);
	}
	for (const m of body.matchAll(PRONOUNS)) push('pronoun', 'error', m, 'Pronoun — repeat the declared name instead.');
	for (const m of body.matchAll(PERSON_ALIASES)) push('person-alias', 'error', m, 'Generic person word — use a declared name (or declare "No image: …").');
	for (const m of body.matchAll(PLACE_ALIASES)) push('place-alias', 'error', m, 'Generic place word — use the declared name (e.g. "the Video Haven interior from Image 4").');
	for (const m of body.matchAll(VAGUE)) push('vague-reference', 'error', m, 'Undeclared stand-in for a declared reference.');
	for (const m of body.matchAll(LOOK_WORDS)) push('re-description', 'warning', m, 'Look/wardrobe word — the reference image already shows this.');

	for (const d of declarations) {
		const parts = d.name.replace(/["“”]/g, '').split(/\s+/).filter(Boolean);
		// Only proper names have partials: "Kai" of Kai "Hoodie" Santana, never "The" of "The rooftop".
		if (parts.length < 2 || !/^[A-Z]/.test(parts[0]) || /^(?:the|a|an|on|in|at|inside)$/i.test(parts[0])) continue;
		for (const m of body.matchAll(new RegExp(`\\b${parts[0]}\\b`, 'g'))) push('partial-name', 'error', m, `Partial name — always "${d.name}".`);
	}

	issues.sort((a, b) => a.index - b.index);
	return { declarations, issues };
}
