import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { getProjectRoot, getProjectStore } from '$lib/server/config';
import { ensureSlate } from '$lib/server/slate';

/** The missing-shot card for one shot (V1S-495): made once per content, then served like any project file. */
export const GET: RequestHandler = async ({ params }) => {
	const projectId = idSchema.safeParse(params.projectId);
	const cardId = idSchema.safeParse(params.cardId);
	if (!projectId.success || !cardId.success) error(400, 'Invalid id');
	const project = await getProjectStore().readProject(projectId.data);
	if (!project) error(404, 'Project not found');
	try {
		const slate = await ensureSlate(getProjectRoot(), project, cardId.data);
		redirect(302, slate.url);
	} catch (cause) {
		if (cause && typeof cause === 'object' && 'status' in cause && 'location' in cause) throw cause;
		error(500, cause instanceof Error ? cause.message : 'The missing-shot card could not be made');
	}
};
