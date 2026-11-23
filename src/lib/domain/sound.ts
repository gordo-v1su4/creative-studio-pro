import { fractionAtProgram, isFlat, programElapsed, rateAt, type SpeedPoint } from '../media/speed-curve';
import type { SoundPlan } from './schemas';

/**
 * Sound stage (V1S-128): the deterministic parts of the auto-mix, pure, and
 * the ffmpeg render plan that executes them. Four layers on a locked cut:
 * take audio, an ambience bed, music and added effects.
 */

/** Where each layer sits before the operator's own gain (RMS dBFS). */
export const LEVEL_TARGETS_DB = { take: -20, ambience: -34, music: -21, effects: -18 } as const;
export type Layer = keyof typeof LEVEL_TARGETS_DB;
/** Take audio is time-stretched up to this rate and muted above it (no chipmunks). */
export const MAX_STRETCH = 1.5;
/**
 * A sound chopped mid-hit at a cut: the last 30 ms before the out-point are
 * loud in absolute terms and clearly louder than the take's own average.
 */
const CUTOFF_DB = -30;
const CUTOFF_ABOVE_AVERAGE_DB = 4;
const RING_OUT_S = 0.25;

export function defaultSoundPlan(): SoundPlan {
	const layer = { gain_db: 0, mute: false };
	return { layers: { take: { ...layer }, ambience: { ...layer }, music: { ...layer }, effects: { ...layer } }, effects: [], crossfade_s: 0.04, duck_db: -9, limiter_db: -1 };
}

/** Gain that brings a measured level to its target, within sane bounds, in half-dB steps. */
export function autoGain(measuredDb: number | null, layer: Layer): number {
	if (measuredDb === null || !Number.isFinite(measuredDb) || measuredDb < -80) return 0;
	const gain = Math.min(18, Math.max(-24, LEVEL_TARGETS_DB[layer] - measuredDb));
	return Math.round(gain * 2) / 2;
}

export const dbToGain = (db: number) => Math.pow(10, db / 20);

export interface AudioChunk {
	/** Source seconds in the take. */
	from: number;
	to: number;
	/** Playback rate over the chunk (1 = real time). */
	rate: number;
	/** Above MAX_STRETCH the take's sound is muted for this chunk, keeping its length. */
	mute: boolean;
}

/**
 * The entry's kept span as audio chunks: flat entries are one chunk; a ramp
 * is cut into ~quarter-second program pieces, each played at its mean rate.
 */
export function rampChunks(entry: { in_s: number; out_s: number; speed?: SpeedPoint[] }, step = 0.25): AudioChunk[] {
	const span = entry.out_s - entry.in_s;
	if (isFlat(entry.speed)) return [{ from: entry.in_s, to: entry.out_s, rate: 1, mute: false }];
	const played = programElapsed(entry.speed, span);
	const pieces = Math.max(1, Math.round(played / step));
	const chunks: AudioChunk[] = [];
	for (let i = 0; i < pieces; i++) {
		const a = fractionAtProgram(entry.speed, span, (i / pieces) * played);
		const b = fractionAtProgram(entry.speed, span, ((i + 1) / pieces) * played);
		const programLength = played / pieces;
		const rate = Math.max(1, ((b - a) * span) / programLength || rateAt(entry.speed, (a + b) / 2));
		chunks.push({ from: entry.in_s + a * span, to: entry.in_s + b * span, rate: Math.round(rate * 1000) / 1000, mute: rate > MAX_STRETCH + 1e-6 });
	}
	return chunks;
}

/** A cut that chops a loud sound: ring it out into the next clip (from the take's own footage), with a longer fade. */
export function tailRepair(edgeDb: number | null, availableAfter: number, averageDb: number | null = null): { extend_s: number; fade_s: number } {
	const loud = edgeDb !== null && edgeDb >= CUTOFF_DB && (averageDb === null || edgeDb >= averageDb + CUTOFF_ABOVE_AVERAGE_DB);
	if (!loud || availableAfter < 0.02) return { extend_s: 0, fade_s: 0 };
	const extend = Math.min(RING_OUT_S, availableAfter);
	return { extend_s: Math.round(extend * 1000) / 1000, fade_s: Math.round(extend * 1000) / 1000 };
}

