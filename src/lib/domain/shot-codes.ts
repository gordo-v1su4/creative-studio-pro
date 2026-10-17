/**
 * Shot codes (V1S-274): `BLR_EP101_PAR_0020_v003` = show · episode · scene · shot · version.
 * Show and scene codes are three capital letters; episodes are `EP` + season digit + two-digit
 * episode; shots are four digits in steps of 10, inserts take a number in between, and a code
 * never changes once a take of it has been sent (the codes are locked).
 */

export const CODE_PATTERN = /^[A-Z]{3}$/;
export const SHOT_STEP = 10;
export const SHOT_MAX = 9999;

/** What each part of a code means, for the legend wherever codes are shown. */
export const CODE_LEGEND = [
	{ part: 'BLR', means: 'Show code: three letters, the same for the whole series' },
	{ part: 'EP101', means: 'Season 1, episode 01 (EP201 is season 2, episode 01)' },
	{ part: 'PAR', means: 'Scene code: three letters for the scene (PAR = parking lot); its story order is in the folder name, 010, 020…' },
	{ part: '0020', means: 'Shot number: steps of 10 from 0010; a shot added later takes a number in between (0015)' },
	{ part: 'v003', means: 'Version: the third take of that shot' },
	{ part: 'EPC · TSR01 · TRL01', means: 'Deliverables: episode cut, teaser #1, trailer #1' }
] as const;

const STOP_WORDS = new Set(['THE', 'A', 'AN', 'OF', 'AND', 'IN', 'ON', 'AT', 'TO', 'FOR', 'WITH']);

/** The words of a title, upper-cased, without scene prefixes like "P01 —" or "(Teaser)" asides. */
function wordsOf(title: string, keepAsides = false): string[] {
	const words = wordsIn(title, keepAsides);
	// Too few letters without the aside ("2:47 AM (Teaser)")? Use the aside too.
	return !keepAsides && words.join('').replace(/[^A-Z]/g, '').length < 3 ? wordsIn(title, true) : words;
}

function wordsIn(title: string, keepAsides: boolean): string[] {
	const stripped = title.replace(/^\s*[A-Z]?\d+[A-Z]?\s*[—–:-]\s*/i, ''); // "P01 — ", "12: "
	const cleaned = (keepAsides ? stripped.replace(/[()]/g, ' ') : stripped.replace(/\([^)]*\)/g, ' '))
		.toUpperCase()
		.replace(/[^A-Z0-9 ]+/g, ' ');
	const words = cleaned.split(/\s+/).filter((word) => /[A-Z]/.test(word));
	const meaningful = words.filter((word) => !STOP_WORDS.has(word));
	return meaningful.length ? meaningful : words;
}

/** Letters a code can take from a word, in order: the first letter, then its consonants, then the rest. */
function lettersOf(word: string): string[] {
	const letters = [...word.replace(/[^A-Z]/g, '')];
	if (!letters.length) return [];
	const [first, ...rest] = letters;
	return [first, ...rest.filter((l) => !'AEIOU'.includes(l)), ...rest.filter((l) => 'AEIOU'.includes(l))];
}

/** Three-letter candidates for a title, best first ("Blood Rush" → BLR, BRS…; "Parking Lot" → PRL, PLT…). */
export function codeCandidates(title: string): string[] {
	const words = wordsOf(title).map(lettersOf).filter((letters) => letters.length);
	const out: string[] = [];
	const add = (code: string) => { if (CODE_PATTERN.test(code) && !out.includes(code)) out.push(code); };
	if (words.length >= 3) add(words[0][0] + words[1][0] + words[2][0]);
	if (words.length >= 2) {
		for (const second of words[0].slice(1)) add(words[0][0] + second + words[1][0]);
		for (const third of words[1].slice(1)) add(words[0][0] + words[1][0] + third);
	}
	const all = words.flat();
	for (let i = 1; i < all.length; i++) for (let j = i + 1; j < all.length; j++) add(all[0] + all[i] + all[j]);
	return out;
}

/** The suggested code for a title that is not already taken; falls back to the first letter + a free pair. */
export function suggestCode(title: string, taken: Iterable<string> = []): string {
	const used = new Set(taken);
	const free = codeCandidates(title).find((code) => !used.has(code));
	if (free) return free;
	const first = wordsOf(title)[0]?.[0] ?? 'X';
	const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	for (const b of A) for (const c of A) if (!used.has(first + b + c)) return first + b + c;
	throw new Error('No free three-letter code left');
}

/** `EP101` for season 1, episode 1. Season defaults to 1. */
export function episodeCode(season: number | null | undefined, episode: number): string {
	const s = Math.max(1, Math.trunc(season ?? 1));
	const e = Math.max(0, Math.trunc(episode));
	if (s > 9 || e > 99) throw new Error(`Episode ${s}x${e} does not fit EP###`);
	return `EP${s}${String(e).padStart(2, '0')}`;
}

/** A scene's place in story order as its folder prefix: the first scene is 010, then 020… */
export const sceneOrder = (index: number) => String((index + 1) * SHOT_STEP).padStart(3, '0');

export const shotNumberText = (shot: number) => String(shot).padStart(4, '0');
export const versionText = (version: number) => `v${String(version).padStart(3, '0')}`;

export interface CodeParts { show: string; episode: string; scene: string; shot: number }

export function formatShotCode(parts: CodeParts, version?: number): string {
	const base = `${parts.show}_${parts.episode}_${parts.scene}_${shotNumberText(parts.shot)}`;
	return version === undefined ? base : `${base}_${versionText(version)}`;
}

