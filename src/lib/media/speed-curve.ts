/**
 * Clip speed ramps for review cuts. A ramp is a curve of playback rate over the kept span
 * (x = 0 at the in-point, 1 at the out-point). Rates only speed up — 1× to 4× — because
 * drafts often render in slow motion and the cut needs parts of them faster, never slower.
 * Interpolation is the monotone cubic beatsmaxxer-pro's timing curve uses, so the curve
 * never overshoots between anchors.
 */
export interface SpeedPoint {
	x: number;
	rate: number;
}

export const MIN_RATE = 1;
export const MAX_RATE = 4;
const STEPS = 256;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

/** Sorted, clamped, de-duplicated, with anchors pinned at both ends of the span. */
export function normalizeSpeed(points: readonly SpeedPoint[] | null | undefined): SpeedPoint[] {
	const sorted = (points ?? []).map((p) => ({ x: clamp(p.x, 0, 1), rate: clamp(p.rate, MIN_RATE, MAX_RATE) })).sort((a, b) => a.x - b.x);
	const result: SpeedPoint[] = [];
	for (const point of sorted) {
		if (result.length && Math.abs(result[result.length - 1].x - point.x) < 1e-6) result[result.length - 1] = point;
		else result.push(point);
	}
	if (!result.length || result[0].x > 0) result.unshift({ x: 0, rate: result[0]?.rate ?? 1 });
	if (result[result.length - 1].x < 1) result.push({ x: 1, rate: result[result.length - 1].rate });
	return result;
}

export function isFlat(points: readonly SpeedPoint[] | null | undefined): boolean {
	return normalizeSpeed(points).every((p) => Math.abs(p.rate - 1) < 1e-6);
}

function tangent(points: SpeedPoint[], i: number): number {
	if (i === 0 || i === points.length - 1) return 0;
	const h0 = points[i].x - points[i - 1].x;
	const h1 = points[i + 1].x - points[i].x;
	if (h0 <= 0 || h1 <= 0) return 0;
	const d0 = (points[i].rate - points[i - 1].rate) / h0;
	const d1 = (points[i + 1].rate - points[i].rate) / h1;
	if (d0 * d1 <= 0) return 0;
	const w0 = 2 * h1 + h0;
	const w1 = h1 + 2 * h0;
	return (w0 + w1) / (w0 / d0 + w1 / d1);
}

/** Playback rate at x (0..1 of the kept span). */
export function rateAt(points: readonly SpeedPoint[] | null | undefined, x: number): number {
	const p = normalizeSpeed(points);
	const at = clamp(x, 0, 1);
	let i = 0;
	while (i < p.length - 2 && at >= p[i + 1].x) i++;
	const a = p[i];
	const b = p[i + 1];
	const h = b.x - a.x;
	if (h <= 0) return a.rate;
	const t = (at - a.x) / h;
	const m0 = tangent(p, i) * h;
	const m1 = tangent(p, i + 1) * h;
	const delta = b.rate - a.rate;
	const rate = a.rate + t * (m0 + t * (3 * delta - 2 * m0 - m1 + t * (-2 * delta + m0 + m1)));
	return clamp(rate, MIN_RATE, MAX_RATE);
}

/** Seconds of program time that the first `fraction` of a kept span of `span` seconds plays for. */
export function programElapsed(points: readonly SpeedPoint[] | null | undefined, span: number, fraction = 1): number {
	if (isFlat(points)) return span * clamp(fraction, 0, 1);
	const end = clamp(fraction, 0, 1);
	const steps = Math.max(1, Math.ceil(STEPS * end));
	const dx = end / steps;
	let sum = 0;
	for (let i = 0; i < steps; i++) sum += dx / rateAt(points, (i + 0.5) * dx);
	return span * sum;
}

/** Inverse of programElapsed: the span fraction reached after `seconds` of program time. */
export function fractionAtProgram(points: readonly SpeedPoint[] | null | undefined, span: number, seconds: number): number {
	if (span <= 0) return 0;
	if (isFlat(points)) return clamp(seconds / span, 0, 1);
	const dx = 1 / STEPS;
	let elapsed = 0;
	for (let i = 0; i < STEPS; i++) {
		const step = (span * dx) / rateAt(points, (i + 0.5) * dx);
		if (elapsed + step >= seconds) return clamp((i + (seconds - elapsed) / step) * dx, 0, 1);
		elapsed += step;
	}
	return 1;
}
