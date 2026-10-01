import { json } from '@sveltejs/kit';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { uuid7ish } from '$lib/domain/ids';
import { pickFor } from '$lib/domain/takes';
import { HOLD_MAX_S, HOLD_MIN_S, holdName, holdPlan } from '$lib/media/hold-plan';
import { getGateway, getProjectRoot, getProjectStore } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';
import { probeMedia } from '$lib/server/media-probe';
import { runFfmpeg } from '$lib/server/ffmpeg';

const requestSchema = z.object({
	expected_version: z.number().int().nonnegative(),
	card_id: idSchema,
	length_s: z.number().min(HOLD_MIN_S).max(HOLD_MAX_S),
	push_in: z.boolean().default(false),
	fade: z.boolean().default(false)
});

const fail = (status: number, message: string) =>
	json({ ok: false, error: { code: 'INVALID_COMMAND', message, retryable: false, source: 'application' } }, { status });

/**
 * Make a Hold (AD-1, AD-3): render the beat's still pick into a video take
 * locally with ffmpeg (no credits), then add it to the same beat as a new
 * take through the gateway. The still stays a take.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	let body: z.infer<typeof requestSchema>;
	try {
		const parsed = requestSchema.safeParse(await request.json());
		if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? 'Invalid hold request');
		body = parsed.data;
	} catch {
		return fail(400, 'Request body is not JSON');
	}

	const project = await getProjectStore().readProject(projectId.data);
	if (!project) return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found', retryable: false, source: 'project-store' } }, { status: 404 });
	const card = project.production.cards.find((entry) => entry.card_id === body.card_id);
	const still = card ? pickFor(project.production, card) : null;
	if (!still || still.kind !== 'image') return fail(400, 'A Hold needs a beat whose pick is a still');

	// Only stills stored in this project's folder can be held (same-origin files route).
	const files = resolve(join(getProjectRoot(), projectId.data, 'files'));
	const prefix = `/api/projects/${projectId.data}/files/`;
	if (!still.url.startsWith(prefix)) return fail(400, 'A Hold needs a still stored in the project folder');
	const input = resolve(join(files, decodeURIComponent(still.url.slice(prefix.length))));
	if (!input.startsWith(files + sep)) return fail(400, 'Still path escapes the project folder');

	const size = still.width && still.height ? { width: still.width, height: still.height } : await probeMedia(input);
	if (!size.width || !size.height) return fail(400, 'Could not read the still (is ffprobe installed?)');

	const takeId = uuid7ish();
	const fileName = `${takeId.slice(-8)}-hold.mp4`;
	const output = join(files, 'board', fileName);
	await mkdir(join(files, 'board'), { recursive: true });
	try {
		await runFfmpeg(holdPlan({ input, output, length_s: body.length_s, push_in: body.push_in, fade: body.fade, width: size.width, height: size.height }));
	} catch (cause) {
		await rm(output, { force: true });
		return json({ ok: false, error: { code: 'RENDER_FAILED', message: cause instanceof Error ? cause.message : 'Hold render failed', retryable: true, source: 'ffmpeg' } }, { status: 502 });
	}
	const probe = await probeMedia(output);
	const outcome = await getGateway().addTake({
		command: 'add_take', project_id: projectId.data, expected_version: body.expected_version, card_id: body.card_id,
		take: {
			asset_id: takeId, kind: 'video', name: holdName(still.name, body), mime_type: 'video/mp4',
			url: `${prefix}board/${encodeURIComponent(fileName)}`, ...probe, created_at: new Date().toISOString()
		}
	});
	if (!outcome.ok) {
		await rm(output, { force: true });
		return json(outcome, { status: commandStatus(outcome.error) });
	}
	return json(outcome);
};
