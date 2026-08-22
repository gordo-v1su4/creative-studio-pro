import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGateway } from '$lib/server/config';

/**
 * Thin same-origin command route (AD-1, AD-3): canvas layout save.
 * Last-writer-wins document; no aggregate version precondition.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: { code: 'INVALID_COMMAND', message: 'Request body is not JSON', retryable: false, source: 'application' } }, { status: 400 });
	}
	const gateway = getGateway();
	const outcome = await gateway.saveCanvasLayout({
		...(body as Record<string, unknown>),
		command: 'save_canvas_layout',
		project_id: params.projectId
	});
	if (!outcome.ok) {
		const status = outcome.error.code === 'NOT_FOUND' ? 404 : outcome.error.code === 'INVALID_COMMAND' ? 400 : 500;
		return json(outcome, { status });
	}
	return json(outcome);
};
