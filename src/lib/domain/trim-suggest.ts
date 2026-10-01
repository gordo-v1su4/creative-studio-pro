/**
 * Suggest trims (V1S-123): find frozen frames, stutter, bad starts and single
 * stray frames in a take's kept span, measured in code from its frame
 * differences, and propose new in/out points. Pure: a frame signal in,
 * suggestions out. Nothing here changes a trim; the operator accepts or
 * dismisses each suggestion.
 *
 * Frame k covers [k / fps, (k + 1) / fps). diffs[k] is the mean absolute
 * difference between frames k and k + 1, skips[k] between frames k and k + 2,
 * both 0..1 (0 = identical, 1 = black to white).
 */

export interface FrameSignal {
	fps: number;
	diffs: number[];
	skips: number[];
}

export type TrimSuggestionKind = 'freeze' | 'stutter' | 'bad_start' | 'stray_frame';

export interface TrimSuggestion {
	kind: TrimSuggestionKind;
	/** Which edge of the trim moves. */
	edge: 'in' | 'out';
	/** The proposed in- or out-point, in take seconds. */
	at_s: number;
	/** The frames found, first and last (inclusive). */
	frames: [number, number];
	note: string;
}

/**
 * Below this a frame repeats its neighbour. A decoded repeat is near-identical
 * (≈ 0.0002); a slow, near-still shot still moves about 0.0005–0.003, so keep under it.
 */
const STILL = 0.0008;
/** A hard change (a cut or a flash, not motion): big, and several times its neighbours two frames away. */
const SPIKE_MIN = 0.08;
const SPIKE_X_MEDIAN = 5;
const SPIKE_X_LOCAL = 2.5;
/** A freeze must last this long to be worth trimming. */
const FREEZE_S = 0.25;
/** Where a bad start or a stray frame counts as "at the edge". */
const EDGE_S = 0.5;
/** Stutter: a window where repeated frames and moving frames alternate. */
const STUTTER_WINDOW = 12;
const STUTTER_SHARE = 0.34;
const MIN_SPAN_S = 0.2;

const median = (values: number[]) => {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
};

const r3 = (seconds: number) => Math.round(seconds * 1000) / 1000;

