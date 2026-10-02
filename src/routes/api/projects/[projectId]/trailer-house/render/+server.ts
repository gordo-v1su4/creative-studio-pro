import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { getAnimateDeps } from '$lib/server/config';
import { addTeaserToBoard, pollTeasers, quoteTeaser, sendTeaser } from '$lib/server/teaser-render';

const settingsSchema = z.object({ resolution: z.enum(['480p', '720p', '1080p']), generate_audio: z.boolean() });
const version = z.number().int().nonnegative();
const bodySchema = z.discriminatedUnion('action', [
	// The price (free; nothing is created).
	z.object({ action: z.literal('quote'), settings: settingsSchema }),
	// Send for exactly the confirmed price.
	z.object({ action: z.literal('send'), expected_version: version, settings: settingsSchema, confirmed_credits: z.number().nonnegative() }),
	// Check pending renders; finished clips come back into the project.
	z.object({ action: z.literal('poll') }),
	// Put a finished clip on the board as a take, in the Teasers group.
	z.object({ action: z.literal('board'), expected_version: version, request_id: z.string().min(1).max(200) })
]);

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : status === 409 ? 'VERSION_CONFLICT' : status === 422 ? 'GATE_BLOCKED' : 'INVALID_COMMAND', message, retryable: status >= 500, source: 'teaser-render' } }, { status });

/** Trailer House teaser → Seedance (Higgsfield CLI) → back into the project. Priced and confirmed before any spend. */
export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	const body = bodySchema.safeParse(await request.json().catch(() => null));
	if (!body.success) return fail(400, body.error.issues[0]?.message ?? 'Invalid request');
	const deps = await getAnimateDeps();
	const action = body.data;

	if (action.action === 'quote') {
		const project = await deps.store.readProject(projectId.data);
		if (!project) return fail(404, 'Project not found');
		const quote = await quoteTeaser(deps, project, action.settings);
		return quote.ok ? json(quote) : fail(quote.status, quote.message);
	}
	const result = action.action === 'send'
		? await sendTeaser(deps, { project_id: projectId.data, expected_version: action.expected_version, settings: action.settings, confirmed_credits: action.confirmed_credits })
		: action.action === 'poll'
			? await pollTeasers(deps, projectId.data)
			: await addTeaserToBoard(deps, { project_id: projectId.data, expected_version: action.expected_version, request_id: action.request_id });
	return result.ok ? json({ ok: true, data: result.project }) : fail(result.status, result.message);
};
