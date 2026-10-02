import { json } from '@sveltejs/kit';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { uuid7ish } from '$lib/domain/ids';
import { safeFileName } from '$lib/domain/media';
import { beatGrid, ENVELOPE_HZ, hasSignal } from '$lib/domain/music';
import { getGateway, getProjectRoot } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';
import { readOnsetEnvelope } from '$lib/server/audio-envelope';

const AUDIO = /\.(mp3|wav|m4a|aac|flac|ogg|opus|aif|aiff)$/i;
const fail = (status: number, message: string) => json({ ok: false, error: { code: 'INVALID_COMMAND', message, retryable: false, source: 'music' } }, { status });

/**
 * Attach a song to a cut (V1S-126). The raw body is the audio file (name in
 * ?name=). It is stored under files/music/, its beat grid is computed in
 * code, and it is set on the cut (?cut_id=, ?expected_version=).
 */
export const POST: RequestHandler = async ({ params, request, url }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	const name = url.searchParams.get('name') ?? '';
	if (!AUDIO.test(name)) return fail(415, `${name || 'That file'} is not a song file (mp3, wav, m4a, aac, flac, ogg, aiff)`);
	const cutId = idSchema.safeParse(url.searchParams.get('cut_id'));
	if (!cutId.success) return fail(400, 'cut_id is required');
	const expectedVersion = Number(url.searchParams.get('expected_version'));
	if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return fail(400, 'expected_version is required');
	if (!request.body) return fail(400, 'Empty upload');

	const fileName = `${uuid7ish().slice(-8)}-${safeFileName(name)}`;
	const folder = join(getProjectRoot(), projectId.data, 'files', 'music');
	const target = join(folder, fileName);
	await mkdir(folder, { recursive: true });
	try {
		await pipeline(Readable.fromWeb(request.body as unknown as WebReadableStream<Uint8Array>), createWriteStream(target));
	} catch {
		await rm(target, { force: true });
		return fail(400, 'Upload was interrupted');
	}

	let onset: number[] | null;
	try { onset = await readOnsetEnvelope(target); } catch (cause) {
		await rm(target, { force: true });
		return fail(400, cause instanceof Error ? cause.message : 'Could not read the song');
	}
	if (!hasSignal(onset)) {
		await rm(target, { force: true });
		return fail(400, `${name} has no audible audio`);
	}
	const grid = beatGrid(onset);
	const outcome = await getGateway().setCutMusic({
		command: 'set_cut_music', project_id: projectId.data, expected_version: expectedVersion, cut_id: cutId.data,
		music: { url: `/api/projects/${projectId.data}/files/music/${encodeURIComponent(fileName)}`, name, duration_s: Math.round((onset.length / ENVELOPE_HZ) * 1000) / 1000, bpm: grid.bpm, beats: grid.beats }
	});
	if (!outcome.ok) {
		await rm(target, { force: true });
		return json(outcome, { status: commandStatus(outcome.error) });
	}
	return json(outcome);
};