/**
 * Where the music ducks: the take layer is loud (a hit, a line of dialogue)
 * or an effect plays. `activityDb` is the take layer's level per 1/hz s of
 * the cut. Regions are padded by attack/release and merged across short gaps.
 */
export function duckRegions(activityDb: number[], hz: number, thresholdDb: number, effects: Array<{ at_s: number; length_s: number }> = [], attack = 0.05, release = 0.3, gap = 0.2): Array<[number, number]> {
	const raw: Array<[number, number]> = [];
	for (let f = 0; f < activityDb.length; ) {
		if (activityDb[f] < thresholdDb) { f++; continue; }
		let end = f;
		while (end + 1 < activityDb.length && activityDb[end + 1] >= thresholdDb) end++;
		raw.push([f / hz, (end + 1) / hz]);
		f = end + 1;
	}
	for (const effect of effects) raw.push([effect.at_s, effect.at_s + Math.min(1.5, effect.length_s)]);
	const padded = raw.map(([a, b]) => [Math.max(0, a - attack), b + release] as [number, number]).sort((x, y) => x[0] - y[0]);
	const merged: Array<[number, number]> = [];
	for (const region of padded) {
		const last = merged.at(-1);
		if (last && region[0] - last[1] <= gap) last[1] = Math.max(last[1], region[1]);
		else merged.push([...region]);
	}
	return merged.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]);
}

/** The music gain over time as an ffmpeg volume expression: duck_db inside the regions, 0 dB outside. */
export function duckVolumeExpression(regions: Array<[number, number]>, duckDb: number): string {
	if (!regions.length || duckDb >= 0) return '1';
	const inside = regions.map(([a, b]) => `between(t\\,${a}\\,${b})`).join('+');
	return `if(gt(${inside}\\,0)\\,${dbToGain(duckDb).toFixed(4)}\\,1)`;
}

/** Overlap at each music join, seconds (a short crossfade, so a loop never clicks). */
export const MUSIC_JOIN_S = 0.3;
const MUSIC_END_FADE_S = 2;

/** One placed piece of the song: source seconds [from, to] starting at at_s in the cut. */
export interface MusicPiece { from: number; to: number; at_s: number; gain_db: number; fade_in: number; fade_out: number }

/** The nearest bar start (every 4th beat) to t, or t itself without beats. */
function snapToBar(t: number, beats: number[] | undefined): number {
	const bars = (beats ?? []).filter((_, i) => i % 4 === 0);
	if (bars.length < 2) return t;
	return bars.reduce((best, b) => (Math.abs(b - t) < Math.abs(best - t) || (Math.abs(b - t) === Math.abs(best - t) && b > best) ? b : best), bars[0]);
}

/**
 * How the song runs under the whole cut (Robert's rule: the song never restarts
 * from the top, never stops and starts, and shots are never trimmed to fit it).
 * A song at least as long as the cut plays once and fades out at the end. A
 * shorter song plays its head once, then repeats its loop bars quietly (bed_db)
 * for as long as the picture needs, and its own ending lands on the last frame.
 * The loop is snapped to whole bars when the song has a beat grid; without a
 * valid chosen loop the middle half of the song loops.
 */
