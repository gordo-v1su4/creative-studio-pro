import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGateway, getOperatorId, getProjectStore, resolveStageAgent } from '$lib/server/config';
import { handleStageAgent } from '$lib/server/stage-agent-handler';

export const POST: RequestHandler = async ({ params, request }) => {
	let body: unknown;
	try { body = await request.json(); }
	catch { return json({ ok: false, error: { code: 'INVALID_COMMAND', message: 'Request body is not JSON', retryable: false, source: 'stage-agent' } }, { status: 400 }); }
	const result = await handleStageAgent(params.projectId, body, {
		store: getProjectStore(),
		gateway: getGateway(),
		agent: resolveStageAgent,
		operator: getOperatorId()
	});
	return json(result.body, { status: result.status });
};
