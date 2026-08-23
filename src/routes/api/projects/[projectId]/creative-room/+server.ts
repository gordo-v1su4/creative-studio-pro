import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGateway } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';

/** Dispatch or reconcile a Creative Room run through the M3 bridge (FR-009..010). */
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
	const command = body.command === 'reconcile_creative_room' ? 'reconcile_creative_room' : 'start_creative_room';
	const gateway = getGateway();
	const outcome =
		command === 'reconcile_creative_room'
			? await gateway.reconcileCreativeRoom({ ...body, command, project_id: params.projectId })
			: await gateway.startCreativeRoom({ ...body, command, project_id: params.projectId });
	if (!outcome.ok) return json(outcome, { status: commandStatus(outcome.error) });
	return json(outcome);
};