export function musicFlow(input: { song_s: number; cut_s: number; beats?: number[]; flow?: { loop_from_s: number; loop_to_s: number; bed_db: number } }): { pieces: MusicPiece[]; loop: [number, number] | null; loops: number } {
	const { song_s, cut_s } = input;
	const J = MUSIC_JOIN_S;
	if (cut_s <= song_s) return { pieces: [{ from: 0, to: cut_s, at_s: 0, gain_db: 0, fade_in: 0, fade_out: Math.min(MUSIC_END_FADE_S, cut_s / 4) }], loop: null, loops: 0 };
	const chosen = input.flow;
	const valid = chosen && chosen.loop_from_s > J && chosen.loop_to_s < song_s - J && chosen.loop_to_s - chosen.loop_from_s >= 2;
	let from = snapToBar(valid ? chosen.loop_from_s : song_s / 4, input.beats);
	let to = snapToBar(valid ? chosen.loop_to_s : (song_s * 3) / 4, input.beats);
	if (!(from > J && to < song_s - J && to - from >= 2)) { from = valid ? chosen.loop_from_s : song_s / 4; to = valid ? chosen.loop_to_s : (song_s * 3) / 4; }
	const bed = chosen?.bed_db ?? -6;
	const S = to - from;
	const outroAt = cut_s - (song_s - to);
	// The head ends at `to`; loops fill [to, outroAt]; each piece overlaps the next by J (half before, half after).
	const pieces: MusicPiece[] = [{ from: 0, to: to + J / 2, at_s: 0, gain_db: 0, fade_in: 0, fade_out: J }];
	for (let at = to; at < outroAt - 1e-6; at += S) {
		const len = Math.min(S, outroAt - at);
		pieces.push({ from: from - J / 2, to: from + len + J / 2, at_s: at - J / 2, gain_db: bed, fade_in: J, fade_out: J });
	}
	pieces.push({ from: to - J / 2, to: song_s, at_s: outroAt - J / 2, gain_db: 0, fade_in: J, fade_out: 0 });
	const r = (x: number) => Math.round(x * 1000) / 1000;
	return { pieces: pieces.map((p) => ({ ...p, from: r(p.from), to: r(p.to), at_s: r(p.at_s) })), loop: [r(from), r(to)], loops: pieces.length - 2 };
}

/** Where in the song the cut is at program time t, through the flow's pieces (the latest piece started by t). */
export function songTimeAt(pieces: MusicPiece[] | undefined, t: number): number | null {
	if (!pieces?.length) return t;
	const piece = pieces.filter((p) => p.at_s <= t + 1e-6).at(-1);
	if (!piece) return null;
	const at = piece.from + (t - piece.at_s);
	return at <= piece.to ? at : null;
}

export interface MixEntry {
	/** Local file, or null when the take has no audio. */
	file: string | null;
	in_s: number;
	out_s: number;
	speed?: SpeedPoint[];
	/** Where it starts in the cut (program seconds). */
	at_s: number;
	/** Footage before the in-point and after the out-point (handles for crossfades and ring-outs). */
	before_s: number;
	after_s: number;
	/** Level just before the out-point, and the take's average over its kept span (for cut-off repair). */
	edge_db: number | null;
	average_db?: number | null;
}

export interface MixInput {
	length_s: number;
	entries: MixEntry[];
	/** The song, and how it is laid under the cut (musicFlow); without pieces it plays once from the cut start. */
	music: { file: string; pieces?: MusicPiece[] } | null;
	ambience: { file: string } | null;
	effects: Array<{ file: string; at_s: number; from_s?: number; gain_db: number }>;
	/** Auto gains (dB) per layer, added to the plan's own gains. */
	auto: Record<Layer, number>;
	plan: SoundPlan;
	duck: Array<[number, number]>;
	output: string;
}

/**
 * The ffmpeg arguments for the mix (a render plan: pure, executed by a thin
 * runner). Every take segment is placed at its cut position with a short
 * handle and faded in and out over the crossfade, so neighbours overlap into
 * crossfades; loud cut-offs ring out; ramps stretch ≤1.5× and mute above;
 * music ducks; the sum is limited.
 */
