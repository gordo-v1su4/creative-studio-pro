import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { getProjectStore, resolveProjectModel } from '$lib/server/config';
import { AgentRuleBreakError, createOpenAICompatibleClient } from '$lib/server/model-provider';
import { scorePrompt } from '$lib/server/score-prompt';

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : 'INVALID_COMMAND', message, retryable: status >= 500, source: 'score' } }, { status });

/** V1S-378: GhostSuno's three Suno fields for a cut. Text only; nothing is sent anywhere. */
export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	const body = z.object({ cut_id: idSchema }).safeParse(await request.json().catch(() => null));
	if (!body.success) return fail(400, 'Send the cut id');
	const project = await getProjectStore().readProject(projectId.data);
	if (!project) return fail(404, 'Project not found');
	const resolved = await resolveProjectModel(project);
	if (!resolved.ok) return fail(503, `No Agent model: ${resolved.message}`);
	try {
		const score = await scorePrompt(createOpenAICompatibleClient(resolved.connection), project, body.data.cut_id);
		return score ? json({ ok: true, data: score }) : fail(404, 'That cut is not in this project');
	} catch (cause) {
		return fail(cause instanceof AgentRuleBreakError ? 422 : 502, cause instanceof Error ? cause.message : 'The Agent could not write the score prompt');
	}
};
