import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { ANIMATE_MAX_S, ANIMATE_MIN_S, ANIMATE_RESOLUTIONS, animateGate } from '$lib/domain/animate';
import { idSchema } from '$lib/domain/schemas';
import { getAnimateDeps, resolveProjectModel } from '$lib/server/config';
import { createOpenAICompatibleClient } from '$lib/server/model-provider';
import { draftAnimatePrompt, estimateAnimate, pollGenerations, projectRules, readStill, sendAnimate, spentThisSession } from '$lib/server/animate';

const settingsSchema = z.object({
	prompt: z.string().max(10_000),
	duration_s: z.number().min(ANIMATE_MIN_S).max(ANIMATE_MAX_S),
	resolution: z.enum(ANIMATE_RESOLUTIONS),
	generate_audio: z.boolean()
});

const requestSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('prepare'), card_id: idSchema, session_id: z.string().min(1).max(100) }),
	z.object({ action: z.literal('estimate'), settings: settingsSchema }),
	z.object({
		action: z.literal('send'), card_id: idSchema, expected_version: z.number().int().nonnegative(), settings: settingsSchema,
		mode: z.discriminatedUnion('kind', [
			z.object({ kind: z.literal('confirm'), confirmed_usd: z.number().nonnegative() }),
			z.object({ kind: z.literal('yolo'), cap_usd: z.number().nonnegative(), session_id: z.string().min(1).max(100) })
		])
	}),
	z.object({ action: z.literal('poll') })
]);

const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
	json({ ok: false, error: { code, message, retryable: status >= 500, source: 'animate', ...extra } }, { status });

/**
 * Animate a beat's still through Seedance (AD-1, AD-3). prepare: the Agent's
 * draft prompt, the gate preview and the price; estimate: re-price changed
 * settings; send: gate, then upload and submit; poll: settle finished jobs.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'INVALID_COMMAND', 'Invalid project id');
	let body: z.infer<typeof requestSchema>;
	try {
		const parsed = requestSchema.safeParse(await request.json());
		if (!parsed.success) return fail(400, 'INVALID_COMMAND', parsed.error.issues[0]?.message ?? 'Invalid Animate request');
		body = parsed.data;
	} catch {
		return fail(400, 'INVALID_COMMAND', 'Request body is not JSON');
	}
	const deps = await getAnimateDeps();

	if (body.action === 'estimate') {
		const priced = await estimateAnimate(deps, body.settings);
		return priced.ok ? json({ ok: true, data: priced.estimate }) : fail(priced.status, priced.code, priced.message);
	}
	if (body.action === 'poll') {
		const polled = await pollGenerations(deps, projectId.data);
		return polled.ok ? json({ ok: true, data: polled.project }) : fail(polled.status, polled.code, polled.message);
	}
	if (body.action === 'send') {
		const sent = await sendAnimate(deps, { project_id: projectId.data, expected_version: body.expected_version, card_id: body.card_id, settings: body.settings, mode: body.mode });
		return sent.ok ? json({ ok: true, data: sent.project, estimate: sent.estimate }) : fail(sent.status, sent.code, sent.message, { reasons: sent.reasons ?? [] });
	}

	// prepare
	const project = await deps.store.readProject(projectId.data);
	if (!project) return fail(404, 'NOT_FOUND', 'Project not found');
	const still = await readStill(deps, project, body.card_id);
	if (!still.ok) return fail(still.status, still.code, still.message);
	const settings = { prompt: still.card.video_prompt, duration_s: Math.min(ANIMATE_MAX_S, Math.max(ANIMATE_MIN_S, Math.round(still.card.duration_ms / 1000))), resolution: '480p' as const, generate_audio: true };
	let draftNote: string | null = null;
	const resolved = await resolveProjectModel(project);
	if (resolved.ok) {
		try {
			settings.prompt = await draftAnimatePrompt(createOpenAICompatibleClient(resolved.connection), {
				card: still.card, still: still.bytes, stillType: still.still.mime_type.includes('*') ? 'image/png' : still.still.mime_type,
				rules: await projectRules(deps.projectRoot, projectId.data)
			});
		} catch (cause) {
			draftNote = `The Agent couldn't draft a prompt (${cause instanceof Error ? cause.message : 'error'}); starting from the beat's video prompt.`;
		}
	} else {
		draftNote = `No Agent model (${resolved.message}); starting from the beat's video prompt.`;
	}
	const priced = await estimateAnimate(deps, settings);
	return json({
		ok: true,
		data: {
			card_id: still.card.card_id, title: still.card.title,
			still: { url: still.still.url, name: still.still.name, width: still.still.width ?? null, height: still.still.height ?? null },
			settings, draft_note: draftNote,
			estimate: priced.ok ? priced.estimate : null, estimate_error: priced.ok ? null : priced.message,
			configured: Boolean(deps.generator),
			session_spent_usd: spentThisSession(body.session_id),
			// Gate preview with the current price (confirm mode); the send re-runs the gate for real.
			blocked: priced.ok ? animateGate({ prompt: settings.prompt, still: still.still, estimate_usd: priced.estimate.usd, mode: { kind: 'confirm', confirmed_usd: priced.estimate.usd } }) : []
		}
	});
};
