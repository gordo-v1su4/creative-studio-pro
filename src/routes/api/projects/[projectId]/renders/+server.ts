import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema, RENDER_PROVIDERS } from '$lib/domain/schemas';
import { bannedTerms } from '$lib/domain/brief-rules';
import { getProjectRoot, getProjectStore, getPushDeps, getRenderProviders, resolveProjectModel } from '$lib/server/config';
import { projectRules } from '$lib/server/animate';
import { readAgentSkill, readPromptingGuide } from '$lib/server/agent-skills';
import { createOpenAICompatibleClient } from '$lib/server/model-provider';
import { describeProviders } from '$lib/server/render-providers';
import { approveRerender, draftRerender, editRerender, queueRerenderFor, redraftRerender, removeRerender, setRerenderSettings, type RerenderDeps } from '$lib/server/rerender';

/**
 * The render queue up to approval (slice 8): queue a re-render, have the
 * Agent draft its prompt change, edit, choose provider and size, approve,
 * remove. No action here prices, confirms or sends, and none is offered to
 * the Agent as a tool.
 */

const base = { expected_version: z.number().int().nonnegative() };
const render = { ...base, render_id: idSchema };
const bodySchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('queue'), ...base, take_id: idSchema, requested_change: z.string().max(4000).optional(), unchanged: z.boolean().optional() }),
	z.object({ action: z.literal('draft'), ...render }),
	z.object({ action: z.literal('redraft'), ...render, requested_change: z.string().min(1).max(4000) }),
	z.object({ action: z.literal('edit'), ...render, prompt: z.string().min(1).max(10_000) }),
	z.object({ action: z.literal('settings'), ...render, provider: z.enum(RENDER_PROVIDERS).optional(), model: z.string().min(1).max(100).optional(), resolution: z.string().min(1).max(20).optional() }),
	z.object({ action: z.literal('approve'), ...render }),
	z.object({ action: z.literal('remove'), ...render })
]);

const fail = (status: number, message: string) => json({ ok: false, error: { message } }, { status });

function deps(): RerenderDeps {
	return {
		store: getProjectStore(),
		providers: getRenderProviders(),
		async model(project) {
			const resolved = await resolveProjectModel(project);
			return resolved.ok ? { ok: true, client: createOpenAICompatibleClient(resolved.connection) } : { ok: false, message: resolved.message };
		},
		skill: async () => `${await readAgentSkill('ghost')}\n\nPROMPTING GUIDE:\n${await readPromptingGuide()}`,
		async notes(take) {
			const room = take.review_room ? await getPushDeps() : null;
			return room && take.review_room ? ((await room.client.assetNotes(take.review_room.asset_id)).notes ?? []) : [];
		},
		banned: async (projectId) => bannedTerms(await projectRules(getProjectRoot(), projectId)),
		now: () => new Date().toISOString(),
		id: () => crypto.randomUUID()
	};
}

/** The render providers as the queue lists them: which are set up, and why not. */
export const GET: RequestHandler = async () => json({ ok: true, providers: await describeProviders(getRenderProviders()) });

export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	const body = bodySchema.safeParse(await request.json().catch(() => null));
	if (!body.success) return fail(400, body.error.issues[0]?.message ?? 'Invalid request');
	const input = body.data;
	const d = deps();
	const outcome =
		input.action === 'queue' ? await queueRerenderFor(d, projectId.data, input)
		: input.action === 'draft' ? await draftRerender(d, projectId.data, input)
		: input.action === 'redraft' ? await redraftRerender(d, projectId.data, input)
		: input.action === 'edit' ? await editRerender(d, projectId.data, input)
		: input.action === 'settings' ? await setRerenderSettings(d, projectId.data, input)
		: input.action === 'approve' ? await approveRerender(d, projectId.data, input)
		: await removeRerender(d, projectId.data, input);
	return outcome.ok ? json({ ok: true, data: outcome.project, render: outcome.render }) : fail(outcome.status, outcome.message);
};
