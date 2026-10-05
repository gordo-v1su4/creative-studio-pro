import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema, type Project } from '$lib/domain/schemas';
import { uuid7ish } from '$lib/domain/ids';
import { bannedTerms } from '$lib/domain/brief-rules';
import { episodeOutline } from '$lib/domain/episode-outline';
import { fitPlan, fittedCards } from '$lib/domain/episode-fit';
import { getGateway, getProjectRoot, getProjectStore, getSeriesStore, resolveProjectModel } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';
import { createOpenAICompatibleClient } from '$lib/server/model-provider';
import { projectRules } from '$lib/server/animate';
import { fitScene, fitSystemPrompt } from '$lib/server/episode-fit';

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : status === 409 ? 'VERSION_CONFLICT' : 'INVALID_COMMAND', message, retryable: status >= 500, source: 'fit' } }, { status });

const version = z.number().int().nonnegative();
const bodySchema = z.discriminatedUnion('action', [
	// The Agent fills every short scene (or only these) toward the episode length; streamed, saved scene by scene.
	z.object({ action: z.literal('fit'), expected_version: version, target_min: z.number().int().min(1).max(120), scene_ids: z.array(z.string().max(64)).max(100).optional() }),
	// Take fitted beats out again (all, or these scenes'); beats with takes stay.
	z.object({ action: z.literal('unfit'), expected_version: version, scene_ids: z.array(z.string().max(64)).max(100).optional() })
]);

/** One JSON object per line: status, the shots as written, each lint round, each saved scene, then done or error. */
function stream(run: (send: (event: Record<string, unknown>) => void) => Promise<void>): Response {
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
			try { await run(send); }
			catch (cause) { send({ type: 'error', message: `The Agent couldn't answer: ${cause instanceof Error ? cause.message : 'model error'}` }); }
			finally { controller.close(); }
		}
	});
	return new Response(body, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
}

export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	const body = bodySchema.safeParse(await request.json().catch(() => null));
	if (!body.success) return fail(400, body.error.issues[0]?.message ?? 'Invalid request');
	const project = await getProjectStore().readProject(projectId.data);
	if (!project) return fail(404, 'Project not found');
	if (project.version !== body.data.expected_version) return fail(409, 'The project changed; reload and try again');
	const series = project.series;
	if (!series) return fail(400, 'Only an episode imported from Notion can be fitted');
	const groupsOf = (sceneIds?: string[]) => sceneIds && series.scenes.filter((scene) => sceneIds.includes(scene.page_id)).map((scene) => scene.group_id);

	if (body.data.action === 'unfit') {
		const outcome = await getGateway().unfitEpisode(projectId.data, body.data.expected_version, groupsOf(body.data.scene_ids));
		return outcome.ok
			? json({ ...outcome, removed: project.production.cards.length - outcome.data.production.cards.length })
			: json(outcome, { status: commandStatus(outcome.error) });
	}

	const { target_min, scene_ids } = body.data;
	const plan = fitPlan(episodeOutline(series, project.production.cards, target_min), scene_ids);
	if (plan.length === 0) return fail(400, `Every scene already fills its share of ${target_min} min`);
	const resolved = await resolveProjectModel(project);
	if (!resolved.ok) return fail(503, `No Agent model: ${resolved.message}`);
	const client = createOpenAICompatibleClient(resolved.connection);
	const agent = resolved.connection.choice.provider === 'kimi' ? `Kimi ${resolved.connection.choice.model}` : resolved.connection.choice.model;
	const story = (await getSeriesStore().read(series.series_id))?.story?.text ?? '';
	const banned = bannedTerms((await projectRules(getProjectRoot(), projectId.data)) ?? '');
	const system = await fitSystemPrompt();

	return stream(async (send) => {
		let current: Project = project;
		send({ type: 'plan', scenes: plan });
		for (const [index, scene] of plan.entries()) {
			const outline = episodeOutline(series, current.production.cards, target_min);
			const order = outline.acts.flatMap((act) => act.scenes);
			const at = order.findIndex((row) => row.page_id === scene.page_id);
			const next = order[at + 1];
			const sceneCards = current.production.cards.filter((card) => card.group_id === scene.group_id).toSorted((a, b) => a.order - b.order);
			send({ type: 'status', scene: scene.page_id, text: `${agent} is writing ${scene.shots_wanted} shot${scene.shots_wanted === 1 ? '' : 's'} for ${scene.title} (${index + 1} of ${plan.length})…` });
			let shots;
			try {
				shots = await fitScene(client, {
					system, story, series, outline, target_min, scene, sceneCards, banned,
					nextScene: next ? { title: next.title, summary: next.summary } : null
				}, (written) => {
					send({ type: 'shots', scene: scene.page_id, shots: written.map((shot) => ({ description: shot.description, duration_s: shot.duration_s })) });
					send({ type: 'status', scene: scene.page_id, text: `Linting ${written.length} prompt${written.length === 1 ? '' : 's'} for ${scene.title}…` });
				}, (shot, round) => send({ type: 'lint', scene: scene.page_id, shot, round: round.round, issues: round.issues.length }));
			} catch (cause) {
				// One scene failing does not undo the scenes already saved.
				send({ type: 'scene_failed', scene: scene.page_id, message: cause instanceof Error ? cause.message : 'model error' });
				continue;
			}
			const cards = fittedCards(scene, sceneCards, shots, { newId: uuid7ish, now: new Date().toISOString(), target_min, summary: series.scenes.find((s) => s.page_id === scene.page_id)?.summary ?? '' });
			const outcome = await getGateway().fitScene(projectId.data, current.version, scene.group_id, cards);
			if (!outcome.ok) { send({ type: 'error', message: outcome.error.message }); return; }
			current = outcome.data;
			send({ type: 'scene_done', scene: scene.page_id, added: cards.length, seconds: cards.reduce((sum, card) => sum + card.duration_ms / 1000, 0), lint_remaining: shots.reduce((sum, shot) => sum + shot.lint.remaining, 0), data: current });
		}
		send({ type: 'done', ok: true, data: current });
	});
};
