import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { ANIMATE_MAX_S, ANIMATE_MIN_S, ANIMATE_RESOLUTIONS, animateGate } from '$lib/domain/animate';
import { idSchema } from '$lib/domain/schemas';
import { bannedTerms } from '$lib/domain/brief-rules';
import { compileForSend, seriesReferences, shotAttachments } from '$lib/server/references';
import { getAnimateDeps, getGridDeps, getPushDeps, resolveProjectModel } from '$lib/server/config';
import { quoteGrids, sendGrid, settleGrid } from '$lib/server/grid';
import { pushTake } from '$lib/server/review-room-takes';
import { createOpenAICompatibleClient } from '$lib/server/model-provider';
import { draftAnimatePrompt, estimateAnimate, pollGenerations, projectRules, quoteSceneBatch, readStill, sendAnimate, sendSceneBatch, spentThisSession } from '$lib/server/animate';

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
			z.object({ kind: z.literal('confirm'), confirmed_credits: z.number().nonnegative() }),
			z.object({ kind: z.literal('yolo'), cap_credits: z.number().nonnegative(), session_id: z.string().min(1).max(100) })
		])
	}),
	z.object({ action: z.literal('poll') }),
	// Send gate (V1S-279): one scene's shots as one batch, priced and gated, then one approval sends it.
	z.object({ action: z.literal('scene_quote'), group_id: idSchema }),
	// Grid stills (V1S-278): quote a scene's grids, send one after approval, settle it into still takes.
	z.object({ action: z.literal('grid_quote'), group_id: idSchema }),
	z.object({ action: z.literal('grid_send'), group_id: idSchema, chunk: z.number().int().nonnegative(), confirmed_credits: z.number().nonnegative() }),
	z.object({ action: z.literal('grid_settle'), job_id: z.string().min(1).max(200), card_ids: z.array(idSchema).min(1).max(9) }),
	z.object({ action: z.literal('scene_send'), group_id: idSchema, expected_version: z.number().int().nonnegative(), confirmed_credits: z.number().nonnegative() })
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
		if (!polled.ok) return fail(polled.status, polled.code, polled.message);
		// Series episodes linked to Review Room: settled generations are stored there right away (V1S-276).
		let project = polled.project;
		const push = project.series ? await getPushDeps() : null;
		if (push) {
			const settled = new Set((project.production.generations ?? []).filter((generation) => generation.status === 'completed' && generation.take_id).map((generation) => generation.take_id!));
			for (const take of project.production.assets.filter((asset) => settled.has(asset.asset_id) && !asset.review_room)) {
				const pushed = await pushTake(push, projectId.data, take.asset_id);
				if (pushed.ok) project = pushed.project;
			}
		}
		return json({ ok: true, data: project });
	}
	if (body.action === 'grid_quote' || body.action === 'grid_send' || body.action === 'grid_settle') {
		const grid = await getGridDeps();
		if (body.action === 'grid_quote') {
			const project = await grid.store.readProject(projectId.data);
			if (!project) return fail(404, 'NOT_FOUND', 'Project not found');
			const quoted = await quoteGrids(grid, project, body.group_id);
			return quoted.ok ? json({ ok: true, data: quoted.grids }) : fail(quoted.status, 'INVALID_COMMAND', quoted.message);
		}
		if (body.action === 'grid_send') {
			const sent = await sendGrid(grid, { project_id: projectId.data, group_id: body.group_id, chunk: body.chunk, confirmed_credits: body.confirmed_credits });
			return sent.ok ? json({ ok: true, data: sent }) : fail(sent.status, sent.status === 422 ? 'GATE_BLOCKED' : 'INVALID_COMMAND', sent.message, { reasons: sent.reasons ?? [] });
		}
		const settled = await settleGrid(grid, { project_id: projectId.data, job_id: body.job_id, card_ids: body.card_ids });
		return settled.ok ? json({ ok: true, ...(settled.pending ? { pending: true } : { pending: false, data: settled.project, added: settled.added }) }) : fail(settled.status, 'PROVIDER_ERROR', settled.message);
	}
	if (body.action === 'scene_quote') {
		const project = await deps.store.readProject(projectId.data);
		if (!project) return fail(404, 'NOT_FOUND', 'Project not found');
		const quoted = await quoteSceneBatch(deps, project, body.group_id);
		return quoted.ok ? json({ ok: true, data: quoted.batch }) : fail(quoted.status, quoted.code, quoted.message);
	}
	if (body.action === 'scene_send') {
		const sent = await sendSceneBatch(deps, { project_id: projectId.data, expected_version: body.expected_version, group_id: body.group_id, confirmed_credits: body.confirmed_credits });
		return sent.ok ? json({ ok: true, data: sent.project, sent: sent.sent, failed: sent.failed }) : fail(sent.status, sent.code, sent.message, { reasons: sent.reasons ?? [] });
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
	const rules = await projectRules(deps.projectRoot, projectId.data);
	const banned = bannedTerms(rules);
	const settings = { prompt: still.card.video_prompt, duration_s: Math.min(ANIMATE_MAX_S, Math.max(ANIMATE_MIN_S, Math.round(still.card.duration_ms / 1000))), resolution: '480p' as const, generate_audio: true };
	let draftNote: string | null = null;
	const resolved = await resolveProjectModel(project);
	if (resolved.ok) {
		try {
			settings.prompt = await draftAnimatePrompt(createOpenAICompatibleClient(resolved.connection), {
				card: still.card, still: still.bytes, stillType: still.still.mime_type.includes('*') ? 'image/png' : still.still.mime_type,
				rules
			});
		} catch (cause) {
			draftNote = `The Agent couldn't draft a prompt (${cause instanceof Error ? cause.message : 'error'}); starting from the shot's video prompt.`;
		}
	} else {
		draftNote = `No Agent model (${resolved.message}); starting from the shot's video prompt.`;
	}
	const priced = await estimateAnimate(deps, settings);
	// The gate preview checks the prompt as it will be sent: handles compiled against the series' references.
	const references = await seriesReferences(deps.projectRoot, project);
	const compiled = await compileForSend(settings.prompt, references, 'seedance', deps.referenceFiles, shotAttachments(deps.projectRoot, project, still.card));
	return json({
		ok: true,
		data: {
			card_id: still.card.card_id, title: still.card.title,
			still: { url: still.still.url, name: still.still.name, width: still.still.width ?? null, height: still.still.height ?? null },
			settings, draft_note: draftNote,
			estimate: priced.ok ? priced.estimate : null, estimate_error: priced.ok ? null : priced.message,
			configured: Boolean(deps.generator),
			balance: deps.generator ? await deps.generator.balance() : null,
			session_spent_credits: spentThisSession(body.session_id),
			// Gate preview with the current price (confirm mode); the send re-runs the gate for real.
			banned,
			references: references.map(({ name, kind, handles }) => ({ name, kind, handles })),
			blocked: priced.ok ? [...animateGate({ prompt: compiled.prompt, still: still.still, estimate_credits: priced.estimate.credits, mode: { kind: 'confirm', confirmed_credits: priced.estimate.credits }, banned, references }), ...compiled.blocked] : []
		}
	});
};
