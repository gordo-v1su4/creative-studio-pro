import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { getProjectRoot, getProjectStore, resolveProjectModel } from '$lib/server/config';
import { createOpenAICompatibleClient } from '$lib/server/model-provider';
import { projectRules } from '$lib/server/animate';
import { draftBrief } from '$lib/server/brief';

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : 'INVALID_COMMAND', message, retryable: status >= 500, source: 'brief' } }, { status });

/** "Draft brief" (V1S-132): the Agent fills the brief's fields for the operator to review; nothing is saved here. */
export const POST: RequestHandler = async ({ params }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	const project = await getProjectStore().readProject(projectId.data);
	if (!project) return fail(404, 'Project not found');
	const resolved = await resolveProjectModel(project);
	if (!resolved.ok) return fail(503, `No Agent model: ${resolved.message}`);
	try {
		const draft = await draftBrief(createOpenAICompatibleClient(resolved.connection), project, await projectRules(getProjectRoot(), projectId.data));
		return json({ ok: true, data: draft });
	} catch (cause) {
		return fail(502, `The Agent couldn't draft the brief: ${cause instanceof Error ? cause.message : 'model error'}`);
	}
};
