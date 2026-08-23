import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProjectStore } from '$lib/server/config';

/** Thin same-origin query route (AD-1): read one project + canvas layout. */
export const GET: RequestHandler = async ({ params }) => {
	const store = getProjectStore();
	const project = await store.readProject(params.projectId);
	if (!project) {
		return json({ error: { code: 'NOT_FOUND', message: `Project ${params.projectId} not found`, retryable: false, source: 'project-store' } }, { status: 404 });
	}
	const layout = await store.readCanvasLayout(params.projectId);
	return json({ project, layout });
};
