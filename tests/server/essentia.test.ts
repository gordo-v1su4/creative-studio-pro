import { describe, expect, test } from 'bun:test';
import { getSongJob, needsGpu, parseStudioResult, studioJobOf } from '../../src/lib/server/essentia';

const result = (extra: Record<string, unknown> = {}) => ({
	schema_version: 'studio-audio-v1', duration: 10, bpm: 120.04, confidence: 3.5, beats: [0.5, 1, 1.5], onsets: [0.1],
	energy: { curve: [0.1, 0.4, 0.2], sample_rate_hz: 0.3, start_time_s: 0 },
	structure: { source: 'allin1', analyzed_duration_s: 10, boundaries: [0, 4, 10], provenance: { status: 'detected', method: 'allin1', device: 'cuda' },
		sections: [{ start: 0, end: 4, duration: 4, label: 'Intro', original_label: 'intro', energy: 0.3 }, { start: 4, end: 10, duration: 6, label: 'chorus', original_label: 'chorus', energy: 0.8 }] },
	...extra
});

describe('Essentia song analysis', () => {
	test('a studio-audio-v1 result becomes beats, labelled sections and an energy curve', () => {
		const analysis = parseStudioResult(result());
		expect(analysis.bpm).toBe(120);
		expect(analysis.beats).toEqual([0.5, 1, 1.5]);
		expect(analysis.sections).toEqual([{ start: 0, end: 4, label: 'intro', energy: 0.3 }, { start: 4, end: 10, label: 'chorus', energy: 0.8 }]);
		expect(analysis.energy.curve).toEqual([0.1, 0.4, 0.2]);
	});

	test('guessed, overlapping or out-of-order results are refused, never patched up', () => {
		expect(() => parseStudioResult(result({ schema_version: 'other' }))).toThrow();
		expect(() => parseStudioResult(result({ beats: [1, 0.5] }))).toThrow('out of order');
		expect(() => parseStudioResult({ ...result(), structure: { ...result().structure, source: 'fallback' } })).toThrow('guessed');
		expect(() => parseStudioResult({ ...result(), structure: { ...result().structure, sections: [{ start: 0, end: 5, label: 'a', energy: 0.1 }, { start: 3, end: 10, label: 'b', energy: 0.1 }] } })).toThrow('overlap');
	});

	test('job envelopes: running, completed, failed; no GPU is told apart', async () => {
		expect(studioJobOf({ id: 'j1', status: 'running', stage: 'structure' })).toEqual({ status: 'running', id: 'j1', stage: 'structure' });
		expect(studioJobOf({ id: 'j1', status: 'completed', stage: 'done', result: result() }).status).toBe('completed');
		const failed = studioJobOf({ id: 'j1', status: 'failed', stage: 'x', error: { code: 'cuda_unavailable', message: 'Studio requires usable CUDA' } });
		expect(failed).toEqual({ status: 'failed', id: 'j1', error: 'cuda_unavailable: Studio requires usable CUDA' });
		expect(needsGpu(failed.status === 'failed' ? failed.error : '')).toBeTrue();
		const calls: Array<{ url: string; key: string | null }> = [];
		const fake = async (url: string, init?: RequestInit) => { calls.push({ url, key: new Headers(init?.headers).get('x-api-key') }); return new Response(JSON.stringify({ id: 'j1', status: 'queued', stage: 'queued' })); };
		expect((await getSongJob({ url: 'https://essentia.example/', key: 'k' }, 'j1', fake)).status).toBe('queued');
		expect(calls).toEqual([{ url: 'https://essentia.example/analyze/studio/jobs/j1', key: 'k' }]);
	});
});
