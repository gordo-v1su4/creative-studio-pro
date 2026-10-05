import { json } from '@sveltejs/kit';
import { join } from 'node:path';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { buildSnapshot, slugOf } from '$lib/domain/publish';
import { getProjectRoot, getProjectStore } from '$lib/server/config';
import { LocalPublishedStore } from '$lib/server/published-store';

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : 'INVALID_COMMAND', message } }, { status });
const bodySchema = z.object({ show_prompts: z.boolean().default(false), slug: z.string().max(100).optional() });

/**
 * Publish (studio only; the public site refuses every non-GET): snapshot the project and copy the media it
 * uses into the published folder, where the watch pages read it. Publishing again replaces the earlier copy.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	const body = bodySchema.safeParse(await request.json().catch(() => ({})));
	if (!body.success) return fail(400, body.error.issues[0]?.message ?? 'Invalid request');
	const project = await getProjectStore().readProject(projectId.data);
	if (!project) return fail(404, 'Project not found');
	const snapshot = buildSnapshot(project, { slug: body.data.slug ? slugOf(body.data.slug) : undefined, show_prompts: body.data.show_prompts, now: new Date().toISOString() });
	const store = LocalPublishedStore.beside(getProjectRoot());
	const { copied, missing } = await store.publish(snapshot, join(getProjectRoot(), projectId.data, 'files'));
	return json({ ok: true, data: { slug: snapshot.slug, url: `/watch/${snapshot.slug}`, beats: snapshot.beats.length, cuts: snapshot.cuts.length, copied, missing } });
};