export function mixPlan(input: MixInput): { args: string[]; report: string[] } {
	const args = ['-y', '-v', 'error'];
	const filters: string[] = [];
	const report: string[] = [];
	const fmt = 'aformat=sample_rates=48000:channel_layouts=stereo';
	const { plan } = input;
	const xf = plan.crossfade_s;
	let inputs = 0;
	const addInput = (file: string, loop = false) => { if (loop) args.push('-stream_loop', '-1'); args.push('-i', file); return inputs++; };
	const layerGain = (layer: Layer) => input.auto[layer] + plan.layers[layer].gain_db;
	const mixLabels: string[] = [];
	// Every placed piece runs the whole cut: amix (duration=longest) can end with its first input when the
	// others start later, so a mix came out cut short at the first entry (found by the QC report, V1S-505).
	const pad = `apad=whole_dur=${input.length_s.toFixed(3)}`;

	// Take audio.
	if (!plan.layers.take.mute) {
		const placed: string[] = [];
		input.entries.forEach((entry, e) => {
			if (!entry.file) return;
			const k = addInput(entry.file);
			const head = Math.min(xf / 2, entry.before_s);
			// The last entry ends the cut: nothing to ring out into.
			const repair = e === input.entries.length - 1 ? { extend_s: 0, fade_s: 0 } : tailRepair(entry.edge_db, entry.after_s, entry.average_db ?? null);
			const tail = Math.max(Math.min(xf / 2, entry.after_s), repair.extend_s);
			const chunks = rampChunks(entry);
			if (head > 0) chunks[0] = { ...chunks[0], from: chunks[0].from - head };
			if (tail > 0) chunks[chunks.length - 1] = { ...chunks[chunks.length - 1], to: chunks[chunks.length - 1].to + tail };
			const labels = chunks.map((chunk, c) => {
				const label = `t${e}c${c}`;
				filters.push(`[${k}:a]atrim=start=${chunk.from.toFixed(3)}:end=${chunk.to.toFixed(3)},asetpts=PTS-STARTPTS,${fmt}${chunk.rate !== 1 ? `,atempo=${chunk.rate}` : ''}${chunk.mute ? ',volume=0' : ''}[${label}]`);
				return `[${label}]`;
			});
			const length = chunks.reduce((sum, chunk) => sum + (chunk.to - chunk.from) / chunk.rate, 0);
			const fadeOut = Math.max(xf, repair.fade_s);
			const delay = Math.max(0, Math.round((entry.at_s - head) * 1000));
			filters.push(`${labels.join('')}concat=n=${labels.length}:v=0:a=1,afade=t=in:st=0:d=${Math.max(0.005, xf).toFixed(3)},afade=t=out:st=${Math.max(0, length - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)},adelay=delays=${delay}:all=1,${pad}[take${e}]`);
			placed.push(`[take${e}]`);
			if (repair.extend_s) report.push(`Entry ${e + 1}: a sound was cut off mid-hit; it now rings out ${repair.extend_s}s into the next clip.`);
			const muted = chunks.filter((chunk) => chunk.mute).length;
			if (muted) report.push(`Entry ${e + 1}: ${muted} ramped piece${muted === 1 ? '' : 's'} above ${MAX_STRETCH}× muted; the rest time-stretched.`);
			else if (chunks.some((chunk) => chunk.rate > 1)) report.push(`Entry ${e + 1}: ramp time-stretched (≤ ${MAX_STRETCH}×).`);
		});
		if (placed.length) {
			filters.push(`${placed.join('')}amix=inputs=${placed.length}:normalize=0:duration=longest,volume=${layerGain('take').toFixed(1)}dB[take]`);
			mixLabels.push('[take]');
		}
		const silent = input.entries.filter((entry) => !entry.file).length;
		if (silent) report.push(`${silent} entr${silent === 1 ? 'y has' : 'ies have'} no audio of their own.`);
	}

	// Ambience bed, looped under the whole cut.
	if (input.ambience && !plan.layers.ambience.mute) {
		const k = addInput(input.ambience.file, true);
		filters.push(`[${k}:a]atrim=0:${input.length_s.toFixed(3)},asetpts=PTS-STARTPTS,${fmt},volume=${layerGain('ambience').toFixed(1)}dB,afade=t=in:d=0.5,afade=t=out:st=${Math.max(0, input.length_s - 0.5).toFixed(3)}:d=0.5[amb]`);
		mixLabels.push('[amb]');
	}

	// Music, ducked under hits, dialogue and effects.
	if (input.music && !plan.layers.music.mute) {
		const k = addInput(input.music.file);
		const pieces = input.music.pieces ?? [];
		if (pieces.length > 1) {
			// The song's head once, quiet loop bars, its own ending on the last frame: each piece placed and crossfaded.
			filters.push(`[${k}:a]${fmt},asplit=${pieces.length}${pieces.map((_, i) => `[ms${i}]`).join('')}`);
			pieces.forEach((piece, i) => {
				const len = piece.to - piece.from;
				const fades = [piece.fade_in > 0 ? `afade=t=in:st=0:d=${piece.fade_in.toFixed(3)}` : '', piece.fade_out > 0 ? `afade=t=out:st=${Math.max(0, len - piece.fade_out).toFixed(3)}:d=${piece.fade_out.toFixed(3)}` : ''].filter(Boolean);
				filters.push(`[ms${i}]atrim=start=${Math.max(0, piece.from).toFixed(3)}:end=${piece.to.toFixed(3)},asetpts=PTS-STARTPTS,${[...fades, `volume=${piece.gain_db.toFixed(1)}dB`].join(',')},adelay=delays=${Math.max(0, Math.round(piece.at_s * 1000))}:all=1,${pad}[mp${i}]`);
			});
			filters.push(`${pieces.map((_, i) => `[mp${i}]`).join('')}amix=inputs=${pieces.length}:normalize=0:duration=longest,atrim=0:${input.length_s.toFixed(3)},volume=${layerGain('music').toFixed(1)}dB,volume='${duckVolumeExpression(input.duck, plan.duck_db)}':eval=frame[music]`);
			report.push(`The song plays from the top once, its loop bars repeat ${pieces.length - 2}× quietly (${pieces[1].gain_db} dB) and its own ending lands on the last frame.`);
		} else {
			const end = pieces[0]?.fade_out ? `,afade=t=out:st=${Math.max(0, input.length_s - pieces[0].fade_out).toFixed(3)}:d=${pieces[0].fade_out.toFixed(3)}` : '';
			filters.push(`[${k}:a]atrim=0:${input.length_s.toFixed(3)},asetpts=PTS-STARTPTS,${fmt}${end},volume=${layerGain('music').toFixed(1)}dB,volume='${duckVolumeExpression(input.duck, plan.duck_db)}':eval=frame[music]`);
		}
		mixLabels.push('[music]');
		if (input.duck.length) report.push(`Music ducks ${plan.duck_db} dB in ${input.duck.length} place${input.duck.length === 1 ? '' : 's'}.`);
	}

	// Added effects.
	if (input.effects.length && !plan.layers.effects.mute) {
		const placed = input.effects.map((effect, i) => {
			const k = addInput(effect.file);
			filters.push(`[${k}:a]${effect.from_s ? `atrim=start=${effect.from_s.toFixed(3)},` : ''}asetpts=PTS-STARTPTS,${fmt},volume=${effect.gain_db.toFixed(1)}dB,adelay=delays=${Math.round(effect.at_s * 1000)}:all=1,${pad}[fx${i}]`);
			return `[fx${i}]`;
		});
		filters.push(`${placed.join('')}amix=inputs=${placed.length}:normalize=0:duration=longest,volume=${layerGain('effects').toFixed(1)}dB[fx]`);
		mixLabels.push('[fx]');
	}

	if (!mixLabels.length) {
		args.push('-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${input.length_s.toFixed(3)}`);
		filters.push(`[${inputs}:a]anull[mix]`);
	} else {
		filters.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:normalize=0:duration=longest,atrim=0:${input.length_s.toFixed(3)},alimiter=limit=${dbToGain(plan.limiter_db).toFixed(4)}:level=false[mix]`);
	}
	args.push('-filter_complex', filters.join(';'), '-map', '[mix]', '-c:a', 'aac', '-b:a', '192k', '-t', input.length_s.toFixed(3), input.output);
	return { args, report };
}

/** RMS level in dBFS of samples between two times (null when there's nothing there). */
export function rmsDb(samples: Float32Array, rate: number, from = 0, to = samples.length / rate): number | null {
	const a = Math.max(0, Math.floor(from * rate));
	const b = Math.min(samples.length, Math.ceil(to * rate));
	if (b - a < 1) return null;
	let sum = 0;
	for (let i = a; i < b; i++) sum += samples[i] * samples[i];
	return 10 * Math.log10(1e-12 + sum / (b - a));
}

/** Level per 1/hz s (dBFS) of an entry's audio as it plays in the cut, laid onto a cut-length track (louder wins). */
export function layLevels(track: number[], hz: number, samples: Float32Array, rate: number, entry: { in_s: number; out_s: number; speed?: SpeedPoint[]; at_s: number }): void {
	let cursor = entry.at_s;
	for (const chunk of rampChunks(entry)) {
		const played = (chunk.to - chunk.from) / chunk.rate;
		for (let t = 0; t < played; t += 1 / hz) {
			const f = Math.floor((cursor + t) * hz);
			if (f < 0 || f >= track.length || chunk.mute) continue;
			const src = chunk.from + t * chunk.rate;
			track[f] = Math.max(track[f], rmsDb(samples, rate, src, src + 1 / hz) ?? -120);
		}
		cursor += played;
	}
}
