import type { CutMusic, ProductionState } from './schemas';
import type { CutEntryInput } from './cuts';
import { pickFor } from './takes';
import { liveSpine } from './spine';

/**
 * The Agent's first cut to the score: the Agent chooses which shots go in, in what order, and how many beats
 * each one holds; code turns that into cut entries whose cuts land on the score's beats. The board is never
 * changed, and the result is an ordinary cut the operator edits like any other.
 */

/** Stills hold at most this long; video holds as long as its footage runs. */
export const STILL_MAX_S = 8;
/** No entry shorter than this, so a beat-snap can't leave a flash frame. */
export const MIN_ENTRY_S = 0.4;

/** A shot the Agent can place: numbered from 1 in the order it is shown to the Agent. */
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
}

export interface PlanItem { shot: number; beats: number }

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
		const end = pick.kind === 'video' ? (pick.out_s ?? pick.duration_s ?? card.duration_ms / 1000) : STILL_MAX_S;
		const max_s = Math.round((end - in_s) * 1000) / 1000;
		if (max_s < MIN_ENTRY_S) continue;
		// A dropped-in or imported shot has no beat written yet; its generation prompt says what it shows.
		const beat = card.beat.startsWith('Dropped in:') && pick.generation?.prompt ? pick.generation.prompt : card.beat;
		shots.push({ n: shots.length + 1, card_id: card.card_id, asset_id: pick.asset_id, kind: pick.kind, title: card.title, beat, in_s, max_s });
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
 * Lay the plan along the score: each shot runs from the current point for its number of beats, cut short at
 * the last beat its footage reaches (or where its footage ends), and the cut stops at the end of the score.
 * Unknown and repeated shot numbers are left out, with a note.
 */
export function entriesFromPlan(plan: PlanItem[], shots: AssemblyShot[], music: Pick<CutMusic, 'duration_s' | 'beats'>, endTag?: EndTag | null): { entries: CutEntryInput[]; notes: string[]; covered_s: number } {
	const points = cutPoints(music);
	const byNumber = new Map(shots.map((shot) => [shot.n, shot]));
	const used = new Set<number>();
	const entries: CutEntryInput[] = [];
	const notes: string[] = [];
	let t = 0;
	for (const item of plan) {
		if (t >= music.duration_s - MIN_ENTRY_S) { notes.push(`The score ends at ${music.duration_s.toFixed(1)}s; shots after S${item.shot} were left out`); break; }
		const shot = byNumber.get(item.shot);
		if (!shot) { notes.push(`S${item.shot} is not a shot of this project; left out`); continue; }
		if (used.has(shot.n)) { notes.push(`S${shot.n} was placed twice; used once`); continue; }
		const at = points.findIndex((p) => p >= t - 0.01);
		const wanted = points[Math.min(points.length - 1, at + Math.max(1, Math.round(item.beats)))];
		// The furthest cut point the footage reaches, no further than the plan asked.
		const reach = points.filter((p) => p > t + MIN_ENTRY_S - 1e-6 && p <= Math.min(wanted, t + shot.max_s) + 1e-6).at(-1);
		const length = Math.min(music.duration_s - t, reach !== undefined ? reach - t : shot.max_s);
		if (length < MIN_ENTRY_S) { notes.push(`S${shot.n} is too short to place at ${t.toFixed(1)}s; left out`); continue; }
		used.add(shot.n);
		entries.push({ card_id: shot.card_id, asset_id: shot.asset_id, in_s: r3(shot.in_s), out_s: r3(shot.in_s + length) });
		t = r3(t + length);
	}
	const covered_s = t;
	if (entries.length && t < music.duration_s - 1) notes.push(`The cut runs ${t.toFixed(1)}s of the ${music.duration_s.toFixed(1)}s score`);
	// The end tag: one ident shot after the music, held over the silence.
	if (endTag && entries.length) {
		const shot = byNumber.get(endTag.shot);
		if (!shot) notes.push(`End tag S${endTag.shot} is not a shot of this project; left out`);
		else {
			const hold = Math.min(shot.max_s, Math.max(MIN_ENTRY_S, Math.min(END_TAG_MAX_S, endTag.seconds)));
			entries.push({ card_id: shot.card_id, asset_id: shot.asset_id, in_s: r3(shot.in_s), out_s: r3(shot.in_s + hold) });
			if (used.has(shot.n)) notes.push(`End tag S${shot.n} also plays earlier in the cut`);
		}
	}
	return { entries, notes, covered_s };
}

/** The ident after the music: which shot and how long it holds. */
export interface EndTag { shot: number; seconds: number }
export const END_TAG_MAX_S = 6;

/**
 * How loud the score is in each bar (four beats), 0 to 9 against its loudest bar, so the Agent can see the
 * build, the drops and the hits. Samples are mono PCM at `rate`.
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
