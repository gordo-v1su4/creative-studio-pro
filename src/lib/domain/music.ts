import { isFlat, programElapsed, type SpeedPoint } from '../media/speed-curve';

/**
 * Match to music (V1S-126). Pure signal work, in code, not the model:
 * an onset envelope from audio samples, a beat grid from a song's envelope,
 * and aligning each cut entry's own audio to the song playing straight
 * through underneath the cut, keeping the operator's order.
 */

/** Envelope frames per second (10 ms hops). */
export const ENVELOPE_HZ = 100;
/** Below this correlation an entry isn't trusted to be aligned; it beat-snaps instead. */
export const MIN_CONFIDENCE = 0.5;
/** Places scoring within this of the best count as equally good (repetitive music). */
const MIN_MARGIN = 0.03;
const MIN_SPAN_S = 0.2;

/**
 * Onset strength at ENVELOPE_HZ: the rise in loudness (RMS) from one 10 ms
 * hop to the next. Peaks where something starts, and keeps how hard it
 * starts, so a loud hit and a soft one differ: that's what makes one place
 * in a song look different from the next beat over.
 */
export function onsetEnvelope(samples: Float32Array, sampleRate: number): number[] {
	const hop = Math.max(1, Math.round(sampleRate / ENVELOPE_HZ));
	const frames = Math.floor(samples.length / hop);
	const rms = new Array<number>(frames);
	for (let f = 0; f < frames; f++) {
		let sum = 0;
		for (let i = f * hop; i < (f + 1) * hop; i++) sum += samples[i] * samples[i];
		rms[f] = Math.sqrt(sum / hop);
	}
	return rms.map((r, f) => (f === 0 ? 0 : Math.max(0, r - rms[f - 1])));
}

/** Whether an envelope has anything in it (a silent or absent track doesn't). */
export function hasSignal(envelope: number[] | null | undefined): envelope is number[] {
	return !!envelope && envelope.length > ENVELOPE_HZ / 2 && envelope.some((v) => v > 0.002);
}

/**
 * Tempo by autocorrelation of the onset envelope (70–180 BPM, mildly
 * preferring 90–140), then the beat phase that lands most onsets.
 */
export function beatGrid(onset: number[], hz = ENVELOPE_HZ): { bpm: number; beats: number[] } {
	const mean = onset.reduce((s, v) => s + v, 0) / Math.max(1, onset.length);
	const x = onset.map((v) => v - mean);
	let best = { lag: 0, score: -Infinity };
	const minLag = Math.round((60 / 180) * hz);
	const maxLag = Math.round((60 / 70) * hz);
	for (let lag = minLag; lag <= maxLag; lag++) {
		let s = 0;
		for (let i = lag; i < x.length; i++) s += x[i] * x[i - lag];
		const bpm = (60 * hz) / lag;
		const weight = bpm >= 90 && bpm <= 140 ? 1 : 0.85;
		if (s * weight > best.score) best = { lag, score: s * weight };
	}
	if (best.lag === 0 || best.score <= 0) return { bpm: 0, beats: [] };
	const lag = best.lag;
	let phase = 0, phaseScore = -Infinity;
	for (let p = 0; p < lag; p++) {
		let s = 0;
		for (let i = p; i < onset.length; i += lag) s += onset[i];
		if (s > phaseScore) { phaseScore = s; phase = p; }
	}
	const beats: number[] = [];
	for (let i = phase; i < onset.length; i += lag) beats.push(Math.round((i / hz) * 1000) / 1000);
	return { bpm: Math.round(((60 * hz) / lag) * 10) / 10, beats };
}

