import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGateway } from '$lib/server/config';
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
	return json(outcome, { status: outcome.ok ? 200 : commandStatus(outcome.error) });
};

export const POST: RequestHandler = async ({ params, request }) => {
	return handleBriefLockRequest(request, params.projectId, { gateway: getGateway(), authenticate: authenticateOperator });
};
