/**
 * Waveform peaks for drawing (V1S-126): a file's audio decoded in the browser,
 * reduced to the loudest sample per 1 / PEAKS_HZ s, normalised 0..1. Cached
 * per URL; null when the file has no audio the browser can decode.
 */
export const PEAKS_HZ = 100;

const cache = new Map<string, Promise<number[] | null>>();
let context: AudioContext | null = null;

export function loadPeaks(url: string): Promise<number[] | null> {
	const hit = cache.get(url);
	if (hit) return hit;
	const job = (async () => {
		try {
			const bytes = await (await fetch(url)).arrayBuffer();
			context ??= new AudioContext();
			const audio = await context.decodeAudioData(bytes);
			const data = audio.getChannelData(0);
			const step = Math.max(1, Math.round(audio.sampleRate / PEAKS_HZ));
			const peaks: number[] = [];
			let max = 0;
			for (let i = 0; i < data.length; i += step) {
				let peak = 0;
				for (let j = i; j < Math.min(data.length, i + step); j++) peak = Math.max(peak, Math.abs(data[j]));
				peaks.push(peak);
				max = Math.max(max, peak);
			}
			return max > 1e-4 ? peaks.map((p) => p / max) : null;
		} catch {
			return null;
		}
	})();
	cache.set(url, job);
	return job;
}

/** Peaks reduced to `count` columns, the loudest in each, so a lane of any width draws the same shape. */
export function waveColumns(peaks: number[], count: number): number[] {
	const columns = Math.max(1, Math.min(Math.floor(count), peaks.length));
	if (!peaks.length) return [];
	return Array.from({ length: columns }, (_, i) => {
		const from = Math.floor((i / columns) * peaks.length);
		const to = Math.max(from + 1, Math.floor(((i + 1) / columns) * peaks.length));
		let peak = 0;
		for (let j = from; j < to; j++) peak = Math.max(peak, peaks[j]);
		return peak;
	});
}

/** A closed SVG path of the columns mirrored about the middle, for a viewBox `columns.length` wide and 2 high. */
export function wavePath(columns: number[]): string {
	if (!columns.length) return '';
	// Silence still draws a hairline, so the lane reads as a track with nothing on it.
	const half = columns.map((value) => Math.round(Math.max(0.04, Math.min(1, value)) * 1000) / 1000);
	const top = half.map((h, i) => `${i},${1 - h} ${i + 1},${1 - h}`).join(' ');
	const bottom = half.map((h, i) => `${i + 1},${1 + h} ${i},${1 + h}`).reverse().join(' ');
	return `M${top} L${bottom} Z`;
}
