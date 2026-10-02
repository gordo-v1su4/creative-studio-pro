import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGateway, getProjectRoot } from '$lib/server/config';
import { syncBriefToRules } from '$lib/server/brief';
import { commandStatus } from '$lib/server/http';
import { authenticateOperator } from '$lib/server/operator-auth';
import { handleBriefLockRequest } from '$lib/server/brief-lock-handler';

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
	try { return await request.json() as Record<string, unknown>; } catch { return null; }
}

export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = await readBody(request);
	if (!body) return json({ ok: false, error: { code: 'INVALID_COMMAND', message: 'Request body is not JSON', retryable: false, source: 'application' } }, { status: 400 });
	const outcome = await getGateway().saveBrief({ ...body, command: 'save_brief', project_id: params.projectId });
	if (!outcome.ok) return json(outcome, { status: commandStatus(outcome.error) });
	// The rules file is the source the Agent and the linter read: tone and must-nots go there too.
	const saved = outcome.data.brief_state.versions.at(-1);
	const rulesFile = saved ? await syncBriefToRules(getProjectRoot(), params.projectId, saved).catch(() => null) : null;
	return json({ ...outcome, rules_file: rulesFile });
};

export const POST: RequestHandler = async ({ params, request }) => {
	return handleBriefLockRequest(request, params.projectId, { gateway: getGateway(), authenticate: authenticateOperator });
};
