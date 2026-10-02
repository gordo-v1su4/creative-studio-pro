import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGateway } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';

const CUT_COMMANDS = new Set(['push_cut', 'edit_cut', 'rename_cut', 'lock_cut', 'unlock_cut', 'set_cut_music']);

/** Thin same-origin command route (AD-1, AD-3): pushing a selection into a cut, and edits to a cut. */
export const POST: RequestHandler = async ({ params, request }) => {
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ ok: false, error: { code: 'INVALID_COMMAND', message: 'Request body is not JSON', retryable: false, source: 'application' } }, { status: 400 });
	}
	if (!CUT_COMMANDS.has(String(body.command))) {
		return json({ ok: false, error: { code: 'INVALID_COMMAND', message: `Not a cut command: ${String(body.command)}`, retryable: false, source: 'application' } }, { status: 400 });
	}
	const outcome = await getGateway().handle({ ...body, project_id: params.projectId });
	if (!outcome.ok) return json(outcome, { status: commandStatus(outcome.error) });
	return json(outcome);
};