const SHOT_CODE = /^([A-Z]{3})_(EP\d{3})_([A-Z]{3})_(\d{4})(?:_v(\d{3}))?$/;

/** Reads a shot code (with or without its version); null when the text is not one. */
export function parseShotCode(text: string): (CodeParts & { version: number | null }) | null {
	const match = SHOT_CODE.exec(text.trim());
	if (!match) return null;
	return { show: match[1], episode: match[2], scene: match[3], shot: Number(match[4]), version: match[5] ? Number(match[5]) : null };
}

/** A shot from Notion is an insert when its name ends in a letter after the shot number (P01.01A). */
export const isInsert = (title: string) => /\d[A-Z]$/i.test(title.trim());

/** A free number strictly between two shots, the midpoint; null when there is no room. */
export function numberBetween(before: number, after: number | null): number | null {
	if (after === null) {
		const next = (Math.floor(before / SHOT_STEP) + 1) * SHOT_STEP;
		return next <= SHOT_MAX ? next : null;
	}
	const mid = Math.floor((before + after) / 2);
	return mid > before && mid < after ? mid : null;
}

/**
 * Shot numbers for one scene's shots, in their order: shots go 0010, 0020…, and an insert (P01.01A)
 * takes the midpoint between its neighbours (0015). A run of inserts splits the gap again and again.
 */
export function numberShots(titles: string[]): number[] {
	const numbers: Array<number | null> = [];
	let base = 0;
	for (const title of titles) {
		if (isInsert(title) && numbers.length > 0) numbers.push(null);
		else { base += SHOT_STEP; numbers.push(base); }
	}
	// Fill each run of inserts between its two fixed neighbours.
	for (let i = 0; i < numbers.length; i++) {
		if (numbers[i] !== null) continue;
		let j = i;
		while (j < numbers.length && numbers[j] === null) j++;
		const before = numbers[i - 1] as number;
		const after = j < numbers.length ? (numbers[j] as number) : before + SHOT_STEP;
		const run = j - i;
		for (let k = 0; k < run; k++) {
			const value = Math.floor(before + ((after - before) * (k + 1)) / (run + 1));
			if (value <= (numbers[i + k - 1] ?? before) || value >= after) throw new Error('No room for the inserted shots between their neighbours');
			numbers[i + k] = value;
		}
		i = j;
	}
	return numbers as number[];
}

/**
 * The number for a shot added after `afterNumber` in a scene that already uses `taken`: the midpoint to
 * the next shot, or the next step of 10 at the end. Never reuses or changes an existing number.
 */
export function insertShotNumber(taken: number[], afterNumber: number | null): number {
	const sorted = [...new Set(taken)].sort((a, b) => a - b);
	const before = afterNumber ?? 0;
	const next = sorted.find((n) => n > before) ?? null;
	const value = numberBetween(before, next);
	if (value === null || sorted.includes(value)) throw new Error(`No free shot number after ${shotNumberText(before)}`);
	return value;
}

interface CodedScene { title: string; group_id: string; code?: string }
interface CodedCard { card_id: string; title: string; order: number; group_id?: string; shot_number?: number }

/**
 * Fills in what an episode is missing: a code for each scene without one (unique in the episode) and a
 * number for each scene shot without one. Codes and numbers already set are never changed; a scene whose
 * shots have no numbers yet is numbered from its shot names (inserts take midpoints), and a shot added to a
 * numbered scene takes a free number after the shot before it.
 */
export function fillEpisodeCodes<S extends CodedScene, C extends CodedCard>(scenes: S[], cards: C[]): { scenes: S[]; cards: C[] } {
	const taken = new Set(scenes.map((scene) => scene.code).filter((code): code is string => !!code));
	const nextScenes = scenes.map((scene) => {
		if (scene.code) return scene;
		const code = suggestCode(scene.title, taken);
		taken.add(code);
		return { ...scene, code };
	});
	const numbers = new Map<string, number>();
	for (const scene of scenes) {
		const own = cards.filter((card) => card.group_id === scene.group_id).toSorted((a, b) => a.order - b.order);
		if (own.length === 0) continue;
		if (own.every((card) => card.shot_number === undefined)) {
			numberShots(own.map((card) => card.title)).forEach((n, i) => numbers.set(own[i].card_id, n));
			continue;
		}
		const used = own.flatMap((card) => (card.shot_number === undefined ? [] : [card.shot_number]));
		let previous: number | null = null;
		for (const card of own) {
			if (card.shot_number !== undefined) { previous = card.shot_number; continue; }
			const n = insertShotNumber(used, previous);
			used.push(n); numbers.set(card.card_id, n); previous = n;
		}
	}
	const nextCards = cards.map((card) => (numbers.has(card.card_id) ? { ...card, shot_number: numbers.get(card.card_id) } : card));
	return { scenes: nextScenes, cards: nextCards };
}

/** Problems with a set of codes for one episode: bad shapes and scene codes used twice. */
export function codeProblems(show: string | null, scenes: Array<{ title: string; code?: string | null }>): string[] {
	const problems: string[] = [];
	if (!show || !CODE_PATTERN.test(show)) problems.push('The show code must be three capital letters');
	const seen = new Map<string, string>();
	for (const scene of scenes) {
		if (!scene.code) { problems.push(`${scene.title} has no scene code`); continue; }
		if (!CODE_PATTERN.test(scene.code)) problems.push(`${scene.title}: "${scene.code}" is not three capital letters`);
		const other = seen.get(scene.code);
		if (other) problems.push(`${scene.code} is used by both ${other} and ${scene.title}`);
		else seen.set(scene.code, scene.title);
	}
	return problems;
}
