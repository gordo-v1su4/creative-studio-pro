import { json } from '@sveltejs/kit';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { cutsOf } from '$lib/domain/cuts';
import { matchToMusic, type MusicEntry } from '$lib/domain/music';
import { getProjectRoot, getProjectStore } from '$lib/server/config';
import { readOnsetEnvelope } from '$lib/server/audio-envelope';

const requestSchema = z.object({
	cut_id: idSchema,
	entries: z.array(z.object({
		entry_id: idSchema, asset_id: idSchema, in_s: z.number().nonnegative(), out_s: z.number().positive(), duration_s: z.number().positive(),
		speed: z.array(z.object({ x: z.number().min(0).max(1), rate: z.number().min(1).max(4) })).max(64).optional()
	})).min(1).max(200)
});

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : 'INVALID_COMMAND', message, retryable: false, source: 'music' } }, { status });

/**
 * Match to music (V1S-126): read-only. Proposes new in/out points for the
 * entries as the player has them now; the player previews them with the
 * song underneath and saves only when the operator keeps the result.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	let body: z.infer<typeof requestSchema>;
	try {
		const parsed = requestSchema.safeParse(await request.json());
		if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? 'Invalid request');
		body = parsed.data;
	} catch {
		return fail(400, 'Request body is not JSON');
	}
	const project = await getProjectStore().readProject(projectId.data);
	if (!project) return fail(404, 'Project not found');
	const cut = cutsOf(project.production).find((entry) => entry.cut_id === body.cut_id);
	if (!cut) return fail(404, 'Cut not found');
	if (cut.locked) return fail(400, `${cut.name} v${cut.version} is locked; unlock it to match it to music`);
	if (!cut.music) return fail(400, 'Attach a song to this cut first');

	const files = resolve(join(getProjectRoot(), projectId.data, 'files'));
	const prefix = `/api/projects/${projectId.data}/files/`;
	const local = (url: string) => {
		if (!url.startsWith(prefix)) return null;
		const file = resolve(join(files, decodeURIComponent(url.slice(prefix.length))));
		return file.startsWith(files + sep) ? file : null;
	};
	const songFile = local(cut.music.url);
	if (!songFile) return fail(400, 'The song is not stored in the project folder');
	const song = await readOnsetEnvelope(songFile);
	if (!song) return fail(400, 'Could not read the song');

	const entries: MusicEntry[] = [];
	for (const entry of body.entries) {
		const take = project.production.assets.find((asset) => asset.asset_id === entry.asset_id);
		const file = take ? local(take.url) : null;
		let onset: number[] | null = null;
		if (file) { try { onset = await readOnsetEnvelope(file); } catch { onset = null; } }
		entries.push({ entry_id: entry.entry_id, in_s: entry.in_s, out_s: entry.out_s, speed: entry.speed, duration_s: entry.duration_s, onset });
	}
	return json({ ok: true, data: matchToMusic({ onset: song, beats: cut.music.beats }, entries) });
};