/** The suggestions for one take's kept span [in_s, out_s), soonest first. */
export function suggestTrims(signal: FrameSignal, trim: { in_s: number; out_s: number }): TrimSuggestion[] {
	const { fps, diffs } = signal;
	const frameCount = diffs.length + 1;
	if (fps <= 0 || frameCount < 3) return [];
	const first = Math.max(0, Math.ceil(trim.in_s * fps - 1e-6));
	const last = Math.min(frameCount - 1, Math.ceil(trim.out_s * fps - 1e-6) - 1);
	if (last - first < 2) return [];

	// Thresholds relative to this take's own motion inside the kept span.
	const kept = diffs.slice(first, last);
	// A repeat is a frame that barely changes against this take's own pace: a locked-off,
	// near-still take (typical change ≈ 0.0007) isn't frozen, it's just still.
	const typical = [...kept].sort((a, b) => a - b)[Math.floor(kept.length * 0.75)] ?? 0;
	const stillCut = Math.min(STILL, typical * 0.15);
	const still = (k: number) => diffs[k] !== undefined && diffs[k] < stillCut;
	const motion = median(kept.filter((d) => d >= stillCut));
	const spike = Math.max(SPIKE_MIN, motion * SPIKE_X_MEDIAN);
	// Fast motion (a whip, a fall) moves a lot every frame; a cut or a flash jumps against its neighbours.
	const hard = (k: number) => diffs[k] !== undefined && diffs[k] > spike && diffs[k] > SPIKE_X_LOCAL * Math.max(diffs[k - 2] ?? 0, diffs[k + 2] ?? 0);
	const edgeFrames = Math.max(3, Math.round(EDGE_S * fps));
	const freezeFrames = Math.max(4, Math.round(FREEZE_S * fps));
	const at = (frame: number) => r3(frame / fps);
	const out: TrimSuggestion[] = [];

	// Single stray frames: a frame that jumps away from both neighbours (a one-frame flash or scene).
	const strays = new Set<number>();
	for (let k = first; k <= last; k++) {
		// Inside the span: a jump into the frame and a jump out of it. At an edge only the inside
		// neighbour is kept, so it's the jump on that side, with the shot carrying on smoothly after it.
		const lone = k === first ? hard(k) && !hard(k + 1)
			: k === last ? hard(k - 1) && !hard(k - 2)
			: hard(k - 1) && hard(k);
		if (!lone) continue;
		const fromIn = k - first;
		const fromOut = last - k;
		if (Math.min(fromIn, fromOut) > edgeFrames) continue;
		strays.add(k);
		if (fromIn <= fromOut) out.push({ kind: 'stray_frame', edge: 'in', at_s: at(k + 1), frames: [k, k], note: `One stray frame ${fromIn === 0 ? 'at the in-point' : `${fromIn} frame${fromIn === 1 ? '' : 's'} in`}` });
		else out.push({ kind: 'stray_frame', edge: 'out', at_s: at(k), frames: [k, k], note: `One stray frame ${fromOut === 0 ? 'at the out-point' : `${fromOut} frame${fromOut === 1 ? '' : 's'} before the out-point`}` });
	}

	// Bad start: a hard change (a cut into another shot) soon after the in-point, not already a stray frame.
	for (let k = first; k < Math.min(last, first + edgeFrames); k++) {
		if (!hard(k) || strays.has(k) || strays.has(k + 1)) continue;
		out.push({ kind: 'bad_start', edge: 'in', at_s: at(k + 1), frames: [first, k], note: `Hard change ${k - first + 1} frame${k - first ? 's' : ''} in: starts on the wrong shot` });
		break;
	}

	// Freezes: runs of repeated frames.
	for (let k = first; k < last; ) {
		if (!still(k)) { k++; continue; }
		let end = k;
		while (end + 1 < last && still(end + 1)) end++;
		const length = end - k + 2; // frames k..end+1 are the same picture
		if (length >= freezeFrames) {
			const seconds = (length / fps).toFixed(2);
			if (k === first) out.push({ kind: 'freeze', edge: 'in', at_s: at(end + 1), frames: [k, end + 1], note: `Frozen for ${seconds}s at the start` });
			else if (end + 1 >= last) out.push({ kind: 'freeze', edge: 'out', at_s: at(k + 1), frames: [k, end + 1], note: `Frozen for ${seconds}s at the end` });
			else if (k - first > last - end) out.push({ kind: 'freeze', edge: 'out', at_s: at(k + 1), frames: [k, end + 1], note: `Frozen for ${seconds}s at ${at(k)}s; end before it` });
			else out.push({ kind: 'freeze', edge: 'in', at_s: at(end + 1), frames: [k, end + 1], note: `Frozen for ${seconds}s at ${at(k)}s; start after it` });
		}
		k = end + 1;
	}

	// Stutter: repeated frames mixed into motion (dropped or doubled frames), outside any freeze.
	const frozen = (k: number) => out.some((s) => s.kind === 'freeze' && k >= s.frames[0] && k <= s.frames[1]);
	for (let k = first; k + STUTTER_WINDOW <= last; ) {
		const window = Array.from({ length: STUTTER_WINDOW }, (_, i) => k + i);
		const repeats = window.filter((i) => still(i)).length;
		// The frames in between move at the take's normal pace; a near-still shot's jitter isn't stutter.
		const moving = window.filter((i) => diffs[i] >= Math.max(stillCut * 3, motion * 0.5)).length;
		const alternating = window.filter((i, j) => j > 0 && still(i) !== still(window[j - 1])).length;
		if (repeats / STUTTER_WINDOW >= STUTTER_SHARE && moving / STUTTER_WINDOW >= STUTTER_SHARE && alternating >= STUTTER_WINDOW / 3 && !window.some(frozen)) {
			k = window.find((i) => still(i))!; // the stutter starts at its first repeated frame
			let end = k + STUTTER_WINDOW - 1;
			while (end + 2 <= last && (still(end + 1) || still(end + 2))) end++;
			const middle = (k + end) / 2;
			if (middle - first < last - middle) out.push({ kind: 'stutter', edge: 'in', at_s: at(end + 1), frames: [k, end], note: `Stutter (repeated frames) from ${at(k)}s to ${at(end + 1)}s; start after it` });
			else out.push({ kind: 'stutter', edge: 'out', at_s: at(k), frames: [k, end], note: `Stutter (repeated frames) from ${at(k)}s to ${at(end + 1)}s; end before it` });
			k = end + 1;
		} else k++;
	}

	return out
		.filter((s) => (s.edge === 'in' ? s.at_s > trim.in_s + 1e-6 && trim.out_s - s.at_s >= MIN_SPAN_S : s.at_s < trim.out_s - 1e-6 && s.at_s - trim.in_s >= MIN_SPAN_S))
		.sort((a, b) => a.frames[0] - b.frames[0]);
}

/** Accept several suggestions at once: the latest in-point and the earliest out-point, if a span is left. */
export function acceptAll(trim: { in_s: number; out_s: number }, suggestions: Pick<TrimSuggestion, 'edge' | 'at_s'>[]): { in_s: number; out_s: number } {
	const in_s = Math.max(trim.in_s, ...suggestions.filter((s) => s.edge === 'in').map((s) => s.at_s));
	const out_s = Math.min(trim.out_s, ...suggestions.filter((s) => s.edge === 'out').map((s) => s.at_s));
	return out_s - in_s >= MIN_SPAN_S ? { in_s, out_s } : trim;
}

/** Frame differences from raw grayscale frames (width × height bytes each), as suggestTrims reads them. */
export function frameSignal(frames: Uint8Array[], fps: number): FrameSignal {
	const delta = (a: Uint8Array, b: Uint8Array) => {
		let sum = 0;
		for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
		return sum / (a.length * 255);
	};
	return {
		fps,
		diffs: frames.slice(0, -1).map((frame, k) => delta(frame, frames[k + 1])),
		skips: frames.slice(0, -2).map((frame, k) => delta(frame, frames[k + 2]))
	};
}
