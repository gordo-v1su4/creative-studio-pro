import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGateway } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';
import { authenticateOperator } from '$lib/server/operator-auth';

/** Thin same-origin command route (AD-1, AD-3): operator force-advance. */
export const POST: RequestHandler = async ({ params, request }) => {
	const authentication = authenticateOperator(request);
	if (!authentication.ok) {
		return json(
			{
				ok: false,
				error: {
					code: authentication.status === 401 ? 'UNAUTHORIZED' : 'CAPABILITY_UNAVAILABLE',
					message: authentication.message,
					retryable: false,
					source: 'application'
				}
			},
			{
				status: authentication.status,
				...(authentication.status === 401 && {
					headers: { 'www-authenticate': 'Bearer realm="operator"' }
				})
			}
		);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json(
			{ ok: false, error: { code: 'INVALID_COMMAND', message: 'Request body is not JSON', retryable: false, source: 'application' } },
			{ status: 400 }
		);
	}
	const gateway = getGateway();
	const outcome = await gateway.forceAdvanceStage({
		...body,
		command: 'force_advance_stage',
		project_id: params.projectId,
		operator: authentication.operator
	});
	if (!outcome.ok) {
		return json(outcome, { status: commandStatus(outcome.error) });
	}
	return json(outcome);
};
