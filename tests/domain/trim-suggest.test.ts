import { describe, expect, test } from 'bun:test';
import { acceptAll, frameSignal, suggestTrims, type FrameSignal } from '../../src/lib/domain/trim-suggest';

const FPS = 24;
/** A clean 5 s take: steady motion with a little noise, frame to frame. */
function clean(frames = 120): number[] {
	return Array.from({ length: frames - 1 }, (_, k) => 0.02 + 0.004 * Math.sin(k * 1.7));
}
const signal = (diffs: number[]): FrameSignal => ({ fps: FPS, diffs, skips: diffs.slice(0, -1).map((d, k) => d + diffs[k + 1]) });
const whole = (diffs: number[]) => ({ in_s: 0, out_s: (diffs.length + 1) / FPS });

describe('suggest trims on synthetic frame differences', () => {
	test('a clean take gets no suggestions', () => {
		const d = clean();
		expect(suggestTrims(signal(d), whole(d))).toEqual([]);
	});

	test('a freeze at the start moves the in-point past it', () => {
		const d = clean();
		for (let k = 0; k < 10; k++) d[k] = 0;
		const [s, ...rest] = suggestTrims(signal(d), whole(d));
		expect(rest).toEqual([]);
		expect(s).toMatchObject({ kind: 'freeze', edge: 'in', frames: [0, 10] });
		expect(s.at_s).toBeCloseTo(10 / FPS, 3);
	});

	test('a freeze at the end moves the out-point before it, keeping one frame of it', () => {
		const d = clean();
		for (let k = 100; k < d.length; k++) d[k] = 0;
		const [s] = suggestTrims(signal(d), whole(d));
		expect(s).toMatchObject({ kind: 'freeze', edge: 'out' });
		expect(s.at_s).toBeCloseTo(101 / FPS, 3);
	});

	test('a short hold under a quarter second is left alone', () => {
		const d = clean();
		for (let k = 50; k < 53; k++) d[k] = 0;
		expect(suggestTrims(signal(d), whole(d))).toEqual([]);
	});

	test('stutter late in the take (repeated frames mixed into motion) ends the take before it', () => {
		const d = clean();
		for (let k = 90; k < 110; k++) d[k] = k % 2 ? 0 : 0.04;
		const [s] = suggestTrims(signal(d), whole(d));
		expect(s).toMatchObject({ kind: 'stutter', edge: 'out' });
		expect(s.at_s).toBeCloseTo(91 / FPS, 3); // the first frame that repeats
	});

	test('a bad start (a cut a few frames in) starts after the cut', () => {
		const d = clean();
		d[3] = 0.4;
		const [s, ...rest] = suggestTrims(signal(d), whole(d));
		expect(rest).toEqual([]);
		expect(s).toMatchObject({ kind: 'bad_start', edge: 'in', frames: [0, 3] });
		expect(s.at_s).toBeCloseTo(4 / FPS, 3);
	});

	test('a one-frame flash near the out-point is offered as a one-frame trim', () => {
		const d = clean();
		const stray = 116;
		d[stray - 1] = 0.5; d[stray] = 0.5;
		const [s, ...rest] = suggestTrims(signal(d), whole(d));
		expect(rest).toEqual([]);
		expect(s).toMatchObject({ kind: 'stray_frame', edge: 'out', frames: [stray, stray] });
		expect(s.at_s).toBeCloseTo(stray / FPS, 3);
	});

	test('a stray frame sitting right on the in-point (split at a Seedance internal cut) trims just that frame', () => {
		const d = clean();
		const t = { in_s: 2, out_s: 5 };
		const at = 2 * FPS; // first kept frame
		d[at - 1] = 0.5; d[at] = 0.5; // a flash that belongs to neither shot
		const [s] = suggestTrims(signal(d), t);
		expect(s).toMatchObject({ kind: 'stray_frame', edge: 'in', frames: [at, at] });
		expect(s.at_s).toBeCloseTo((at + 1) / FPS, 3);
	});

	test('fast continuous motion (a whip, measured from a real take) is not a stray frame or a cut', () => {
		const d = clean();
		[0.061, 0.073, 0.077, 0.083, 0.088, 0.084, 0.081, 0.072, 0.063, 0.056, 0.048].forEach((v, i) => (d[4 + i] = v));
		expect(suggestTrims(signal(d), whole(d))).toEqual([]);
	});

	test('a slow near-still shot (tiny real motion, measured from a real take) is not a freeze', () => {
		const d = clean();
		[0.0036, 0.0008, 0.00034, 0.00083, 0.00103, 0.00046, 0.00065, 0.00082, 0.0023, 0.00077, 0.00041, 0.00083, 0.00168, 0.0009, 0.0011].forEach((v, i) => (d[40 + i] = v));
		expect(suggestTrims(signal(d), whole(d))).toEqual([]);
	});

	test('a locked-off, near-still take (measured from a real take) has no freezes', () => {
		const d = Array.from({ length: 119 }, (_, k) => (k % 8 === 0 ? 0.0015 : 0.0003 + 0.0003 * Math.abs(Math.sin(k))));
		expect(suggestTrims(signal(d), whole(d))).toEqual([]);
	});

	test('only the kept span is examined', () => {
		const d = clean();
		for (let k = 0; k < 10; k++) d[k] = 0;
		expect(suggestTrims(signal(d), { in_s: 1, out_s: 5 })).toEqual([]);
	});

	test('accept all takes the latest in and the earliest out, unless nothing would be left', () => {
		expect(acceptAll({ in_s: 0, out_s: 5 }, [{ edge: 'in', at_s: 0.4 }, { edge: 'in', at_s: 0.2 }, { edge: 'out', at_s: 4.5 }])).toEqual({ in_s: 0.4, out_s: 4.5 });
		expect(acceptAll({ in_s: 0, out_s: 1 }, [{ edge: 'in', at_s: 0.9 }, { edge: 'out', at_s: 0.95 }])).toEqual({ in_s: 0, out_s: 1 });
	});

	test('frame signal from raw grayscale frames', () => {
		const black = new Uint8Array(4), white = new Uint8Array(4).fill(255);
		const s = frameSignal([black, black, white], 24);
		expect(s.diffs).toEqual([0, 1]);
		expect(s.skips).toEqual([1]);
	});
});
