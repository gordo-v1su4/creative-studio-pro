import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { productionStateSchema } from '$lib/domain/schemas';
import { getGateway, getProjectStore, getStoryBuilder } from '$lib/server/config';

const requestSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('generate'), expected_version: z.number().int().nonnegative() }),
	z.object({ mode: z.literal('save'), expected_version: z.number().int().nonnegative(), production: productionStateSchema })
]);

export const POST: RequestHandler = async ({ params, request }) => {
	let raw: unknown;
	try { raw = await request.json(); }
	catch { return json({ ok: false, error: { message: 'Request body is not JSON' } }, { status: 400 }); }
	const parsed = requestSchema.safeParse(raw);
	if (!parsed.success) return json({ ok: false, error: { message: parsed.error.issues[0]?.message ?? 'Invalid production request' } }, { status: 400 });
	const store = getProjectStore();
	const project = await store.readProject(params.projectId);
	if (!project) return json({ ok: false, error: { message: 'Project not found' } }, { status: 404 });
	if (project.version !== parsed.data.expected_version) return json({ ok: false, error: { message: `Version conflict: expected ${parsed.data.expected_version}, current ${project.version}` } }, { status: 409 });

	let production = parsed.data.mode === 'save' ? parsed.data.production : null;
	if (!production) {
		const builder = getStoryBuilder();
		if (!builder) return json({ ok: false, error: { message: 'KIMI_API_KEY is not configured' } }, { status: 503 });
		try { production = await builder.build(project); }
		catch (cause) { return json({ ok: false, error: { message: cause instanceof Error ? cause.message : 'Story draft failed' } }, { status: 502 }); }
	}
	const outcome = await getGateway().saveProduction({
		command: 'save_production', project_id: params.projectId,
		expected_version: parsed.data.expected_version, production
	});
	return json(outcome, { status: outcome.ok ? 200 : outcome.error.code === 'VERSION_CONFLICT' ? 409 : 400 });
};
