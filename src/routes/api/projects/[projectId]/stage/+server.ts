import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGateway } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';

/** Thin same-origin command route (AD-1, AD-3): operator force-advance. */
export const POST: RequestHandler = async ({ params, request }) => {
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
		project_id: params.projectId
	});
	if (!outcome.ok) {
		return json(outcome, { status: commandStatus(outcome.error) });
	}
	return json(outcome);
};
