import type { CutMusic, ProductionState } from './schemas';
import type { CutEntryInput } from './cuts';
import { MAX_INNER_CUTS, type ShotTags } from './shot-tags';
import { pickFor } from './takes';
import { liveSpine } from './spine';

/**
 * The first cut to the score, planned in code from shot tags and the score's sections: the same tags and
 * score always give the same cut. Quiet sections hold calm shots longer; loud ones cut fast on moving shots;
 * story order is kept where the energy allows; the same place twice in a row is avoided; every cut lands on a
 * beat; the cut runs the whole score and ends on the title card held over the silence. The board is never
 * changed, and the result is an ordinary cut the operator edits like any other.
 */

/** Stills hold at most this long; video holds as long as its footage runs. */
export const STILL_MAX_S = 8;
/** No entry shorter than this, so a beat-snap can't leave a flash frame. */
export const MIN_ENTRY_S = 0.4;
/** The end tag holds this long after the music. */
export const END_TAG_S = 3;
/** Target hold at the quietest and the loudest section, in seconds (snapped to whole beats). */
export const CALM_HOLD_S = 3.6;
export const DRIVE_HOLD_S = 1.2;

/** A shot the cut can use: numbered from 1 in story order (the spine, then shots off it). */
export interface AssemblyShot {
	n: number;
	card_id: string;
	asset_id: string;
	kind: 'image' | 'video';
	title: string;
	beat: string;
	/** Where the footage starts (the take's trim in) and how many seconds of it are usable from there. */
	in_s: number;
	max_s: number;
	tags?: ShotTags;
}

export interface Section { start: number; end: number; label: string; energy: number }

/** Every shot with a usable pick: the spine in story order first, then shots off it in card order. Benched shots are left out. */
export function shotsForAssembly(production: ProductionState): AssemblyShot[] {
	const spine = liveSpine(production);
	const onSpine = new Set(spine.map((card) => card.card_id));
	const rest = [...production.cards].sort((a, b) => a.order - b.order).filter((card) => !onSpine.has(card.card_id) && !card.benched);
	const shots: AssemblyShot[] = [];
	for (const card of [...spine, ...rest]) {
		const pick = pickFor(production, card);
		if (!pick) continue;
		const in_s = pick.kind === 'video' ? (pick.in_s ?? 0) : 0;
		const end = pick.kind === 'video' ? (pick.out_s ?? pick.duration_s ?? pick.tags?.duration_s ?? card.duration_ms / 1000) : STILL_MAX_S;
		const max_s = Math.round((end - in_s) * 1000) / 1000;
		if (max_s < MIN_ENTRY_S) continue;
		// A dropped-in or imported shot has no beat written yet; its generation prompt says what it shows.
		const beat = card.beat.startsWith('Dropped in:') && pick.generation?.prompt ? pick.generation.prompt : card.beat;
		shots.push({ n: shots.length + 1, card_id: card.card_id, asset_id: pick.asset_id, kind: pick.kind, title: card.title, beat, in_s, max_s, ...(pick.tags ? { tags: pick.tags } : {}) });
	}
	return shots;
}

/** The cut points the score offers: 0, each beat, and the end. A song with no beat grid gets one every half second. */
export function cutPoints(music: Pick<CutMusic, 'duration_s' | 'beats'>): number[] {
	const beats = music.beats.filter((b) => b > 0.05 && b < music.duration_s - 0.05);
	const grid = beats.length >= 2 ? beats : Array.from({ length: Math.floor(music.duration_s / 0.5) }, (_, i) => (i + 1) * 0.5).filter((b) => b < music.duration_s - 0.05);
	return [0, ...grid, music.duration_s];
}

const r3 = (s: number) => Math.round(s * 1000) / 1000;

/**
 * How loud the score is in each bar (four beats), 0 to 9 against its loudest bar. Samples are mono PCM at
 * `rate`. Used for sections when the score has no Essentia analysis.
 */