/** Pearson correlation of two equal-length windows; 0 when either is flat. */
function correlate(a: number[], aStart: number, b: number[], bStart: number, n: number): number {
	let sa = 0, sb = 0;
	for (let i = 0; i < n; i++) { sa += a[aStart + i]; sb += b[bStart + i]; }
	const ma = sa / n, mb = sb / n;
	let cov = 0, va = 0, vb = 0;
	for (let i = 0; i < n; i++) {
		const da = a[aStart + i] - ma, db = b[bStart + i] - mb;
		cov += da * db; va += da * da; vb += db * db;
	}
	return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

export interface MusicEntry {
	entry_id: string;
	in_s: number;
	out_s: number;
	speed?: SpeedPoint[];
	/** The take's full length. */
	duration_s: number;
	/** The take's own audio as an onset envelope, null when it has none. */
	onset: number[] | null;
}

export interface MatchedEntry {
	entry_id: string;
	in_s: number;
	out_s: number;
	/** aligned: slid to where its audio matches the song; snapped: its cut moved onto a beat; kept: unchanged. */
	mode: 'aligned' | 'snapped' | 'kept';
	confidence: number;
	note: string;
}

/** The out-point that makes a ramped span play for `length` program seconds (bisection; flat is exact). */
function outForLength(entry: Pick<MusicEntry, 'in_s' | 'speed'>, length: number, maxOut: number): number {
	if (isFlat(entry.speed)) return Math.min(maxOut, entry.in_s + length);
	let lo = entry.in_s + 1e-3, hi = maxOut;
	if (programElapsed(entry.speed, hi - entry.in_s) <= length) return hi;
	for (let i = 0; i < 40; i++) {
		const mid = (lo + hi) / 2;
		if (programElapsed(entry.speed, mid - entry.in_s) < length) lo = mid; else hi = mid;
	}
	return (lo + hi) / 2;
}

const r3 = (s: number) => Math.round(s * 1000) / 1000;

/**
 * Align a cut to a song that plays from the cut's start. In order, each
 * entry either slides within its own footage (same length) to where its
 * audio best matches the song at its place in the cut, or — when that
 * match isn't confident, the take has no audio, or the entry is ramped —
 * moves its out-point so its cut lands on the nearest beat. Order is never
 * changed; neighbouring edges stay butted because each entry's place
 * follows the ones before it.
 */
export function matchToMusic(song: { onset: number[]; beats: number[] }, entries: MusicEntry[], minConfidence = MIN_CONFIDENCE): MatchedEntry[] {
	const hz = ENVELOPE_HZ;
	const out: MatchedEntry[] = [];
	let cursor = 0;
	for (const entry of entries) {
		const span = entry.out_s - entry.in_s;
		const length = programElapsed(entry.speed, span);
		const start = Math.round(cursor * hz);
		const n = Math.round(span * hz);
		let aligned: MatchedEntry | null = null;
		let why = '';
		if (!isFlat(entry.speed)) why = 'speed-ramped';
		else if (!hasSignal(entry.onset)) why = 'no audio in the take';
		else if (start + n > song.onset.length) why = 'past the end of the song';
		else {
			const take = entry.onset;
			const last = Math.min(take.length - n, Math.floor((entry.duration_s - span) * hz));
			const scores: number[] = [];
			for (let o = 0; o <= last; o++) scores.push(correlate(take, o, song.onset, start, n));
			let bestAt = 0;
			scores.forEach((s, o) => { if (s > scores[bestAt]) bestAt = o; });
			const best = scores[bestAt] ?? 0;
			// Repetitive music matches equally well a beat or a bar apart: among the places that tie
			// with the best (local peaks within the margin), take the one nearest the current in-point.
			const ties = scores.flatMap((s, o) => (s >= best - MIN_MARGIN && s >= (scores[o - 1] ?? -1) && s >= (scores[o + 1] ?? -1) ? [o] : []));
			const pick = ties.reduce((near, o) => (Math.abs(o / hz - entry.in_s) < Math.abs(near / hz - entry.in_s) ? o : near), bestAt);
			const tied = ties.some((o) => Math.abs(o - bestAt) > Math.round(0.25 * hz));
			if (scores.length && best >= minConfidence) {
				const in_s = r3(pick / hz);
				const slid = Math.abs(in_s - entry.in_s) > 1e-3 ? `, slid ${in_s > entry.in_s ? '+' : ''}${(in_s - entry.in_s).toFixed(2)}s` : '';
				aligned = { entry_id: entry.entry_id, in_s, out_s: r3(in_s + span), mode: 'aligned', confidence: r3(scores[pick]), note: tied
					? `on the song's rhythm at ${r3(cursor)}s (r ${scores[pick].toFixed(2)}; it repeats, so the nearest of ${ties.length} equal places)${slid}`
					: `matched the song at ${r3(cursor)}s (r ${scores[pick].toFixed(2)})${slid}` };
			} else why = `no confident match (r ${best.toFixed(2)})`;
		}
		if (aligned) {
			out.push(aligned);
			cursor += length;
			continue;
		}
		// Beat-snap: move this entry's cut (its end in the cut) onto the nearest reachable beat.
		const end = cursor + length;
		const maxLength = programElapsed(entry.speed, entry.duration_s - entry.in_s);
		const reachable = song.beats.filter((b) => b - cursor >= MIN_SPAN_S && b - cursor <= maxLength + 1e-6);
		const beat = reachable.reduce<number | null>((nearest, b) => (nearest === null || Math.abs(b - end) < Math.abs(nearest - end) ? b : nearest), null);
		if (beat === null) {
			out.push({ entry_id: entry.entry_id, in_s: entry.in_s, out_s: entry.out_s, mode: 'kept', confidence: 0, note: `${why}; no beat in reach` });
			cursor += length;
			continue;
		}
		const out_s = r3(outForLength(entry, beat - cursor, entry.duration_s));
		out.push({ entry_id: entry.entry_id, in_s: entry.in_s, out_s, mode: 'snapped', confidence: 0, note: `${why}; cut moved ${beat >= end ? '+' : ''}${(beat - end).toFixed(2)}s onto the beat at ${r3(beat)}s` });
		cursor += programElapsed(entry.speed, out_s - entry.in_s);
	}
	return out;
}
