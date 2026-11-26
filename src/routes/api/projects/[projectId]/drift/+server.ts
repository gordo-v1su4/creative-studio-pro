import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { getPrepDeps, getReferenceFileDeps, getUpscaler } from '$lib/server/config';
import { checkDrift } from '$lib/server/drift';
import { quoteUpscale, sendUpscaled, settleUpscale, startUpscale } from '$lib/server/drift-picture';
import { probeMedia } from '$lib/server/media-probe';

/**
 * The drift check (Drift 03, GitHub #32 / V1S-510; ADR 0012): GET compares Notion's References, every series
 * project's Prep and Review Room's reference folders, and returns what is out of step. It only reads. Its "add to
 * Notion" is the Prep add (`POST …/prep`, `add_entry`) on the project the item was found in.
 */
export const GET: RequestHandler = async ({ params }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return json({ ok: false, error: { message: 'Invalid project id' } }, { status: 400 });
	const deps = await getPrepDeps();
	const project = await deps.store.readProject(projectId.data);
	if (!project) return json({ ok: false, error: { message: 'Project not found' } }, { status: 404 });
	try {
		const checked = await checkDrift({ ...deps, client: getReferenceFileDeps()?.client ?? null, probe: probeMedia }, project);
		return checked.ok ? json({ ok: true, data: checked.report }) : json({ ok: false, error: { message: checked.message } }, { status: checked.status });
	} catch (cause) {
		return json({ ok: false, error: { message: cause instanceof Error ? cause.message : 'The drift check failed' } }, { status: 502 });
	}
};

const key = z.string().min(1).max(300);
const pictureSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('quote_upscale'), key }),
	z.object({ action: z.literal('upscale'), key, confirmed_credits: z.number().nonnegative() }),
	z.object({ action: z.literal('settle_upscale'), key }),
	z.object({ action: z.literal('send_upscaled'), key })
]);

/**
 * A drift item's picture under 2K (Drift 08, GitHub #36 / V1S-512), on the project whose Prep holds it: the price
 * (spends nothing), the upscale on a yes to that price, the upscaled sheet beside the original, and the send to
 * Review Room on a second yes. Each is its own press.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return json({ ok: false, error: { message: 'Invalid project id' } }, { status: 400 });
	const body = pictureSchema.safeParse(await request.json().catch(() => null));
	if (!body.success) return json({ ok: false, error: { message: body.error.issues[0]?.message ?? 'Invalid request' } }, { status: 400 });
	const prepDeps = await getPrepDeps();
	const project = await prepDeps.store.readProject(projectId.data);
	if (!project) return json({ ok: false, error: { message: 'Project not found' } }, { status: 404 });
	const deps = { ...prepDeps, upscaler: getUpscaler(), probe: probeMedia };
	const b = body.data;
	try {
		const result = b.action === 'quote_upscale' ? await quoteUpscale(deps, project, b.key)
			: b.action === 'upscale' ? await startUpscale(deps, project, b.key, b)
			: b.action === 'settle_upscale' ? await settleUpscale(deps, project, b.key)
			: await sendUpscaled(deps, project, b.key);
		if (!result.ok) return json({ ok: false, error: { message: result.message } }, { status: result.status });
		const { ok: _ok, ...data } = result;
		return json({ ok: true, data });
	} catch (cause) {
		return json({ ok: false, error: { message: cause instanceof Error ? cause.message : 'That could not be done' } }, { status: 502 });
	}
};
