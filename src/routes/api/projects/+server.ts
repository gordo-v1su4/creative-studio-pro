import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGateway, getProjectStore } from '$lib/server/config';

/** Thin same-origin query route (AD-1): list project summaries. */
export const GET: RequestHandler = async () => {
	const store = getProjectStore();
	return json({ projects: await store.listProjects() });
};

/** Thin same-origin command route (AD-1, AD-3): create project. */
export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json(
			{
				ok: false,
				error: {
					code: 'INVALID_COMMAND',
					message: 'Request body is not JSON',
					retryable: false,
					source: 'application'
				}
			},
			{ status: 400 }
		);
	}
	const gateway = getGateway();
	const outcome = await gateway.createProject(body);
	if (!outcome.ok) {
		return json(outcome, {
			status: outcome.error.code === 'INVALID_COMMAND' ? 400 : 500
		});
	}
	return json(outcome, { status: 201 });
};
