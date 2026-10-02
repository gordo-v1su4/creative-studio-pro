import { json } from '@sveltejs/kit';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema, soundPlanSchema } from '$lib/domain/schemas';
import { uuid7ish } from '$lib/domain/ids';
import { safeFileName } from '$lib/domain/media';
import { getGateway, getProjectRoot, getProjectStore } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';
import { buildMix } from '$lib/server/sound';

const AUDIO = /\.(mp3|wav|m4a|aac|flac|ogg|opus|aif|aiff)$/i;
const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : 'INVALID_COMMAND', message, retryable: status >= 500, source: 'sound' } }, { status });

const requestSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('save'), cut_id: idSchema, version: z.number().int().positive(), expected_version: z.number().int().nonnegative(), plan: soundPlanSchema }),
	z.object({ action: z.literal('build'), cut_id: idSchema, version: z.number().int().positive() })
]);

/**
 * Sound stage (V1S-128). JSON: save a locked version's sound plan, or build
 * its mix. Raw body with ?name=: store a sound file (ambience or effect)
 * under files/sound/ and return its URL.
 */
export const POST: RequestHandler = async ({ params, request, url }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');

	const upload = url.searchParams.get('name');
	if (upload !== null) {
		if (!AUDIO.test(upload)) return fail(415, `${upload || 'That file'} is not a sound file (mp3, wav, m4a, aac, flac, ogg, aiff)`);
		if (!request.body) return fail(400, 'Empty upload');
		const fileName = `${uuid7ish().slice(-8)}-${safeFileName(upload)}`;
		const folder = join(getProjectRoot(), projectId.data, 'files', 'sound');
		await mkdir(folder, { recursive: true });
		try {
			await pipeline(Readable.fromWeb(request.body as unknown as WebReadableStream<Uint8Array>), createWriteStream(join(folder, fileName)));
		} catch {
			await rm(join(folder, fileName), { force: true });
			return fail(400, 'Upload was interrupted');
		}
		return json({ ok: true, data: { url: `/api/projects/${projectId.data}/files/sound/${encodeURIComponent(fileName)}`, name: upload } });
	}

	let body: z.infer<typeof requestSchema>;
	try {
		const parsed = requestSchema.safeParse(await request.json());
		if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? 'Invalid sound request');
		body = parsed.data;
	} catch {
		return fail(400, 'Request body is not JSON');
	}
	const gateway = getGateway();
	if (body.action === 'save') {
		const saved = await gateway.setSoundPlan({ command: 'set_sound_plan', project_id: projectId.data, expected_version: body.expected_version, cut_id: body.cut_id, version: body.version, plan: body.plan });
		return saved.ok ? json(saved) : json(saved, { status: commandStatus(saved.error) });
	}
	const built = await buildMix({ gateway, store: getProjectStore(), projectRoot: getProjectRoot() }, projectId.data, body.cut_id, body.version);
	return built.ok ? json({ ok: true, data: built.project }) : fail(built.status, built.message);
};
