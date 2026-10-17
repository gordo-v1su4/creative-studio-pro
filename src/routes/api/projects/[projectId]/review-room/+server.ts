import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { getPushDeps } from '$lib/server/config';
import { pullTakes, pushTake } from '$lib/server/review-room-takes';

const bodySchema = z.discriminatedUnion('action', [
	// Store one series take in Review Room (V1S-276): the shot's next version, current when it is the pick.
	z.object({ action: z.literal('push'), take_id: idSchema }),
	// Store every take of this episode that isn't in Review Room yet.
	z.object({ action: z.literal('push_all') }),
	// Pull takes added in Review Room, follow its current version as the pick, report misfiled drops.
	z.object({ action: z.literal('pull') })
]);

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 503 ? 'NOT_CONFIGURED' : 'INVALID_COMMAND', message } }, { status });

export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	const body = bodySchema.safeParse(await request.json().catch(() => null));
	if (!body.success) return fail(400, body.error.issues[0]?.message ?? 'Invalid request');
	const deps = await getPushDeps();
	if (!deps) return fail(503, 'Add CSP_REVIEW_ROOM_URL and CSP_REVIEW_ROOM_API_KEY to .env.local first');
	if (body.data.action === 'pull') {
		const pulled = await pullTakes(deps, projectId.data);
		return pulled.ok ? json({ ok: true, data: pulled.project, added: pulled.added, picked: pulled.picked, misfiled: pulled.misfiled }) : fail(pulled.status, pulled.message);
	}
	if (body.data.action === 'push') {
		const pushed = await pushTake(deps, projectId.data, body.data.take_id);
		return pushed.ok ? json({ ok: true, data: pushed.project, code: pushed.code, version: pushed.version }) : fail(pushed.status, pushed.message);
	}
	const project = await deps.store.readProject(projectId.data);
	if (!project) return fail(404, 'Project not found');
	const pending = project.production.assets.filter((asset) => !asset.review_room && asset.kind !== 'audio' && !asset.rejected);
	let latest = project, stored = 0;
	const failed: Array<{ take_id: string; message: string }> = [];
	for (const take of pending) {
		const pushed = await pushTake(deps, projectId.data, take.asset_id);
		if (pushed.ok) { latest = pushed.project; stored += 1; } else failed.push({ take_id: take.asset_id, message: pushed.message });
	}
	return json({ ok: true, data: latest, stored, failed });
};
