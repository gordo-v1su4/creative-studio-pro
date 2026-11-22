import { describe, expect, test } from 'bun:test';
import {
	bestOffset, dialogueMatch, finishReport, lengthCheck, offsetItem, parseLoudness, parseSilences, qcHeadline, qcNotes, soundCheck, timecode
} from '../../src/lib/domain/qc';
import { qcEntries } from '../../src/lib/server/qc-cut';
import type { Project } from '../../src/lib/domain/schemas';

const EBUR = `[Parsed_silencedetect_0 @ 0] silence_start: 2
[Parsed_silencedetect_0 @ 0] silence_end: 3 | silence_duration: 1
[Parsed_silencedetect_0 @ 0] silence_start: 9.5
[Parsed_ebur128_1 @ 0] Summary:

  Integrated loudness:
    I:         -14.2 LUFS
    Threshold: -24.3 LUFS

  True peak:
    Peak:       -1.3 dBFS`;

describe('measurements', () => {
	test('silencedetect spans, an open one running to the end', () => {
		expect(parseSilences(EBUR, 10)).toEqual([{ start: 2, end: 3 }, { start: 9.5, end: 10 }]);
	});
	test('ebur128 summary: integrated loudness and true peak', () => {
		expect(parseLoudness(EBUR)).toEqual({ lufs: -14.2, peak_db: -1.3 });
		expect(parseLoudness('nothing')).toEqual({ lufs: null, peak_db: null });
	});
	test('timecodes are m:ss.cc', () => {
		expect(timecode(78.18)).toBe('1:18.18');
		expect(timecode(45.183)).toBe('0:45.18');
	});
});

describe('cross-correlation', () => {
	const noise = (n: number, seed: number) => { let s = seed; return Float32Array.from({ length: n }, () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 - 0.5; }); };
	test('finds where a stretch sits, with a near-perfect match', () => {
		const hay = noise(4000, 3);
		const found = bestOffset(hay, hay.subarray(1234, 2234));
		expect(found.offset).toBe(1234);
		expect(found.score).toBeGreaterThan(0.99);
	});
	test('still finds it under another sound', () => {
		const take = noise(4000, 3), song = noise(4000, 9);
		const mix = take.map((v, i) => v * 0.6 + song[i] * 0.4);
		const found = bestOffset(mix.subarray(800), take.subarray(1000, 2000));
		expect(found.offset).toBe(200);
		expect(found.score).toBeGreaterThan(0.7);
	});
	test('silence matches nothing', () => {
		expect(bestOffset(noise(2000, 1), new Float32Array(500)).score).toBe(0);
	});
});

