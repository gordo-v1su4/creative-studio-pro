/**
 * QC report (V1S-505): the automatic quality check of a rendered cut. Five
 * checks, each pass / warn / fail with timecodes: picture (a contact sheet),
 * sound present (gaps, loudness), song sync, lip sync / dialogue, length.
 * A cut isn't done until its QC report passes. This file is the pure part:
 * parsing ffmpeg's measurements, the cross-correlation, and the verdicts.
 */

export type QcStatus = 'pass' | 'warn' | 'fail';
export type QcCheckId = 'picture' | 'sound' | 'song' | 'lip_sync' | 'length';

export interface QcItem {
	status: QcStatus;
	/** Where in the cut, seconds. */
	at_s?: number;
	message: string;
}

export interface QcCheck {
	id: QcCheckId;
	label: string;
	status: QcStatus;
	summary: string;
	items: QcItem[];
}

export interface QcReport {
	at: string;
	/** The checked MP4 (a project file URL, or a path for a file outside the project). */
	file: string;
	status: QcStatus;
	duration_s: number;
	/** The contact sheet beside the export (URL), when it could be made. */
	sheet?: string;
	checks: QcCheck[];
}

/** One cut entry as the QC sees it: where its picture sits in the render and what its take sounds like. */
export interface QcEntry {
	title: string;
	/** Picture start in the render (whole export frames). */
	at_s: number;
	/** Picture length in the render. */
	length_s: number;
	/** Where the plan (the EDL: unrounded played lengths) puts it. */
	planned_at_s: number;
	/** The take's own audio, when it has a file: the in-point the picture starts at. */
	take?: { file: string; in_s: number } | null;
	/** A speed ramp: the take audio is retimed, so its offset can't be read against the take. */
	ramped: boolean;
	/** The shot's written dialogue, when it has any. */
	dialogue?: string;
}

/** Gaps in sound longer than this (seconds) below SILENCE_DB are listed. */
export const SILENCE_MIN_S = 0.6;
export const SILENCE_DB = -45;
/** Audio more than this far off its picture is out of sync (seconds). */
export const LIP_SYNC_S = 0.04;
/** How far the correlation looks either side of where the sound should be (seconds). */
export const SEARCH_S = 0.25;

const RANK: Record<QcStatus, number> = { pass: 0, warn: 1, fail: 2 };
export const worst = (statuses: QcStatus[]): QcStatus => statuses.reduce<QcStatus>((w, s) => (RANK[s] > RANK[w] ? s : w), 'pass');

/** 78.18 → "1:18.18" (minutes, seconds, hundredths). */
export function timecode(seconds: number): string {
	const s = Math.max(0, seconds);
	const m = Math.floor(s / 60);
	const rest = s - m * 60;
	return `${m}:${rest.toFixed(2).padStart(5, '0')}`;
}

const ms = (seconds: number) => `${seconds >= 0 ? '+' : '−'}${Math.round(Math.abs(seconds) * 1000)} ms`;

/** silencedetect's stderr → the silent spans it found. An unterminated silence runs to the end. */
export function parseSilences(stderr: string, duration_s: number): Array<{ start: number; end: number }> {
	const out: Array<{ start: number; end: number }> = [];
	let open: number | null = null;
	for (const line of stderr.split(/\r?\n/)) {
		const start = /silence_start:\s*(-?[\d.]+)/.exec(line);
		if (start) { open = Math.max(0, Number(start[1])); continue; }
		const end = /silence_end:\s*([\d.]+)/.exec(line);
		if (end && open !== null) { out.push({ start: open, end: Number(end[1]) }); open = null; }
	}
	if (open !== null) out.push({ start: open, end: duration_s });
	return out;
}

/** ebur128's summary (with peak=true) → integrated loudness (LUFS) and true peak (dBTP). */
export function parseLoudness(stderr: string): { lufs: number | null; peak_db: number | null } {
	const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
	const num = (re: RegExp) => { const m = re.exec(summary); const v = m ? Number(m[1]) : NaN; return Number.isFinite(v) ? v : null; };
	return { lufs: num(/I:\s*(-?[\d.]+|-inf)\s*LUFS/), peak_db: num(/True peak:\s*Peak:\s*(-?[\d.]+|-inf)\s*dBFS/) };
}

/**
 * Where `needle` sits in `hay` (normalised cross-correlation, the needle's mean removed),
 * as an offset in samples from `hay`'s start, and how alike they are there (0..1).
 */