export function barLoudness(samples: Float32Array, rate: number, music: Pick<CutMusic, 'duration_s' | 'beats'>): Array<{ at: number; level: number }> {
	const points = cutPoints(music);
	const bars = points.filter((_, i) => i % 4 === 0 && i < points.length - 1);
	const rms = bars.map((start, i) => {
		const end = bars[i + 1] ?? music.duration_s;
		const from = Math.floor(start * rate), to = Math.min(samples.length, Math.floor(end * rate));
		let sum = 0;
		for (let s = from; s < to; s++) sum += samples[s] * samples[s];
		return to > from ? Math.sqrt(sum / (to - from)) : 0;
	});
	const loudest = Math.max(...rms, 1e-9);
	return bars.map((at, i) => ({ at: r3(at), level: Math.round((rms[i] / loudest) * 9) }));
}

/** Sections from bar loudness: eight bars each, energy their mean level (0..1). */
export function sectionsFromBars(bars: Array<{ at: number; level: number }>, duration_s: number): Section[] {
	const sections: Section[] = [];
	for (let i = 0; i < bars.length; i += 8) {
		const group = bars.slice(i, i + 8);
		sections.push({ start: group[0].at, end: bars[i + 8]?.at ?? duration_s, label: 'bars', energy: r3(group.reduce((sum, bar) => sum + bar.level, 0) / group.length / 9) });
	}
	return sections;
}

/** Energy of each shot, 0..1, by the rank of its motion among the shots (stills calm, untagged video in the middle). */
export function shotEnergies(shots: AssemblyShot[]): Map<number, number> {
	const moving = shots.filter((shot) => shot.kind === 'video' && shot.tags).sort((a, b) => a.tags!.motion - b.tags!.motion || a.n - b.n);
	const energy = new Map<number, number>();
	moving.forEach((shot, i) => energy.set(shot.n, moving.length > 1 ? r3(i / (moving.length - 1)) : 0.5));
	for (const shot of shots) if (!energy.has(shot.n)) energy.set(shot.n, shot.kind === 'image' ? 0.15 : 0.5);
	return energy;
}

const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4));
/** Two places are the same when most of their words are shared. */
export function samePlace(a?: string, b?: string): boolean {
	if (!a || !b) return false;
	const wa = words(a), wb = words(b);
	if (!wa.size || !wb.size) return false;
	const shared = [...wa].filter((word) => wb.has(word)).length;
	return shared / Math.min(wa.size, wb.size) >= 0.6;
}

/** How long a shot holds from t: to the last cut point its footage reaches, no further than `beats` on; else its footage's end. */
function holdFrom(points: number[], t: number, beats: number, available: number, end: number): number {
	const at = points.findIndex((p) => p >= t - 0.01);
	const wanted = points[Math.min(points.length - 1, at + Math.max(1, beats))];
	const reach = points.filter((p) => p > t + MIN_ENTRY_S - 1e-6 && p <= Math.min(wanted, t + available) + 1e-6).at(-1);
	return Math.min(end - t, reach !== undefined ? reach - t : available);
}

/** What a section label usually asks of the picture, 0 (let it breathe) to 1 (drive). */
const LABEL_DRIVE: Array<[RegExp, number]> = [[/intro/, 0.15], [/outro|end/, 0.3], [/bridge|break/, 0.35], [/verse/, 0.45], [/pre/, 0.6], [/chorus|hook|drop|inst|solo/, 0.85]];

/**
 * How hard each section drives the cut, 0..1: half what its label usually means, half how loud it is against
 * the other sections (by rank, so one very quiet section can't make all the rest look equally loud).
 */
export function sectionDrive(sections: Section[]): number[] {
	const order = sections.map((s, i) => ({ e: s.energy, i })).sort((a, b) => a.e - b.e);
	const rank = new Array<number>(sections.length);
	order.forEach(({ i }, k) => (rank[i] = sections.length > 1 ? k / (sections.length - 1) : 0.5));
	return sections.map((s, i) => {
		const label = LABEL_DRIVE.find(([pattern]) => pattern.test(s.label))?.[1];
		return r3(label === undefined ? rank[i] : (label + rank[i]) / 2);
	});
}

export interface PlannedCut { entries: CutEntryInput[]; notes: string[]; covered_s: number }

