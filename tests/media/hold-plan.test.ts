import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { holdFrame, holdName, holdPlan } from '../../src/lib/media/hold-plan';
import { runFfmpeg } from '../../src/lib/server/ffmpeg';
import { probeMedia } from '../../src/lib/server/media-probe';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const base = { input: 'still.png', output: 'hold.mp4', width: 2048, height: 1152 };
const filter = (args: string[]) => args[args.indexOf('-vf') + 1];

describe('hold render plan', () => {
	test('a plain hold loops the still for its length at 30 fps, scaled to a 1920 long edge', () => {
		const args = holdPlan({ ...base, length_s: 4, push_in: false, fade: false });
		expect(args.slice(args.indexOf('-loop'), args.indexOf('-loop') + 4)).toEqual(['-loop', '1', '-framerate', '30']);
		expect(filter(args)).toBe('scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p');
		expect(args.slice(args.indexOf('-t'), args.indexOf('-t') + 2)).toEqual(['-t', '4']);
		expect(args.at(-1)).toBe('hold.mp4');
		expect(args).toContain('-an');
	});

	test('push-in zooms 8% over every frame of the hold, from a 4x upscale, without looping the input', () => {
		const args = holdPlan({ ...base, length_s: 2, push_in: true, fade: false });
		expect(args).not.toContain('-loop');
		expect(filter(args)).toBe(
			"scale=7680:4320:flags=lanczos,zoompan=z='1+0.08*on/59':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=60:s=1920x1080:fps=30,setsar=1,format=yuv420p"
		);
	});

	test('fade in and out last half a second, or a quarter of a short hold', () => {
		expect(filter(holdPlan({ ...base, length_s: 4, push_in: false, fade: true }))).toContain('fade=t=in:st=0:d=0.5,fade=t=out:st=3.5:d=0.5');
		expect(filter(holdPlan({ ...base, length_s: 1, push_in: false, fade: true }))).toContain('fade=t=in:st=0:d=0.25,fade=t=out:st=0.75:d=0.25');
	});

	test('length is clamped to 0.5–30 s', () => {
		const at = (length_s: number) => { const args = holdPlan({ ...base, length_s, push_in: false, fade: false }); return args[args.indexOf('-t') + 1]; };
		expect(at(0.1)).toBe('0.5');
		expect(at(90)).toBe('30');
	});

	test('portrait stills keep their aspect with even dimensions', () => {
		expect(holdFrame(1152, 2048)).toEqual({ width: 1080, height: 1920 });
		expect(holdFrame(1000, 999)).toEqual({ width: 1920, height: 1918 });
	});

	test('the take name says what the hold is', () => {
		expect(holdName('title.png', { length_s: 3, push_in: true, fade: true })).toBe('Hold 3s · push-in + fade · title.png');
		expect(holdName('title.png', { length_s: 2.5, push_in: false, fade: false })).toBe('Hold 2.5s · title.png');
	});
});

const hasFfmpeg = Bun.spawnSync(['ffmpeg', '-version']).exitCode === 0;

describe.skipIf(!hasFfmpeg)('hold render (ffmpeg smoke test)', () => {
	test('renders a fixture still into a playable video of the chosen length', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-hold-')); roots.push(root);
		const still = join(root, 'still.png');
		await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:duration=1', '-frames:v', '1', still]);
		const output = join(root, 'hold.mp4');
		await runFfmpeg(holdPlan({ input: still, output, length_s: 1.5, push_in: true, fade: true, width: 640, height: 360 }));
		expect((await stat(output)).size).toBeGreaterThan(0);
		const probe = await probeMedia(output);
		expect(probe).toMatchObject({ width: 1920, height: 1080 });
		expect(probe.duration_s!).toBeCloseTo(1.5, 1);
	}, 60_000);
});