export function bestOffset(hay: Float32Array, needle: Float32Array): { offset: number; score: number } {
	const n = needle.length;
	if (n === 0 || hay.length < n) return { offset: 0, score: 0 };
	let mean = 0;
	for (let i = 0; i < n; i++) mean += needle[i];
	mean /= n;
	const ref = new Float32Array(n);
	let refNorm = 0;
	for (let i = 0; i < n; i++) { ref[i] = needle[i] - mean; refNorm += ref[i] * ref[i]; }
	refNorm = Math.sqrt(refNorm);
	if (refNorm < 1e-9) return { offset: 0, score: 0 };
	let energy = 0;
	for (let i = 0; i < n; i++) energy += hay[i] * hay[i];
	let best = { offset: 0, score: 0 };
	for (let k = 0; k + n <= hay.length; k++) {
		if (k > 0) energy += hay[k + n - 1] * hay[k + n - 1] - hay[k - 1] * hay[k - 1];
		let dot = 0;
		for (let i = 0; i < n; i++) dot += hay[k + i] * ref[i];
		const score = Math.abs(dot) / (Math.sqrt(Math.max(energy, 1e-20)) * refNorm);
		if (score > best.score) best = { offset: k, score };
	}
	return best;
}

/** RMS level of a stretch of PCM, dBFS (−120 for silence). */
export function levelDb(pcm: Float32Array, from = 0, to = pcm.length): number {
	let sum = 0;
	const a = Math.max(0, from), b = Math.min(pcm.length, to);
	for (let i = a; i < b; i++) sum += pcm[i] * pcm[i];
	return b > a && sum > 0 ? Math.max(-120, 10 * Math.log10(sum / (b - a))) : -120;
}

/** The loudest `window` seconds of a take between `from` and `to` (seconds in the take), stepping by a tenth. */
export function loudestWindow(pcm: Float32Array, rate: number, from: number, to: number, window: number): { start: number; db: number } {
	const span = Math.max(0, to - from);
	const w = Math.min(window, span);
	let best = { start: from, db: -120 };
	for (let t = from; t + w <= to + 1e-9; t += 0.1) {
		const db = levelDb(pcm, Math.round(t * rate), Math.round((t + w) * rate));
		if (db > best.db) best = { start: t, db };
	}
	return best;
}

/** Match scores (normalised correlation): over SURE is a clear find even under louder sound (chance is about 1/sqrt(samples), ~0.01 here); under UNSURE it is not found. */
export const SURE = 0.3;
export const UNSURE = 0.15;

/** Verdict for one measured offset of sound against its picture. */
export function offsetItem(input: { title: string; at_s: number; offset_s: number; score: number; limit_s: number; strict: boolean; what: string }): QcItem {
	const { title, at_s, offset_s, score, limit_s, strict, what } = input;
	if (score < UNSURE) return { status: 'warn', at_s, message: `${title}: ${what} not found in the cut (match ${score.toFixed(2)})` };
	const off = Math.abs(offset_s) > limit_s;
	const sure = score >= SURE ? '' : ` · weak match ${score.toFixed(2)}`;
	if (!off) return { status: score >= SURE ? 'pass' : 'warn', at_s, message: `${title}: ${what} ${ms(offset_s)}${sure}` };
	return { status: strict && score >= SURE ? 'fail' : 'warn', at_s, message: `${title}: ${what} ${ms(offset_s)} (${offset_s > 0 ? 'late' : 'early'}, over ${Math.round(limit_s * 1000)} ms)${sure}` };
}