/** Plan the first cut: see the module comment for the rules. */
export function planCut(shots: AssemblyShot[], music: Pick<CutMusic, 'duration_s' | 'beats' | 'bpm'>, sections: Section[]): PlannedCut {
	const notes: string[] = [];
	// A title card often fades or flickers, which reads as cuts; it is never an edit.
	const edits = shots.filter((shot) => !shot.tags?.title_card && (shot.tags?.cuts ?? 0) > MAX_INNER_CUTS);
	if (edits.length) notes.push(`Left out ${edits.map((shot) => shot.title).join(', ')}: already an edit (cuts inside)`);
	const usable = shots.filter((shot) => !edits.includes(shot));
	const title = usable.find((shot) => shot.tags?.title_card);
	const pool = usable.filter((shot) => shot !== title);
	const untagged = pool.filter((shot) => !shot.tags).length;
	if (untagged) notes.push(`${untagged} untagged shot${untagged === 1 ? '' : 's'} placed by order only; tag them for a better cut`);
	if (pool.length === 0) return { entries: [], notes: [...notes, 'No shots to cut'], covered_s: 0 };

	const points = cutPoints(music);
	const gaps = points.slice(1).map((p, i) => p - points[i]).filter((g) => g > 0.05).sort((a, b) => a - b);
	const beat = music.bpm > 0 ? 60 / music.bpm : (gaps[Math.floor(gaps.length / 2)] ?? 0.5);
	const drive = sectionDrive(sections);
	const sectionEnergy = (t: number) => {
		const i = sections.findIndex((s) => t >= s.start - 1e-6 && t < s.end);
		return drive[i === -1 ? sections.length - 1 : i] ?? 0.5;
	};
	const energy = shotEnergies(pool);
	const used = new Map<number, number>();
	const uses = new Map<number, number>();
	const recent: number[] = [];
	const entries: CutEntryInput[] = [];
	let t = 0;
	let last: AssemblyShot | null = null;

	while (t < music.duration_s - MIN_ENTRY_S) {
		const e = sectionEnergy(t);
		const beats = Math.max(1, Math.round((CALM_HOLD_S - (CALM_HOLD_S - DRIVE_HOLD_S) * e) / beat));
		const remaining = (shot: AssemblyShot) => shot.max_s - (used.get(shot.n) ?? 0);
		const fresh = pool.filter((shot) => !used.has(shot.n));
		// Every shot once before any shot twice; a second use continues its footage and never comes back within three cuts.
		const candidates = fresh.length ? fresh : pool.filter((shot) => !recent.includes(shot.n) && remaining(shot) >= Math.min(beats * beat, 1.5));
		if (candidates.length === 0) { notes.push(`Ran out of footage at ${t.toFixed(1)}s`); break; }
		const prev: AssemblyShot | null = last;
		const nextInStory: number = prev ? prev.n + 1 : 1;
		const cost = (shot: AssemblyShot): number =>
			Math.abs((energy.get(shot.n) ?? 0.5) - e) +
			0.3 * Math.min(1, Math.abs(shot.n - nextInStory) / Math.max(4, pool.length / 3)) +
			(prev && samePlace(shot.tags?.place, prev.tags?.place) ? 0.35 : 0) +
			0.4 * (uses.get(shot.n) ?? 0);
		const pick: AssemblyShot = candidates.reduce((best, shot) => (cost(shot) < cost(best) - 1e-9 ? shot : best));
		const offset = used.get(pick.n) ?? 0;
		const length = holdFrom(points, t, beats, remaining(pick), music.duration_s);
		if (length < MIN_ENTRY_S) { used.set(pick.n, pick.max_s); continue; }
		entries.push({ card_id: pick.card_id, asset_id: pick.asset_id, in_s: r3(pick.in_s + offset), out_s: r3(pick.in_s + offset + length) });
		used.set(pick.n, r3(offset + length));
		uses.set(pick.n, (uses.get(pick.n) ?? 0) + 1);
		recent.push(pick.n);
		if (recent.length > 3) recent.shift();
		t = r3(t + length);
		last = pick;
	}
	const covered_s = t;
	const placed = new Map<string, number>();
	for (const entry of entries) placed.set(entry.card_id, (placed.get(entry.card_id) ?? 0) + 1);
	const again = [...placed.values()].filter((count) => count > 1).length;
	notes.push(`${placed.size} of ${pool.length} shots used${again ? `; ${again} used again, further into their footage` : ''}`);
	if (title) {
		entries.push({ card_id: title.card_id, asset_id: title.asset_id, in_s: r3(title.in_s), out_s: r3(title.in_s + Math.min(title.max_s, END_TAG_S)) });
		notes.push(`Ends on ${title.title} after the music`);
	} else notes.push('No title card tagged, so no end tag');
	return { entries, notes, covered_s };
}
