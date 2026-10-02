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
