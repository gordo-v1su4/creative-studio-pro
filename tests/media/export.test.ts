import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bakePlan, buildFcpxml, draftTakes, fileUrl, mp4Plan, toFrames } from '../../src/lib/domain/export';

describe('FCPXML for Resolve', () => {
	const xml = buildFcpxml({
		title: 'Trailer v1 & co',
		clips: [{ name: '01 Opening', file: 'C:\\exports\\01 opening.mp4', frames: 144 }, { name: '02 Leap', file: 'C:\\exports\\02-leap.mp4', frames: 60 }],
		audio: [{ name: 'Mix', file: 'C:\\exports\\mix.m4a', frames: 204 }, { name: 'Music stem', file: 'C:\\exports\\music.m4a', frames: 204 }]
	});

	test('clips sit in order on the spine at 24 fps, with exact offsets and lengths', () => {
		expect(xml).toContain('<fcpxml version="1.9">');
		expect(xml).toContain('frameDuration="1/24s" width="1920" height="1080"');
		expect(xml).toContain('<asset-clip ref="v1" name="01 Opening" offset="0s" start="0s" duration="144/24s"');
		expect(xml).toContain('<asset-clip ref="v2" name="02 Leap" offset="144/24s" start="0s" duration="60/24s"');
		expect(xml).toContain('<sequence format="r0" duration="204/24s"');
	});
	test('the mix and stems are connected audio on their own lanes, for the whole cut', () => {
		expect(xml).toContain('<asset-clip ref="a1" lane="-1" name="Mix" offset="0s" start="0s" duration="204/24s"/>');
		expect(xml).toContain('<asset-clip ref="a2" lane="-2" name="Music stem"');
		expect(xml).toContain('hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"');
	});
	test('paths become file URLs and names are escaped', () => {
		expect(xml).toContain('src="file:///C:/exports/01%20opening.mp4"');
		expect(xml).toContain('<project name="Trailer v1 &amp; co">');
		expect(fileUrl('/home/me/a b.mp4')).toBe('file:///home/me/a%20b.mp4');
	});
});

describe('render plans', () => {
	test('a flat entry bakes its trim; a ramp bakes as retimed pieces; the frame count is the played length', () => {
		const flat = bakePlan({ file: 'a.mp4', in_s: 1, out_s: 4, output: 'o.mp4' });
		expect(flat.frames).toBe(72);
		expect(flat.args.join(' ')).toContain('trim=start=1.0000:end=4.0000,setpts=(PTS-STARTPTS)/1');
		expect(flat.args).toContain('-g');
		const ramp = bakePlan({ file: 'a.mp4', in_s: 0, out_s: 4, speed: [{ x: 0, rate: 2 }, { x: 1, rate: 2 }], output: 'o.mp4' });
		expect(ramp.frames).toBe(toFrames(2));
		expect(ramp.args.join(' ')).toContain('/2[p0]');
		expect(ramp.args.join(' ')).toContain('concat=n=');
	});
	test('the MP4 joins the intermediates and takes the mix', () => {
		const args = mp4Plan({ intermediates: ['1.mp4', '2.mp4'], mix: 'mix.m4a', output: 'out.mp4' });
		expect(args.join(' ')).toContain('[0:v][1:v]concat=n=2:v=1:a=0[v]');
		expect(args).toContain('2:a');
	});
	test('drafts and low-resolution takes are listed', () => {
		expect(draftTakes([
			{ title: 'A', take: { name: 'a.mp4', width: 854, height: 480, generation: { provider: 'higgsfield', model: 's', resolution: '480p', prompt: 'p', draft: true } } },
			{ title: 'B', take: { name: 'b.mp4', width: 1920, height: 1080 } },
			{ title: 'C', take: { name: 'c.mp4', width: 1280, height: 720 } }
		])).toEqual([{ title: 'A', name: 'a.mp4', why: '480p draft (480p), not finalized' }, { title: 'C', name: 'c.mp4', why: '1280×720, under 1080' }]);
	});
});

const hasFfmpeg = Bun.spawnSync(['ffmpeg', '-version']).exitCode === 0;
const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))); });

describe.skipIf(!hasFfmpeg)('MP4 export (ffmpeg smoke test)', () => {
	test('two baked entries (one ramped) and a mix render to an MP4 of the cut length', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-export-')); roots.push(root);
		const run = (args: string[]) => { const r = Bun.spawnSync(['ffmpeg', ...args]); expect(r.stderr.toString()).toBe(''); };
		run(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=854x480:r=24:d=6', '-c:v', 'libx264', join(root, 'take.mp4')]);
		run(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:d=4', '-ac', '2', '-c:a', 'aac', join(root, 'mix.m4a')]);
		const a = bakePlan({ file: join(root, 'take.mp4'), in_s: 0.5, out_s: 2.5, output: join(root, '01.mp4') });
		const b = bakePlan({ file: join(root, 'take.mp4'), in_s: 1, out_s: 5, speed: [{ x: 0, rate: 1 }, { x: 1, rate: 3 }], output: join(root, '02.mp4') });
		run(a.args); run(b.args);
		const frames = (file: string) => Number(Bun.spawnSync(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height', '-of', 'csv=p=0', file]).stdout.toString().trim().split(',').at(-1));
		expect(frames(join(root, '01.mp4'))).toBe(a.frames);
		expect(frames(join(root, '02.mp4'))).toBe(b.frames);
		run(mp4Plan({ intermediates: [join(root, '01.mp4'), join(root, '02.mp4')], mix: join(root, 'mix.m4a'), output: join(root, 'out.mp4') }));
		const duration = Number(Bun.spawnSync(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(root, 'out.mp4')]).stdout.toString());
		expect(duration).toBeCloseTo((a.frames + b.frames) / 24, 0);
	}, 120_000);
});
