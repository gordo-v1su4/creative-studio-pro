import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGateway } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';

export const POST: RequestHandler = async ({ params, request }) => {
	let body: Record<string, unknown>;
	try { body = await request.json() as Record<string, unknown>; }
	catch { return json({ ok: false, error: { code: 'INVALID_COMMAND', message: 'Request body is not JSON', retryable: false, source: 'application' } }, { status: 400 }); }
	const outcome = await getGateway().recordInterviewRound({
		...body, command: 'record_interview_round', project_id: params.projectId
	});
	return json(outcome, { status: outcome.ok ? 200 : commandStatus(outcome.error) });
};
