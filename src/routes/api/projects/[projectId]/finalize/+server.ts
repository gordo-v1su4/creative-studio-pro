import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema, linkDraftJobsCommandSchema } from '$lib/domain/schemas';
import { getAnimateDeps } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';
import { quoteFinalize, sendFinalize } from '$lib/server/animate';

const takeIds = z.array(idSchema).min(1).max(500);

const requestSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('quote'), take_ids: takeIds }),
	z.object({ action: z.literal('send'), take_ids: takeIds, expected_version: z.number().int().nonnegative(), confirmed_credits: z.number().nonnegative() }),
	z.object({ action: z.literal('link'), expected_version: z.number().int().nonnegative(), links: linkDraftJobsCommandSchema.shape.links })
]);

const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
	json({ ok: false, error: { code, message, retryable: status >= 500, source: 'finalize', ...extra } }, { status });

/**
 * Finalize drafts to 1080p (V1S-124). quote: price the takes, nothing is
 * created; send: re-quote, refuse on a higher price or a short balance, then
 * submit; link: record which draft job existing takes came from.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'INVALID_COMMAND', 'Invalid project id');
	let body: z.infer<typeof requestSchema>;
	try {
		const parsed = requestSchema.safeParse(await request.json());
		if (!parsed.success) return fail(400, 'INVALID_COMMAND', parsed.error.issues[0]?.message ?? 'Invalid Finalize request');
		body = parsed.data;
	} catch {
		return fail(400, 'INVALID_COMMAND', 'Request body is not JSON');
	}
	const deps = await getAnimateDeps();

	if (body.action === 'link') {
		const linked = await deps.gateway.linkDraftJobs({ command: 'link_draft_jobs', project_id: projectId.data, expected_version: body.expected_version, links: body.links });
		return linked.ok ? json({ ok: true, data: linked.data }) : json(linked, { status: commandStatus(linked.error) });
	}
	if (body.action === 'send') {
		const sent = await sendFinalize(deps, { project_id: projectId.data, expected_version: body.expected_version, take_ids: body.take_ids, confirmed_credits: body.confirmed_credits });
		return sent.ok ? json({ ok: true, data: sent.project, quote: sent.quote }) : fail(sent.status, sent.code, sent.message, { reasons: sent.reasons ?? [] });
	}

	// quote
	const project = await deps.store.readProject(projectId.data);
	if (!project) return fail(404, 'NOT_FOUND', 'Project not found');
	const quoted = await quoteFinalize(deps, project, body.take_ids);
	return quoted.ok ? json({ ok: true, data: quoted.quote }) : fail(quoted.status, quoted.code, quoted.message);
};
