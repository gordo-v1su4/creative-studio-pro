import { describe, expect, test } from 'bun:test';
import { beatGrid, ENVELOPE_HZ, matchToMusic, onsetEnvelope, type MusicEntry } from '../../src/lib/domain/music';

const HZ = ENVELOPE_HZ;
/** A deterministic pseudo-random song envelope: onsets at irregular places, so every offset looks different. */
function songEnvelope(seconds: number, seed = 7): number[] {
	let s = seed;
	const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
	return Array.from({ length: seconds * HZ }, () => (rand() < 0.06 ? 0.5 + rand() : rand() * 0.05));
}
/** A take whose audio is the song from `songAt` seconds, with `lead` seconds of other sound before it. */
function takeFrom(song: number[], songAt: number, length: number, lead: number): number[] {
	const other = songEnvelope(lead + 1, 99).slice(0, Math.round(lead * HZ));
	return [...other, ...song.slice(Math.round(songAt * HZ), Math.round((songAt + length) * HZ))];
}
const beatsEvery = (step: number, until: number) => Array.from({ length: Math.floor(until / step) }, (_, i) => Math.round((i + 1) * step * 1000) / 1000);

describe('match to music', () => {
	test('each entry slides to where its own audio matches the song; order and lengths are kept', () => {
		const song = songEnvelope(20);
		// Take A holds the song from 0 s after 1.5 s of other sound; take B the song from 3 s after 0.7 s.
		const entries: MusicEntry[] = [
			{ entry_id: 'a', in_s: 0, out_s: 3, duration_s: 6, onset: takeFrom(song, 0, 4.5, 1.5) },
			{ entry_id: 'b', in_s: 0.2, out_s: 2.2, duration_s: 5, onset: takeFrom(song, 3, 4.3, 0.7) }
		];
		const result = matchToMusic({ onset: song, beats: beatsEvery(0.5, 20) }, entries);
		expect(result.map((r) => r.entry_id)).toEqual(['a', 'b']);
		expect(result[0]).toMatchObject({ mode: 'aligned', in_s: 1.5, out_s: 4.5 });
		expect(result[1]).toMatchObject({ mode: 'aligned', in_s: 0.7, out_s: 2.7 });
		expect(result.every((r) => r.confidence > 0.9)).toBeTrue();
	});

	test('repetitive music ties a beat apart: the nearest equal place to the current in-point wins', () => {
		const beat = Array.from({ length: 50 }, (_, i) => (i === 0 ? 1 : 0.01));
		const song = Array.from({ length: 20 }, () => beat).flat();
		const take = Array.from({ length: 12 }, () => beat).flat();
		const [a] = matchToMusic({ onset: song, beats: beatsEvery(0.5, 10) }, [{ entry_id: 'a', in_s: 1.6, out_s: 3.6, duration_s: 6, onset: take }]);
		expect(a.mode).toBe('aligned');
		expect(a.in_s).toBe(1.5);
		expect(a.note).toContain('equal places');
	});

	test('a take with no audio snaps its cut onto the nearest beat instead', () => {
		const song = songEnvelope(20);
		const entries: MusicEntry[] = [
			{ entry_id: 'a', in_s: 0, out_s: 2.3, duration_s: 6, onset: null },
			{ entry_id: 'b', in_s: 1, out_s: 2.6, duration_s: 6, onset: new Array(600).fill(0) }
		];
		const [a, b] = matchToMusic({ onset: song, beats: beatsEvery(0.5, 20) }, entries);
		expect(a).toMatchObject({ mode: 'snapped', in_s: 0, out_s: 2.5 });
		// b now starts at 2.5 s and ran 1.6 s (to 4.1); the nearest beat is 4.0, so it plays 1.5 s.
		expect(b).toMatchObject({ mode: 'snapped', in_s: 1, out_s: 2.5 });
	});

	test('unrelated audio is not trusted: it beat-snaps', () => {
		const song = songEnvelope(20);
		const [a] = matchToMusic({ onset: song, beats: beatsEvery(0.5, 20) }, [{ entry_id: 'a', in_s: 0, out_s: 3.2, duration_s: 8, onset: songEnvelope(8, 1234) }]);
		expect(a.mode).toBe('snapped');
		expect(a.out_s).toBe(3);
	});

	test('a ramped entry beat-snaps by its played length', () => {
		const song = songEnvelope(20);
		const speed = [{ x: 0, rate: 2 }, { x: 1, rate: 2 }];
		const [a] = matchToMusic({ onset: song, beats: beatsEvery(0.5, 20) }, [{ entry_id: 'a', in_s: 0, out_s: 4.6, speed, duration_s: 8, onset: null }]);
		// 4.6 s of footage at 2× plays 2.3 s; the beat at 2.5 s needs 5 s of footage.
		expect(a.mode).toBe('snapped');
		expect(a.out_s).toBeCloseTo(5, 2);
	});

	test('with no beats in reach an entry is kept as it is', () => {
		const [a] = matchToMusic({ onset: songEnvelope(4), beats: [] }, [{ entry_id: 'a', in_s: 0, out_s: 2, duration_s: 2, onset: null }]);
		expect(a).toMatchObject({ mode: 'kept', in_s: 0, out_s: 2 });
	});
});

describe('beat grid and onsets', () => {
	test('a click track at 120 BPM gives 120 BPM and beats on the clicks', () => {
		const rate = 8000;
		const samples = new Float32Array(rate * 10);
		for (let beat = 0.25; beat < 10; beat += 0.5) for (let i = 0; i < 200; i++) samples[Math.round(beat * rate) + i] = Math.sin(i) * 0.8;
		const grid = beatGrid(onsetEnvelope(samples, rate));
		expect(grid.bpm).toBeCloseTo(120, 0);
		expect(grid.beats[0]).toBeCloseTo(0.25, 1);
		expect(grid.beats.slice(0, 4).map((b, i, all) => (i ? b - all[i - 1] : 0.5))).toEqual([0.5, 0.5, 0.5, 0.5]);
	});
});
