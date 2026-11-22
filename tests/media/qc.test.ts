import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runQc, type QcInput } from '../../src/lib/server/qc';
import type { QcEntry } from '../../src/lib/domain/qc';

/**
 * QC report (V1S-505) on small generated renders: a take with its own (noise) sound, a song,
 * and a two-entry cut rendered right, with the take sound 100 ms late, with a hole in the sound,
 * and with the song started late.
 */
const hasFfmpeg = Bun.spawnSync(['ffmpeg', '-version']).exitCode === 0;
let root = '';
const ff = (args: string[]) => { const r = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', ...args]); if (r.exitCode) throw new Error(r.stderr.toString()); };

// Entry 1: take 1.0–3.0 at 0; entry 2: take 3.5–5.5 at 2. The song plays from the cut's start.
const entries = (take: string): QcEntry[] => [
	{ title: '01 Hall', at_s: 0, length_s: 2, planned_at_s: 0, take: { file: take, in_s: 1 }, ramped: false, dialogue: 'Nice to see you again.' },
	{ title: '02 Run', at_s: 2, length_s: 2, planned_at_s: 2, take: { file: take, in_s: 3.5 }, ramped: false }
];

/** Render the cut: picture from the take, take sound (optionally delayed / holed) mixed with the song (optionally delayed). */
function render(out: string, opts: { takeDelayMs?: number; songDelayMs?: number; hole?: boolean } = {}) {
	const take = join(root, 'take.mp4'), song = join(root, 'song.wav');
	const hole = opts.hole ? ",volume='if(between(t,2.6,3.6),0,1)':eval=frame" : '';
	ff(['-i', take, '-i', song, '-filter_complex', [
		'[0:v]trim=1:3,setpts=PTS-STARTPTS[v1]', '[0:v]trim=3.5:5.5,setpts=PTS-STARTPTS[v2]', '[v1][v2]concat=n=2:v=1:a=0[v]',
		'[0:a]atrim=1:3,asetpts=PTS-STARTPTS[a1]', '[0:a]atrim=3.5:5.5,asetpts=PTS-STARTPTS[a2]',
		`[a1][a2]concat=n=2:v=0:a=1,adelay=${opts.takeDelayMs ?? 0}:all=1,apad,atrim=0:4[t]`,
		`[1:a]adelay=${opts.songDelayMs ?? 0}:all=1,apad,atrim=0:4[s]`,
		`[t][s]amix=inputs=2:normalize=0${hole}[a]`
	].join(';'), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-r', '24', '-c:a', 'aac', '-b:a', '192k', out]);
}

beforeAll(async () => {
	if (!hasFfmpeg) return;
	root = await mkdtemp(join(tmpdir(), 'csp-qc-'));
	ff(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=6', '-f', 'lavfi', '-i', 'anoisesrc=d=6:c=pink:seed=11:a=0.4', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', '-b:a', '192k', join(root, 'take.mp4')]);
	ff(['-f', 'lavfi', '-i', 'anoisesrc=d=6:c=white:seed=5:a=0.15', '-ar', '48000', join(root, 'song.wav')]);
	render(join(root, 'good.mp4'));
	render(join(root, 'late.mp4'), { takeDelayMs: 100 });
	render(join(root, 'hole.mp4'), { hole: true });
	render(join(root, 'song-late.mp4'), { songDelayMs: 120 });
}, 120_000);
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

const input = (name: string, extra: Partial<QcInput> = {}): QcInput => ({
	file: join(root, name), outDir: join(root, `qc-${name}`), fps: 24, entries: entries(join(root, 'take.mp4')), planned_s: 4,
	crossfade_s: 0, music: { file: join(root, 'song.wav'), sections: [{ start: 2.5, end: 4, label: 'chorus', energy: 1 }] }, ...extra
});
const check = (report: Awaited<ReturnType<typeof runQc>>, id: string) => report.checks.find((c) => c.id === id)!;

describe.skipIf(!hasFfmpeg)('QC report on generated renders', () => {
	test('a clean render passes all five checks and leaves a contact sheet and qc.json', async () => {
		const report = await runQc(input('good.mp4'));
		expect(report.checks.map((c) => [c.id, c.status])).toEqual([['picture', 'pass'], ['sound', 'pass'], ['song', 'pass'], ['lip_sync', 'pass'], ['length', 'pass']]);
		expect(report.status).toBe('pass');
		expect(check(report, 'picture').items).toHaveLength(4); // first second, two mid-entry frames, last second
		expect(check(report, 'song').items.at(-1)!.message).toBe('chorus at 0:02.50 lands in 02 Run (+0.50 s in)');
		expect((await stat(join(root, 'qc-good.mp4', 'qc-sheet.jpg'))).size).toBeGreaterThan(1000);
		expect((await stat(join(root, 'qc-good.mp4', 'qc.json'))).size).toBeGreaterThan(100);
	}, 120_000);

	test('take sound 100 ms late fails lip sync on the dialogue shot, with its timecode', async () => {
		const sync = check(await runQc(input('late.mp4')), 'lip_sync');
		expect(sync.status).toBe('fail');
		const hall = sync.items.find((i) => i.message.startsWith('01 Hall'))!;
		expect(hall.status).toBe('fail');
		expect(hall.at_s).toBe(0);
		expect(hall.message).toMatch(/dialogue \+(9\d|10\d) ms \(late, over 40 ms\)/);
		expect(sync.items.find((i) => i.message.startsWith('02 Run'))!.status).toBe('warn'); // no dialogue: off, but only a warning
	}, 120_000);

	test('a hole in the sound is listed with its timecode', async () => {
		const sound = check(await runQc(input('hole.mp4')), 'sound');
		expect(sound.status).toBe('warn');
		expect(sound.items[0].at_s!).toBeCloseTo(2.6, 1);
		expect(sound.items[0].message).toContain('Silence 0:02.6');
	}, 120_000);

	test('a song started late is off at every entry', async () => {
		const song = check(await runQc(input('song-late.mp4')), 'song');
		expect(song.status).toBe('fail');
		expect(song.items.filter((i) => i.status === 'fail').map((i) => i.message.split(':')[0])).toEqual(['01 Hall', '02 Run']);
	}, 120_000);

	test('a length that is not the plan fails; without a plan only the ends, sound and length are checked', async () => {
		expect(check(await runQc(input('good.mp4', { planned_s: 4.5 })), 'length').status).toBe('fail');
		const bare = await runQc(input('good.mp4', { entries: [], planned_s: null, music: null }));
		expect(bare.checks.map((c) => c.id)).toEqual(['picture', 'sound', 'length']);
		expect(bare.status).toBe('pass');
	}, 120_000);
});
