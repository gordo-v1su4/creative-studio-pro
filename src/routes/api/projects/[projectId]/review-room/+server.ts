import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { getProjectStore, getPushDeps } from '$lib/server/config';
import { connectTrailer } from '$lib/server/review-room-trailer';
import { join, resolve, sep } from 'node:path';
import { pullTakes, pushDeliverable, pushTake } from '$lib/server/review-room-takes';
import { reviewTake } from '$lib/server/review-room-review';

const bodySchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('review'), take_id: idSchema, expected_version: z.number().int(), status: z.enum(['awaiting_review', 'in_progress', 'needs_changes', 'approved']).optional(), excluded: z.boolean().optional() }),
	z.object({ action: z.literal('connect_trailer'), expected_version: z.number().int(), project_id: idSchema, folder_id: idSchema,
		show_code: z.string().regex(/^[A-Z]{3}$/), code: z.string().regex(/^TR\d{3}$/), reference_series_id: idSchema.optional(),
		// Story sequences in story order, each a scene folder with its code (010 DRP, 020 MRN…); omit for flat SHT folders.
		scenes: z.array(z.object({ group_id: idSchema, code: z.string().regex(/^[A-Z]{3}$/) })).max(99).optional() }),
	// Store one series take in Review Room (V1S-276): the shot's next version, current when it is the pick.
	z.object({ action: z.literal('push'), take_id: idSchema }),
	// Store a finished cut that is already a video in the project (a render made outside Export) as a deliverable.
	z.object({ action: z.literal('push_deliverable'), take_id: idSchema, kind: z.enum(['EPC', 'TSR', 'TRL']).default('TRL'), index: z.number().int().min(1).max(99).optional() }),
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
	if (body.data.action === 'review') {
		if (body.data.status === undefined && body.data.excluded === undefined) return fail(400, 'Choose a review decision');
		try { return json({ ok: true, data: await reviewTake({ store: getProjectStore(), client: deps?.client }, projectId.data, body.data) }); }
		catch (cause) { return fail(400, cause instanceof Error ? cause.message : 'Review could not be saved'); }
	}
	if (!deps) return fail(503, 'Add CSP_REVIEW_ROOM_URL and CSP_REVIEW_ROOM_API_KEY to .env.local first');
	if (body.data.action === 'connect_trailer') {
		const project = await deps.store.readProject(projectId.data);
		if (!project) return fail(404, 'Project not found');
		if (project.series) return fail(400, 'Episodes use their series connection');
		if (project.version !== body.data.expected_version) return fail(409, 'Project changed; reload first');
		try {
			const { action, expected_version, ...input } = body.data;
			const connection = await connectTrailer(deps.client, project, input);
			const saved = await deps.store.updateProject(projectId.data, expected_version, (current) => ({ ...current, review_room: connection }));
			return json({ ok: true, data: saved });
		} catch (cause) { return fail(400, cause instanceof Error ? cause.message : 'Connection failed'); }
	}
	if (body.data.action === 'pull') {
		const pulled = await pullTakes(deps, projectId.data);
		return pulled.ok ? json({ ok: true, data: pulled.project, added: pulled.added, picked: pulled.picked, misfiled: pulled.misfiled }) : fail(pulled.status, pulled.message);
	}
	if (body.data.action === 'push_deliverable') {
		const { take_id, kind, index } = body.data;
		const project = await deps.store.readProject(projectId.data);
		const take = project?.production.assets.find((asset) => asset.asset_id === take_id);
		if (!project || !take || take.kind !== 'video') return fail(404, 'Video not found in this project');
		const files = resolve(join(deps.projectRoot, projectId.data, 'files'));
		const prefix = `/api/projects/${projectId.data}/files/`;
		const file = take.url.startsWith(prefix) ? resolve(join(files, decodeURIComponent(take.url.slice(prefix.length)))) : '';
		if (!file.startsWith(files + sep)) return fail(400, 'The video is not stored in the project folder');
		const stored = await pushDeliverable(deps, projectId.data, { file, name: take.name, kind, index, scope: 'episode' });
		return stored.ok ? json({ ok: true, code: stored.code, version: stored.version }) : fail(stored.status, stored.message);
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
