import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { getProjectStore, getPushDeps } from '$lib/server/config';
import { connectTrailer } from '$lib/server/review-room-trailer';
import { join, resolve, sep } from 'node:path';
import { pullTakes, pushDeliverable, pushTake } from '$lib/server/review-room-takes';
import { reviewTake } from '$lib/server/review-room-review';
import { idempotencyKey } from '$lib/server/review-room';
import { pickFor } from '$lib/domain/takes';
import { folderLinks } from '$lib/domain/review-room-links';
import { env } from '$env/dynamic/private';
import { qcCut } from '$lib/server/qc-cut';

const bodySchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('review'), take_id: idSchema, expected_version: z.number().int(), status: z.enum(['awaiting_review', 'in_progress', 'needs_changes', 'approved']).optional(), excluded: z.boolean().optional() }),
	z.object({ action: z.literal('connect_trailer'), expected_version: z.number().int(), project_id: idSchema, folder_id: idSchema,
		show_code: z.string().regex(/^[A-Z]{3}$/), code: z.string().regex(/^TR\d{3}$/), reference_series_id: idSchema.optional(),
		// Story sequences in story order, each a scene folder with its code (010 DRP, 020 MRN…); omit for flat SHT folders.
		scenes: z.array(z.object({ group_id: idSchema, code: z.string().regex(/^[A-Z]{3}$/) })).max(99).optional() }),
	// Store one series take in Review Room (V1S-276): the shot's next version, current when it is the pick.
	z.object({ action: z.literal('push'), take_id: idSchema }),
	// Store a finished cut that is already a video in the project (a render made outside Export) as a deliverable.
	z.object({ action: z.literal('push_deliverable'), take_id: idSchema, kind: z.enum(['EPC', 'TSR', 'TRL']).default('TRL'), index: z.number().int().min(1).max(99).optional(), cut: z.string().trim().min(1).max(120).optional(),
		// The locked cut version it renders: the QC report (V1S-505) runs on the video first and goes into the deliverable's notes.
		qc_cut: z.object({ cut_id: idSchema, version: z.number().int().positive() }).optional() }),
	// Store every take of this episode that isn't in Review Room yet.
	z.object({ action: z.literal('push_all') }),
	// Pull takes added in Review Room, follow its current version as the pick, report misfiled drops.
	z.object({ action: z.literal('pull') }),
	// Write this app's address into the project's locked folders in Review Room, once (and again when folders are added).
	z.object({ action: z.literal('link_back') }),
	// Send a pick again: make this take Review Room's current version, if it is still the pick here.
	z.object({ action: z.literal('current'), take_id: idSchema }),
	// The notes reviewers left on a take's shot in Review Room, with their timecodes. Reads only.
	z.object({ action: z.literal('notes'), take_id: idSchema })
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
	if (body.data.action === 'notes') {
		// Never an error for the viewer: a take that is not stored there, or a Review Room without this endpoint
		// yet, simply has no notes to show (`available` says which).
		if (!deps) return json({ ok: true, available: false, notes: [] });
		const takeId = body.data.take_id;
		const project = await deps.store.readProject(projectId.data);
		const take = project?.production.assets.find((asset) => asset.asset_id === takeId);
		if (!take?.review_room) return json({ ok: true, available: true, notes: [] });
		try { return json({ ok: true, available: true, notes: (await deps.client.assetNotes(take.review_room.asset_id)).notes ?? [] }); }
		catch { return json({ ok: true, available: false, notes: [] }); }
	}
	if (!deps) return fail(503, 'Add CSP_REVIEW_ROOM_URL and CSP_REVIEW_ROOM_API_KEY to .env.local first');
	if (body.data.action === 'link_back') {
		const project = await deps.store.readProject(projectId.data);
		if (!project) return fail(404, 'Project not found');
		const wanted = folderLinks(project, env.ORIGIN);
		// Nothing to write (a local copy, or no folders there), or already written for these folders.
		if (!wanted || !project.review_room || (project.review_room.link?.url === wanted.url && project.review_room.link.folders === wanted.folders.length)) return json({ ok: true, data: project, linked: 0 });
		const remote = project.review_room.project_id;
		let linked = 0;
		try { for (const folderId of wanted.folders) { await deps.client.setFolderLink(remote, folderId, wanted.url); linked += 1; } }
		catch (cause) { return json({ ok: true, data: project, linked, pending: cause instanceof Error ? cause.message : 'Review Room could not be reached' }); }
		const saved = await deps.store.updateProject(projectId.data, project.version, (current) => (current.review_room ? { ...current, review_room: { ...current.review_room, link: { url: wanted.url, folders: wanted.folders.length } } } : current));
		return json({ ok: true, data: saved, linked });
	}
	if (body.data.action === 'current') {
		const takeId = body.data.take_id;
		const project = await deps.store.readProject(projectId.data);
		if (!project) return fail(404, 'Project not found');
		const take = project.production.assets.find((asset) => asset.asset_id === takeId);
		const card = take && project.production.cards.find((entry) => entry.card_id === take.card_id);
		// Another take has become the pick since, or this one is not stored there: nothing left to send.
		if (!take?.review_room || take.kind === 'audio' || !card || pickFor(project.production, card)?.asset_id !== take.asset_id) return json({ ok: true, data: project });
		try {
			await deps.client.setCurrentVersion(take.review_room.asset_id, take.review_room.version_id, idempotencyKey('current', take.review_room.asset_id, take.review_room.version_id, crypto.randomUUID()));
			return json({ ok: true, data: project });
		} catch (cause) { return fail(400, cause instanceof Error ? cause.message : 'Review Room could not be reached'); }
	}
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
		return pulled.ok ? json({ ok: true, data: pulled.project, added: pulled.added, picked: pulled.picked, misfiled: pulled.misfiled, changed: pulled.changed }) : fail(pulled.status, pulled.message);
	}
	if (body.data.action === 'push_deliverable') {
		const { take_id, kind, index, cut, qc_cut } = body.data;
		const project = await deps.store.readProject(projectId.data);
		const take = project?.production.assets.find((asset) => asset.asset_id === take_id);
		if (!project || !take || take.kind !== 'video') return fail(404, 'Video not found in this project');
		const files = resolve(join(deps.projectRoot, projectId.data, 'files'));
		const prefix = `/api/projects/${projectId.data}/files/`;
		const file = take.url.startsWith(prefix) ? resolve(join(files, decodeURIComponent(take.url.slice(prefix.length)))) : '';
		if (!file.startsWith(files + sep)) return fail(400, 'The video is not stored in the project folder');
		// "TR110 Rough cut 18 (2-17) exact mix.mp4" → "Rough cut 18" when no cut name is given.
		const cutName = cut ?? (take.name.replace(/\.[^.]+$/, '').replace(/^TR\d{3}\s+/, '').replace(/\s*\(.*$/, '') || undefined);
		const checked = qc_cut ? await qcCut(deps, projectId.data, qc_cut.cut_id, qc_cut.version, { url: take.url }) : null;
		if (checked && !checked.ok) return fail(checked.status, checked.message);
		const stored = await pushDeliverable(deps, projectId.data, { file, name: take.name, kind, index, scope: 'episode', cut: cutName, qc: checked?.report });
		return stored.ok ? json({ ok: true, code: stored.code, version: stored.version, ...(checked ? { qc: checked.report } : {}) }) : fail(stored.status, stored.message);
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
