import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { getPrepDeps, getReferenceFileDeps } from '$lib/server/config';
import { checkDrift, markOld } from '$lib/server/drift';

/**
 * The drift check (Drift 03, GitHub #32 / V1S-510; ADR 0012): GET compares Notion's References, every series
 * project's Prep and Review Room's reference folders, and returns what is out of step. It only reads. Its "add to
 * Notion" is the Prep add (`POST …/prep`, `add_entry`) on the project the item was found in. POST carries out one
 * choice on one item; Drift 04 (GitHub #33 / V1S-511) adds "mark as old" on a Review Room sheet.
 */
export const GET: RequestHandler = async ({ params }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return json({ ok: false, error: { message: 'Invalid project id' } }, { status: 400 });
	const deps = await getPrepDeps();
	const project = await deps.store.readProject(projectId.data);
	if (!project) return json({ ok: false, error: { message: 'Project not found' } }, { status: 404 });
	try {
		const checked = await checkDrift({ ...deps, client: getReferenceFileDeps()?.client ?? null }, project);
		return checked.ok ? json({ ok: true, data: checked.report }) : json({ ok: false, error: { message: checked.message } }, { status: checked.status });
	} catch (cause) {
		return json({ ok: false, error: { message: cause instanceof Error ? cause.message : 'The drift check failed' } }, { status: 502 });
	}
};

const choiceSchema = z.discriminatedUnion('choice', [
	z.object({ choice: z.literal('mark_old'), asset_id: z.string().min(1).max(64), history_of: z.string().min(1).max(64).nullable().optional() })
]);

export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return json({ ok: false, error: { message: 'Invalid project id' } }, { status: 400 });
	const body = choiceSchema.safeParse(await request.json().catch(() => null));
	if (!body.success) return json({ ok: false, error: { message: body.error.issues[0]?.message ?? 'Invalid choice' } }, { status: 400 });
	const deps = await getPrepDeps();
	const project = await deps.store.readProject(projectId.data);
	if (!project) return json({ ok: false, error: { message: 'Project not found' } }, { status: 404 });
	try {
		const marked = await markOld({ ...deps, client: getReferenceFileDeps()?.client ?? null }, project, body.data);
		return marked.ok ? json({ ok: true, data: marked }) : json({ ok: false, error: { message: marked.message } }, { status: marked.status });
	} catch (cause) {
		return json({ ok: false, error: { message: cause instanceof Error ? cause.message : 'Marking the sheet old failed' } }, { status: 502 });
	}
};