describe('verdicts', () => {
	test('lip sync: within 40 ms passes, over fails on a dialogue shot and warns otherwise, a weak match only warns', () => {
		const base = { title: '03 Mara', at_s: 10, score: 0.9, limit_s: 0.04, what: 'dialogue' };
		expect(offsetItem({ ...base, offset_s: 0.012, strict: true }).status).toBe('pass');
		const late = offsetItem({ ...base, offset_s: 0.1, strict: true });
		expect(late.status).toBe('fail');
		expect(late.message).toContain('+100 ms (late, over 40 ms)');
		expect(offsetItem({ ...base, offset_s: 0.1, strict: false }).status).toBe('warn');
		expect(offsetItem({ ...base, offset_s: 0.1, strict: true, score: 0.2 }).status).toBe('warn');
		expect(offsetItem({ ...base, offset_s: 0, strict: true, score: 0.1 }).message).toContain('not found');
	});
	test('sound: gaps warn with their timecodes, a silent cut fails, no audio fails, hot peaks warn', () => {
		const ok = soundCheck({ has_audio: true, duration_s: 60, silences: [{ start: 2, end: 2.3 }], lufs: -14, peak_db: -1 });
		expect(ok.status).toBe('pass');
		expect(ok.summary).toBe('-14.0 LUFS, peak -1.0 dBTP; no gaps');
		const gap = soundCheck({ has_audio: true, duration_s: 60, silences: [{ start: 44, end: 45.2 }], lufs: -14, peak_db: -0.1 });
		expect(gap.status).toBe('warn');
		expect(gap.items.map((i) => i.message)).toEqual(['Silence 0:44.00–0:45.20 (1.20 s under -45 dB)', 'True peak -0.1 dBTP (over −0.5)']);
		expect(soundCheck({ has_audio: true, duration_s: 10, silences: [{ start: 0, end: 10 }], lufs: null, peak_db: null }).status).toBe('fail');
		expect(soundCheck({ has_audio: false, duration_s: 10, silences: [], lufs: null, peak_db: null }).status).toBe('fail');
	});
	test('length: within one frame passes, two frames off fails, a sound tail warns', () => {
		expect(lengthCheck({ video_s: 10.04, audio_s: 10.04, planned_s: 10, fps: 24 }).status).toBe('pass');
		const off = lengthCheck({ video_s: 10.1, audio_s: 10.1, planned_s: 10, fps: 24 });
		expect(off.status).toBe('fail');
		expect(off.items[0].message).toContain('(2 frames)');
		expect(lengthCheck({ video_s: 10, audio_s: 10.5, planned_s: 10, fps: 24 }).status).toBe('warn');
	});
	test('dialogue heard: share of the written words', () => {
		expect(dialogueMatch("It's nice to see you again.", 'its nice to see you')).toBeCloseTo(5 / 6);
		expect(dialogueMatch("It's nice to see you again.", "it's nice to see you again")).toBe(1);
		expect(dialogueMatch('Hello there', '')).toBe(0);
	});
	test('the report: worst check wins; notes list the headline, each check, then what is not a pass', () => {
		const report = finishReport({ at: '2026-11-22T00:00:00Z', file: 'cut.mp4', duration_s: 60, checks: [
			soundCheck({ has_audio: true, duration_s: 60, silences: [{ start: 44, end: 45.2 }], lufs: -14, peak_db: -1 }),
			lengthCheck({ video_s: 60, audio_s: 60, planned_s: 60, fps: 24 })
		] });
		expect(report.status).toBe('warn');
		expect(qcHeadline(report)).toBe('QC WARN · sound present warn');
		expect(qcNotes(report).split('\n')).toEqual([
			'QC WARN · sound present warn',
			'WARN Sound present: -14.0 LUFS, peak -1.0 dBTP; 1 gap over 0.6 s',
			'PASS Length: 60.00 s · plan 60.00 s',
			'! 0:44.00 Silence 0:44.00–0:45.20 (1.20 s under -45 dB)'
		]);
	});
});

describe('QC entries of a locked version', () => {
	test('picture starts in whole frames, the plan unrounded; takes, ramps and dialogue carried', () => {
		const project = { production: {
			cards: [{ card_id: 'a', title: 'Hall', source: { dialogue: "It's nice to see you again." } }, { card_id: 'b', title: 'Run' }],
			assets: [{ asset_id: 'ta', kind: 'video', url: '/p/ta.mp4' }, { asset_id: 'tb', kind: 'video', url: '/p/tb.mp4' }]
		} } as unknown as Project;
		const { entries, planned_s } = qcEntries(project, { entries: [
			{ entry_id: '1', card_id: 'a', asset_id: 'ta', in_s: 1, out_s: 2.01 },
			{ entry_id: '2', card_id: 'b', asset_id: 'tb', in_s: 0, out_s: 4, speed: [{ x: 0, rate: 2 }, { x: 1, rate: 2 }] }
		] }, (url) => `C:${url}`);
		expect(entries[0]).toEqual({ title: '01 Hall', at_s: 0, length_s: 24 / 24, planned_at_s: 0, take: { file: 'C:/p/ta.mp4', in_s: 1 }, ramped: false, dialogue: "It's nice to see you again." });
		expect(entries[1].at_s).toBe(1);
		expect(entries[1].planned_at_s).toBeCloseTo(1.01);
		expect(entries[1].ramped).toBe(true);
		expect(planned_s).toBe(3);
	});
});
