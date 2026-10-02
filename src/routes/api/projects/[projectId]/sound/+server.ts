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
import { getGateway, getProjectRoot, getProjectStore, getSfxFolder, getSfxGenerator, resolveProjectModel } from '$lib/server/config';
import { createOpenAICompatibleClient } from '$lib/server/model-provider';
import { projectRules } from '$lib/server/animate';
import { generateEffect, proposeEffects, quoteEffect } from '$lib/server/effects';
import { commandStatus } from '$lib/server/http';
import { buildMix } from '$lib/server/sound';
import { exportCut } from '$lib/server/export';

const AUDIO = /\.(mp3|wav|m4a|aac|flac|ogg|opus|aif|aiff)$/i;
const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : 'INVALID_COMMAND', message, retryable: status >= 500, source: 'sound' } }, { status });

const requestSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('save'), cut_id: idSchema, version: z.number().int().positive(), expected_version: z.number().int().nonnegative(), plan: soundPlanSchema }),
	z.object({ action: z.literal('build'), cut_id: idSchema, version: z.number().int().positive() }),
	z.object({ action: z.literal('propose'), cut_id: idSchema, version: z.number().int().positive() }),
	z.object({ action: z.literal('export'), cut_id: idSchema, version: z.number().int().positive() }),
	z.object({ action: z.literal('quote_effect'), prompt: z.string().min(3).max(300), duration_s: z.number().min(0.5).max(5) }),
	z.object({
		action: z.literal('generate_effect'), cut_id: idSchema, version: z.number().int().positive(), prompt: z.string().min(3).max(300),
		duration_s: z.number().min(0.5).max(5), at_s: z.number().nonnegative(), confirmed_credits: z.number().nonnegative()
	})
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
	const deps = { gateway, store: getProjectStore(), projectRoot: getProjectRoot() };
	if (body.action === 'propose') {
		const project = await deps.store.readProject(projectId.data);
		if (!project) return fail(404, 'Project not found');
		const resolved = await resolveProjectModel(project);
		if (!resolved.ok) return fail(503, `No Agent model: ${resolved.message}`);
		const proposed = await proposeEffects(deps, createOpenAICompatibleClient(resolved.connection), { projectId: projectId.data, cutId: body.cut_id, version: body.version, folder: await getSfxFolder(), rules: await projectRules(deps.projectRoot, projectId.data) });
		return proposed.ok ? json({ ok: true, data: proposed.project, offers: proposed.offers, dropped: proposed.dropped, moments: proposed.moments }) : fail(proposed.status, proposed.message);
	}
	if (body.action === 'export') {
		const exported = await exportCut(deps, projectId.data, body.cut_id, body.version);
		return exported.ok ? json({ ok: true, data: exported.project, folder: exported.folder }) : fail(exported.status, exported.message);
	}
	if (body.action === 'quote_effect') {
		const quoted = await quoteEffect(getSfxGenerator(), body);
		return quoted.ok ? json({ ok: true, data: { credits: quoted.credits } }) : fail(quoted.status, quoted.message);
	}
	if (body.action === 'generate_effect') {
		const made = await generateEffect({ ...deps, generator: getSfxGenerator(), download: async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`Download failed: ${r.status}`); return new Uint8Array(await r.arrayBuffer()); } }, { projectId: projectId.data, cutId: body.cut_id, version: body.version, prompt: body.prompt, duration_s: body.duration_s, at_s: body.at_s, confirmed_credits: body.confirmed_credits });
		return made.ok ? json({ ok: true, data: made.project }) : fail(made.status, made.message);
	}
	const built = await buildMix(deps, projectId.data, body.cut_id, body.version);
	return built.ok ? json({ ok: true, data: built.project }) : fail(built.status, built.message);
};
