import { describe, expect, test } from 'bun:test';
import { musicFlow, MUSIC_JOIN_S } from '../../src/lib/domain/sound';

// Robert's rule for trailer music: the song never restarts from the top, never stops and starts, keeps flowing
// (a quiet loop) under long stretches, and the picture is never trimmed to fit it. The song's own ending lands
// on the cut's last frame.
const beats = Array.from({ length: 200 }, (_, i) => Math.round(i * 0.5 * 1000) / 1000); // 120 BPM: a bar is 2 s

describe('music flow', () => {
	test('a song longer than the cut plays once from the top and fades out at the cut end', () => {
		const flow = musicFlow({ song_s: 80, cut_s: 60 });
		expect(flow.pieces).toHaveLength(1);
		expect(flow.pieces[0]).toMatchObject({ from: 0, to: 60, at_s: 0, gain_db: 0, fade_in: 0 });
		expect(flow.pieces[0].fade_out).toBeGreaterThan(0);
		expect(flow.loops).toBe(0);
	});

	test('a shorter song: head once, quiet whole-bar loops in the middle, its own ending on the last frame', () => {
		const flow = musicFlow({ song_s: 60, cut_s: 150, beats, flow: { loop_from_s: 20.2, loop_to_s: 35.9, bed_db: -6 } });
		const [head, ...rest] = flow.pieces;
		const outro = rest.at(-1)!;
		const loops = rest.slice(0, -1);
		// Snapped to beats and to whole bars (4 beats = 2 s): 20.0 → 36.0.
		expect(flow.loop).toEqual([20, 36]);
		// The head is the song from its top, never repeated; nothing else starts at 0 in the song.
		expect(head).toMatchObject({ from: 0, at_s: 0, gain_db: 0 });
		expect(rest.every((p) => p.from > 0)).toBeTrue();
		// Loops sit quieter and play only the loop bars.
		expect(loops.length).toBeGreaterThan(0);
		expect(loops.every((p) => p.gain_db === -6 && p.from >= 20 - MUSIC_JOIN_S && p.to <= 36 + MUSIC_JOIN_S)).toBeTrue();
		// The outro is the song's own ending, at full level, ending exactly at the cut end.
		expect(outro).toMatchObject({ to: 60, gain_db: 0, fade_out: 0 });
		expect(outro.at_s + (outro.to - outro.from)).toBeCloseTo(150, 6);
		// No gaps: each piece starts no later than the one before it ends.
		for (let i = 1; i < flow.pieces.length; i++) {
			const prev = flow.pieces[i - 1];
			expect(flow.pieces[i].at_s).toBeLessThanOrEqual(prev.at_s + (prev.to - prev.from) + 1e-6);
		}
		expect(flow.loops).toBe(loops.length);
	});

	test('without a chosen loop the middle half of the song loops, on whole bars', () => {
		const flow = musicFlow({ song_s: 60, cut_s: 100, beats });
		expect(flow.loop).toEqual([16, 46]);
		expect(flow.pieces.at(-1)!.at_s + (flow.pieces.at(-1)!.to - flow.pieces.at(-1)!.from)).toBeCloseTo(100, 6);
	});

	test('a loop that is out of range falls back to the default', () => {
		expect(musicFlow({ song_s: 60, cut_s: 100, flow: { loop_from_s: 50, loop_to_s: 70, bed_db: -6 } }).loop).toEqual([15, 45]);
	});
});

describe('song time under the cut', () => {
	test('maps cut time to song time through the pieces (QC song sync)', async () => {
		const { songTimeAt } = await import('../../src/lib/domain/sound');
		const flow = musicFlow({ song_s: 60, cut_s: 150, beats, flow: { loop_from_s: 20, loop_to_s: 36, bed_db: -6 } });
		expect(songTimeAt(undefined, 12)).toBe(12);
		expect(songTimeAt(flow.pieces, 10)).toBeCloseTo(10, 6); // head
		expect(songTimeAt(flow.pieces, 40)).toBeCloseTo(24, 6); // first loop: 36 → 20, so 40 → 24
		expect(songTimeAt(flow.pieces, 149)).toBeCloseTo(59, 6); // the song's ending on the last frame
	});
});
