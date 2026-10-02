import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { autoGain, dbToGain, defaultSoundPlan, duckRegions, duckVolumeExpression, mixPlan, rampChunks, tailRepair, type MixInput } from '../../src/lib/domain/sound';

describe('auto-mix gain math', () => {
	test('auto gain brings each layer to its target, bounded, in half-dB steps', () => {
		expect(autoGain(-30, 'take')).toBe(10);
		expect(autoGain(-8.3, 'music')).toBe(-12.5);
		expect(autoGain(-90, 'take')).toBe(0); // silence: leave it
		expect(autoGain(-70, 'effects')).toBe(18); // bounded
		expect(autoGain(null, 'ambience')).toBe(0);
		expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
	});

	test('ramped take audio stretches up to 1.5× and mutes above it, keeping its played length', () => {
		const chunks = rampChunks({ in_s: 0, out_s: 4, speed: [{ x: 0, rate: 1 }, { x: 0.5, rate: 1 }, { x: 0.5001, rate: 3 }, { x: 1, rate: 3 }] });
		expect(chunks.length).toBeGreaterThan(2);
		expect(chunks.filter((c) => c.rate <= 1.5).every((c) => !c.mute)).toBeTrue();
		expect(chunks.filter((c) => c.rate > 1.5).every((c) => c.mute)).toBeTrue();
		expect(chunks[0].from).toBe(0);
		expect(chunks.at(-1)!.to).toBeCloseTo(4, 6);
		expect(rampChunks({ in_s: 1, out_s: 3 })).toEqual([{ from: 1, to: 3, rate: 1, mute: false }]);
	});

	test('a loud sound at a cut rings out from the take\'s own footage; a quiet one does not', () => {
		expect(tailRepair(-12, 2)).toEqual({ extend_s: 0.25, fade_s: 0.25 });
		expect(tailRepair(-12, 0.1)).toEqual({ extend_s: 0.1, fade_s: 0.1 });
		expect(tailRepair(-45, 2)).toEqual({ extend_s: 0, fade_s: 0 });
		expect(tailRepair(-12, 0)).toEqual({ extend_s: 0, fade_s: 0 });
		// Continuous loud audio (a trailer's own mix) isn't a chopped hit: the edge must stand out from the take's average.
		expect(tailRepair(-14, 2, -13)).toEqual({ extend_s: 0, fade_s: 0 });
		expect(tailRepair(-8, 2, -16)).toEqual({ extend_s: 0.25, fade_s: 0.25 });
	});

	test('music ducks around loud take audio and effects, padded and merged', () => {
		const activity = Array.from({ length: 300 }, (_, f) => (f >= 100 && f < 120 ? -10 : f >= 135 && f < 140 ? -8 : -40));
		const regions = duckRegions(activity, 100, -20, [{ at_s: 2.5, length_s: 0.4 }]);
		// 1.0–1.2 and 1.35–1.4 merge (gap under 0.2 after padding); the effect at 2.5 is its own region.
		expect(regions).toEqual([[0.95, 1.7], [2.45, 3.2]]);
		expect(duckVolumeExpression(regions, -9)).toBe('if(gt(between(t\\,0.95\\,1.7)+between(t\\,2.45\\,3.2)\\,0)\\,0.3548\\,1)');
		expect(duckVolumeExpression([], -9)).toBe('1');
	});

	test('the render plan places, fades, ducks and limits', () => {
		const input: MixInput = {
			length_s: 6, output: 'out.m4a', auto: { take: 2, ambience: 0, music: -3, effects: 0 }, plan: defaultSoundPlan(), duck: [[1, 2]],
			entries: [
				{ file: 'a.mp4', in_s: 1, out_s: 4, at_s: 0, before_s: 1, after_s: 2, edge_db: -10 },
				{ file: null, in_s: 0, out_s: 3, at_s: 3, before_s: 0, after_s: 0, edge_db: null }
			],
			music: { file: 'song.mp3' }, ambience: { file: 'rain.wav' }, effects: [{ file: 'hit.wav', at_s: 2.9, gain_db: -2 }]
		};
		const { args, report } = mixPlan(input);
		const graph = args[args.indexOf('-filter_complex') + 1];
		expect(args.filter((a) => a === '-i')).toHaveLength(4);
		expect(args).toContain('-stream_loop');
		expect(graph).toContain('atrim=start=0.980:end=4.250'); // 20 ms head handle; 0.25 s ring-out
		expect(graph).toContain('afade=t=out:st=3.020:d=0.250');
		expect(graph).toContain("volume='if(gt(between(t\\,1\\,2)\\,0)\\,0.3548\\,1)':eval=frame");
		expect(graph).toContain('alimiter=limit=0.8913');
		expect(graph).toContain('adelay=delays=2900:all=1');
		expect(report.join(' ')).toContain('rings out 0.25s');
		expect(report.join(' ')).toContain('no audio of their own');
		const last = mixPlan({ ...input, entries: [{ ...input.entries[0] }] });
		expect(last.report.join(' ')).not.toContain('rings out');
	});
});

const hasFfmpeg = Bun.spawnSync(['ffmpeg', '-version']).exitCode === 0;
const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))); });

describe.skipIf(!hasFfmpeg)('mix render (ffmpeg smoke test)', () => {
	test('a cut with a ramp, a song, an ambience bed and an effect renders to the cut length', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-mix-')); roots.push(root);
		const run = (args: string[]) => expect(Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', ...args]).exitCode).toBe(0);
		run(['-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=24:d=6', '-f', 'lavfi', '-i', 'sine=frequency=440:d=6', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', join(root, 'a.mp4')]);
		run(['-f', 'lavfi', '-i', 'sine=frequency=220:d=8', join(root, 'song.wav')]);
		run(['-f', 'lavfi', '-i', 'anoisesrc=d=2:c=brown:a=0.1', join(root, 'rain.wav')]);
		run(['-f', 'lavfi', '-i', 'sine=frequency=1200:d=0.3', join(root, 'hit.wav')]);
		const output = join(root, 'mix.m4a');
		const { args } = mixPlan({
			length_s: 5, output, auto: { take: 0, ambience: 0, music: 0, effects: 0 }, plan: defaultSoundPlan(), duck: [[1, 1.5]],
			entries: [
				{ file: join(root, 'a.mp4'), in_s: 0.5, out_s: 2.5, at_s: 0, before_s: 0.5, after_s: 3.5, edge_db: -12 },
				{ file: join(root, 'a.mp4'), in_s: 1, out_s: 5, speed: [{ x: 0, rate: 1 }, { x: 1, rate: 3 }], at_s: 2, before_s: 1, after_s: 1, edge_db: null }
			],
			music: { file: join(root, 'song.wav') }, ambience: { file: join(root, 'rain.wav') }, effects: [{ file: join(root, 'hit.wav'), at_s: 2, gain_db: 0 }]
		});
		const done = Bun.spawnSync(['ffmpeg', ...args]);
		expect(done.stderr.toString()).toBe('');
		const probe = Bun.spawnSync(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', output]).stdout.toString();
		expect(Number(probe)).toBeCloseTo(5, 0);
	}, 60_000);
});
