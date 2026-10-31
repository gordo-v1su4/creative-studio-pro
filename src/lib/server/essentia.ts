import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { z } from 'zod';

/**
 * Song analysis on the operator's Essentia service (Studio jobs, the `studio-audio-v1` contract that
 * beatsmaxxer-pro and music-video-vending-machine read too): upload the song once, poll the job, and get its
 * beats, an energy curve and labelled sections (allin1: intro, verse, chorus, bridge, outro). A result that
 * isn't complete is refused, never patched up.
 */
export interface EssentiaConfig { url: string; key: string }

export interface SongSection { start: number; end: number; label: string; energy: number }
export interface SongAnalysis {
	bpm: number;
	beats: number[];
	sections: SongSection[];
	/** The energy curve, at most 2000 points. */
	energy: { curve: number[]; sample_rate_hz: number; start_time_s: number };
	duration_s: number;
}

export type StudioJob =
	| { status: 'queued' | 'running'; id: string; stage: string }
	| { status: 'completed'; id: string; analysis: SongAnalysis }
	| { status: 'failed'; id: string; error: string };

const finite = z.number().finite();
const studioSchema = z.object({
	schema_version: z.literal('studio-audio-v1'),
	duration: finite.positive(),
	bpm: finite.nonnegative(),
	beats: z.array(finite.nonnegative()).max(50_000),
	energy: z.object({ curve: z.array(finite).min(1).max(1_000_000), sample_rate_hz: finite.positive(), start_time_s: finite.nonnegative() }),
	structure: z.object({
		source: z.string(),
		sections: z.array(z.object({ start: finite.nonnegative(), end: finite.positive(), label: z.string(), energy: finite.min(0).max(1) })).min(1).max(200)
	})
});

const r3 = (s: number) => Math.round(s * 1000) / 1000;

/** The studio-audio-v1 result as the app keeps it; throws on anything incomplete or out of order. */
export function parseStudioResult(raw: unknown): SongAnalysis {
	const result = studioSchema.parse(raw);
	if (result.structure.source === 'fallback') throw new Error('Essentia returned guessed sections, not detected ones');
	for (let i = 1; i < result.beats.length; i++) if (result.beats[i] <= result.beats[i - 1]) throw new Error('Essentia beats are out of order');
	const sections = result.structure.sections.map((s) => ({ start: r3(s.start), end: r3(s.end), label: s.label.trim().toLowerCase() || 'section', energy: Math.round(s.energy * 1000) / 1000 }));
	for (let i = 0; i < sections.length; i++) {
		if (sections[i].end <= sections[i].start) throw new Error('An Essentia section has no length');
		if (i && sections[i].start < sections[i - 1].end - 0.05) throw new Error('Essentia sections overlap');
	}
	const { curve, sample_rate_hz, start_time_s } = result.energy;
	const step = Math.ceil(curve.length / 2000);
	const thinned = step > 1 ? curve.filter((_, i) => i % step === 0) : curve;
	return {
		bpm: Math.round(result.bpm * 10) / 10,
		beats: result.beats.filter((b) => b < result.duration).map(r3),
		sections,
		energy: { curve: thinned.map((v) => Math.round(v * 10000) / 10000), sample_rate_hz: sample_rate_hz / step, start_time_s },
		duration_s: r3(result.duration)
	};
}

/** A job envelope from Essentia as a StudioJob. */
export function studioJobOf(raw: unknown): StudioJob {
	const job = z.object({ id: z.string().min(1), status: z.enum(['queued', 'running', 'completed', 'failed']), stage: z.string().default(''), result: z.unknown().optional(), error: z.object({ code: z.string().optional(), message: z.string().optional() }).nullable().optional() }).parse(raw);
	if (job.status === 'completed') return { status: 'completed', id: job.id, analysis: parseStudioResult(job.result) };
	if (job.status === 'failed') return { status: 'failed', id: job.id, error: [job.error?.code, job.error?.message].filter(Boolean).join(': ') || 'Essentia analysis failed' };
	return { status: job.status, id: job.id, stage: job.stage };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function call(config: EssentiaConfig, path: string, init: RequestInit, fetchImpl: FetchLike, timeoutMs: number): Promise<unknown> {
	const response = await fetchImpl(`${config.url.replace(/\/+$/, '')}${path}`, { ...init, headers: { ...(init.headers ?? {}), 'X-API-Key': config.key, 'User-Agent': 'Creative-Studio-Pro/1.0' }, signal: AbortSignal.timeout(timeoutMs) });
	const text = await response.text();
	let body: unknown = null;
	try { body = text ? JSON.parse(text) : null; } catch { body = text; }
	if (!response.ok) {
		const detail = body && typeof body === 'object' && 'detail' in body ? JSON.stringify((body as { detail: unknown }).detail) : String(text).slice(0, 200);
		throw new Error(`Essentia ${response.status}: ${detail}`);
	}
	return body;
}

const AUDIO_TYPES: Record<string, string> = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.aif': 'audio/aiff', '.aiff': 'audio/aiff' };

/** The song as Essentia gets it: the original file with its real type (Essentia takes WAV, MP3, FLAC, OGG, M4A, AAC, AIFF), nothing re-encoded. */
async function songUpload(file: string): Promise<{ bytes: Uint8Array; type: string; name: string }> {
	const ext = extname(file).toLowerCase();
	return { bytes: new Uint8Array(await readFile(file)), type: AUDIO_TYPES[ext] ?? 'application/octet-stream', name: `song${ext || '.wav'}` };
}

/**
 * Submit a song as a new Studio job. Each attempt gets its own idempotency key (the song's hash plus the
 * attempt): Essentia keeps a failed job under its key and never runs it again, so a retry needs a new one.
 */
export async function submitSong(config: EssentiaConfig, file: string, fetchImpl: FetchLike = fetch, attempt: string = randomUUID().slice(0, 8)): Promise<StudioJob> {
	const { bytes, type, name } = await songUpload(file);
	const form = new FormData();
	form.set('file', new Blob([bytes as Uint8Array<ArrayBuffer>], { type }), name);
	const key = `csp-${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}-${attempt}`;
	return studioJobOf(await call(config, '/analyze/studio/jobs', { method: 'POST', body: form, headers: { 'Idempotency-Key': key } }, fetchImpl, 180_000));
}

/** Studio jobs need a GPU (allin1); this is how they say there is none. */
export const needsGpu = (error: string) => /cuda/i.test(error);

export async function getSongJob(config: EssentiaConfig, jobId: string, fetchImpl: FetchLike = fetch): Promise<StudioJob> {
	return studioJobOf(await call(config, `/analyze/studio/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' }, fetchImpl, 60_000));
}
