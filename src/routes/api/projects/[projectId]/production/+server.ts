import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { productionStateSchema } from '$lib/domain/schemas';
import { getGateway, getOperatorId, getProjectStore, resolveStoryBuilder } from '$lib/server/config';
import { AgentRuleBreakError } from '$lib/server/model-provider';

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
	let expectedVersion = parsed.data.expected_version;
	if (!production) {
		const resolved = await resolveStoryBuilder(project);
		if (!resolved.ok) return json({ ok: false, error: { code: resolved.code, message: resolved.message } }, { status: resolved.code === 'NOT_CONFIGURED' ? 503 : 409 });
		try { production = await resolved.builder.build(project); }
		catch (cause) {
			if (cause instanceof AgentRuleBreakError) return json({ ok: false, error: { code: 'AGENT_RULE_BREAK', message: cause.message } }, { status: 422 });
			return json({ ok: false, error: { message: cause instanceof Error ? cause.message : 'Story draft failed' } }, { status: 502 });
		}
		// First real model run pins the model into the project (logged).
		if (!project.agent_model.locked_at) {
			const locked = await getGateway().lockProjectModel({
				command: 'lock_project_model', project_id: params.projectId,
				expected_version: expectedVersion, choice: resolved.builder.choice, operator: getOperatorId()
			});
			if (!locked.ok) return json(locked, { status: locked.error.code === 'VERSION_CONFLICT' ? 409 : 400 });
			expectedVersion = locked.data.version;
		}
	}
	const outcome = await getGateway().saveProduction({
		command: 'save_production', project_id: params.projectId,
		expected_version: expectedVersion, production
	});
	return json(outcome, { status: outcome.ok ? 200 : outcome.error.code === 'VERSION_CONFLICT' ? 409 : 400 });
};
