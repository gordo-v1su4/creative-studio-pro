import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGateway } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';

const BOARD_COMMANDS = new Set(['set_pick', 'reject_take', 'restore_take', 'bench_beat', 'unbench_beat', 'rewire_spine', 'create_group', 'rename_group', 'move_beats']);

/** Thin same-origin command route (AD-1, AD-3): board edits to beats and their takes. */
export const POST: RequestHandler = async ({ params, request }) => {
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ ok: false, error: { code: 'INVALID_COMMAND', message: 'Request body is not JSON', retryable: false, source: 'application' } }, { status: 400 });
	}
	if (!BOARD_COMMANDS.has(String(body.command))) {
		return json({ ok: false, error: { code: 'INVALID_COMMAND', message: `Not a board command: ${String(body.command)}`, retryable: false, source: 'application' } }, { status: 400 });
	}
	const outcome = await getGateway().handle({ ...body, project_id: params.projectId });
	if (!outcome.ok) return json(outcome, { status: commandStatus(outcome.error) });
	return json(outcome);
};
