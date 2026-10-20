import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { getGateway, getProjectRoot, getProjectStore, getReviewRoomConfig } from '$lib/server/config';
import { runFfmpeg } from '$lib/server/ffmpeg';
import { probeMedia } from '$lib/server/media-probe';
import { attachPreviousFrame, lastFrameArgs, upscaleArgs } from '$lib/server/previous-frame';
import { createReviewRoomClient } from '$lib/server/review-room';

const requestSchema = z.object({ action: z.literal('previous_frame'), card_id: idSchema, expected_version: z.number().int().nonnegative() });
const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : status === 409 ? 'VERSION_CONFLICT' : 'INVALID_COMMAND', message, retryable: status >= 500, source: 'references' } }, { status });

/** A shot's references that need the server (V1S-328): the previous shot's last frame, taken from Review Room. */
export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	const parsed = requestSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? 'Invalid request');
	const config = getReviewRoomConfig();
	const result = await attachPreviousFrame({
		store: getProjectStore(), gateway: getGateway(), projectRoot: getProjectRoot(),
		client: config ? createReviewRoomClient(config) : null, probe: probeMedia,
		lastFrame: (source, output) => runFfmpeg(lastFrameArgs(source, output)),
		upscale: (input, output, longEdge) => runFfmpeg(upscaleArgs(input, output, longEdge))
	}, { project_id: projectId.data, card_id: parsed.data.card_id, expected_version: parsed.data.expected_version });
	if (!result.ok) return fail(result.status, result.message);
	return json({ ok: true, data: result.project });
};
