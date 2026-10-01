import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGateway, getModelSettingsDeps, getProjectStore, resolveProjectModel } from '$lib/server/config';
import { authenticateOperator } from '$lib/server/operator-auth';
import { handleProjectModelChange, projectModelView } from '$lib/server/project-model-handler';

/** The project's Agent model: effective pick, lock state, switch history. */
export const GET: RequestHandler = async ({ params }) => {
	const project = await getProjectStore().readProject(params.projectId);
	if (!project) return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, { status: 404 });
	return json({ ok: true, data: projectModelView(project, await resolveProjectModel(project)) });
};

/** Explicit, operator-attributed model change; after the lock it needs a confirmed reason. */
export const POST: RequestHandler = async ({ params, request }) => {
	const authentication = authenticateOperator(request);
	if (!authentication.ok) {
		return json(
			{ ok: false, error: { code: authentication.status === 401 ? 'UNAUTHORIZED' : 'CAPABILITY_UNAVAILABLE', message: authentication.message, retryable: false, source: 'application' } },
			{ status: authentication.status, ...(authentication.status === 401 && { headers: { 'www-authenticate': 'Bearer realm="operator"' } }) }
		);
	}
	let body: unknown;
	try { body = await request.json(); }
	catch { return json({ ok: false, error: { code: 'INVALID_COMMAND', message: 'Request body is not JSON', retryable: false, source: 'application' } }, { status: 400 }); }
	const result = await handleProjectModelChange(params.projectId, body, {
		gateway: getGateway(),
		settings: getModelSettingsDeps(),
		operator: authentication.operator
	});
	return json(result.body, { status: result.status });
};
