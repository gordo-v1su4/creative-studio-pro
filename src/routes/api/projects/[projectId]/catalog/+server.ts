import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGateway } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';

/** Harvest or reshuffle the live M3 Raycast catalog (FR-005..008). */
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
	const command = body.command === 'reshuffle_roster' ? 'reshuffle_roster' : 'harvest_catalog';
	const gateway = getGateway();
	const outcome =
		command === 'reshuffle_roster'
			? await gateway.reshuffleRoster({ ...body, command, project_id: params.projectId })
			: await gateway.harvestCatalog({ ...body, command, project_id: params.projectId });
	if (!outcome.ok) return json(outcome, { status: commandStatus(outcome.error) });
	return json(outcome);
};
