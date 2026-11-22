import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getProjectStore } from '$lib/server/config';

const bodySchema = z.object({ archived: z.boolean(), expected_version: z.number().int().nonnegative() });

/**
 * Archive or unarchive a project (V1S-496). Archiving only sets a flag, as in Review Room: the project drops out of
 * the project list for everyone; its files, takes, cuts and codes are untouched, and unarchiving brings it back.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const body = bodySchema.safeParse(await request.json().catch(() => null));
	if (!body.success) return json({ ok: false, error: { message: 'Say whether to archive or unarchive' } }, { status: 400 });
	const store = getProjectStore();
	const project = await store.readProject(params.projectId);
	if (!project) return json({ ok: false, error: { message: 'Project not found' } }, { status: 404 });
	if (project.version !== body.data.expected_version) return json({ ok: false, error: { message: 'Project changed; reload first' } }, { status: 409 });
	if (!!project.archived_at === body.data.archived) return json({ ok: true, data: project });
	const saved = await store.updateProject(project.project_id, project.version, (current) => ({ ...current, archived_at: body.data.archived ? new Date().toISOString() : null }));
	return json({ ok: true, data: saved });
};