/** Check 2: sound present — gaps and loudness. */
export function soundCheck(input: { has_audio: boolean; duration_s: number; silences: Array<{ start: number; end: number }>; lufs: number | null; peak_db: number | null }): QcCheck {
	const items: QcItem[] = [];
	if (!input.has_audio) return { id: 'sound', label: 'Sound present', status: 'fail', summary: 'The render has no audio track', items: [{ status: 'fail', at_s: 0, message: 'No audio track' }] };
	const gaps = input.silences.filter((s) => s.end - s.start > SILENCE_MIN_S);
	const silent = gaps.reduce((sum, s) => sum + (s.end - s.start), 0);
	if (input.duration_s > 0 && silent >= input.duration_s * 0.9) items.push({ status: 'fail', at_s: 0, message: 'The whole cut is silent' });
	else for (const gap of gaps) items.push({ status: 'warn', at_s: gap.start, message: `Silence ${timecode(gap.start)}–${timecode(gap.end)} (${(gap.end - gap.start).toFixed(2)} s under ${SILENCE_DB} dB)` });
	if (input.lufs === null) items.push({ status: 'warn', message: 'Loudness could not be measured' });
	else if (input.lufs < -24 || input.lufs > -9) items.push({ status: 'warn', message: `Integrated loudness ${input.lufs.toFixed(1)} LUFS (outside −24…−9)` });
	if (input.peak_db !== null && input.peak_db > -0.5) items.push({ status: 'warn', message: `True peak ${input.peak_db.toFixed(1)} dBTP (over −0.5)` });
	const loud = `${input.lufs === null ? '?' : input.lufs.toFixed(1)} LUFS, peak ${input.peak_db === null ? '?' : input.peak_db.toFixed(1)} dBTP`;
	const status = worst(items.map((i) => i.status));
	return { id: 'sound', label: 'Sound present', status, summary: `${loud}; ${gaps.length ? `${gaps.length} gap${gaps.length === 1 ? '' : 's'} over ${SILENCE_MIN_S} s` : 'no gaps'}`, items };
}

/** Check 5: length — the render matches the plan within one frame; audio and picture end together. */
export function lengthCheck(input: { video_s: number | null; audio_s: number | null; planned_s: number | null; fps: number }): QcCheck {
	const frame = 1 / input.fps;
	const items: QcItem[] = [];
	if (input.video_s === null) items.push({ status: 'fail', message: 'The render has no picture length' });
	else if (input.planned_s !== null) {
		const diff = input.video_s - input.planned_s;
		items.push({ status: Math.abs(diff) <= frame + 1e-6 ? 'pass' : 'fail', at_s: input.video_s, message: `Picture ${input.video_s.toFixed(3)} s against the plan's ${input.planned_s.toFixed(3)} s (${Math.round(diff * input.fps)} frames)` });
	} else items.push({ status: 'pass', at_s: input.video_s, message: `Picture ${input.video_s.toFixed(3)} s (no plan to compare)` });
	if (input.video_s !== null && input.audio_s !== null && Math.abs(input.audio_s - input.video_s) > frame + 1e-6)
		items.push({ status: 'warn', at_s: Math.min(input.audio_s, input.video_s), message: `Sound ends ${ms(input.audio_s - input.video_s)} from the picture` });
	const status = worst(items.map((i) => i.status));
	return { id: 'length', label: 'Length', status, summary: input.video_s === null ? 'No picture' : `${input.video_s.toFixed(2)} s${input.planned_s !== null ? ` · plan ${input.planned_s.toFixed(2)} s` : ''}`, items };
}

/** Words of a line, lower case, no punctuation. */
const words = (text: string) => text.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1);

/** How much of the written line was heard (0..1): the share of its words found in the transcript. */
export function dialogueMatch(written: string, heard: string): number {
	const want = words(written);
	if (!want.length) return 1;
	const got = new Set(words(heard));
	return want.filter((w) => got.has(w)).length / want.length;
}

/** The overall verdict and a one-line summary, e.g. "QC PASS · 5 checks" or "QC FAIL · lip sync, length". */
export function finishReport(input: Omit<QcReport, 'status'>): QcReport {
	return { ...input, status: worst(input.checks.map((c) => c.status)) };
}

export function qcHeadline(report: Pick<QcReport, 'status' | 'checks'>): string {
	const bad = report.checks.filter((c) => c.status !== 'pass');
	return `QC ${report.status.toUpperCase()}${bad.length ? ` · ${bad.map((c) => `${c.label.toLowerCase()} ${c.status}`).join(', ')}` : ` · ${report.checks.length} checks`}`;
}

/** The report as plain text for Review Room's notes: the headline, then each check, then what isn't a pass. */
export function qcNotes(report: QcReport, maxItems = 12): string {
	const lines = [qcHeadline(report), ...report.checks.map((c) => `${c.status.toUpperCase()} ${c.label}: ${c.summary}`)];
	const issues = report.checks.flatMap((c) => c.items.filter((i) => i.status !== 'pass').map((i) => `${i.status === 'fail' ? '✗' : '!'} ${i.at_s !== undefined ? `${timecode(i.at_s)} ` : ''}${i.message}`));
	return [...lines, ...issues.slice(0, maxItems), ...(issues.length > maxItems ? [`… ${issues.length - maxItems} more in the app`] : [])].join('\n');
}
