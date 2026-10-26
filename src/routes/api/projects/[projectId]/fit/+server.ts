import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema, type Project, type StoryCard } from '$lib/domain/schemas';
import { uuid7ish } from '$lib/domain/ids';
import { bannedTerms } from '$lib/domain/brief-rules';
import { episodeOutline } from '$lib/domain/episode-outline';
import { awaitingApproval, fitPlan, proposedCards, removeShots } from '$lib/domain/episode-fit';
import { keyframeOf, PROMPT_PENDING, shotSpecSchema, specLine } from '$lib/domain/shot-spec';
import { getGateway, getNotionToken, getProjectRoot, getProjectStore, getSeriesStore, resolveProjectModel } from '$lib/server/config';
import { createNotionApi } from '$lib/server/notion';
import { drainNotionTrash, removedShotPages } from '$lib/server/notion-sync';
import { commandStatus } from '$lib/server/http';
import { createOpenAICompatibleClient } from '$lib/server/model-provider';
import { projectRules } from '$lib/server/animate';
import { fitContext, type FitContext } from '$lib/server/episode-fit';
import { freshIdeas, ghostSystem, proposeShots, SpecCheckFailed, writeShotPrompt } from '$lib/server/ghost-shots';
import { readPrep } from '$lib/server/prep';
import { handOffLine, identityGaps } from '$lib/domain/prep';

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : status === 409 ? 'VERSION_CONFLICT' : 'INVALID_COMMAND', message, retryable: status >= 500, source: 'fit' } }, { status });

const version = z.number().int().nonnegative();
const sceneIds = z.array(z.string().max(64)).max(100).optional();
const bodySchema = z.discriminatedUnion('action', [
	// V1S-375: Ghost proposes the coverage of every short scene (or only these) as shot specs; streamed, saved scene by scene.
	z.object({ action: z.literal('fit'), expected_version: version, target_min: z.number().int().min(1).max(120), scene_ids: sceneIds }),
	// The operator approves a scene's proposed shots; Ghost then writes each one's prompt (streamed).
	z.object({ action: z.literal('approve'), expected_version: version, target_min: z.number().int().min(1).max(120), scene_ids: z.array(z.string().max(64)).min(1).max(100) }),
	// Change one proposed shot's spec before approval.
	z.object({ action: z.literal('edit_spec'), expected_version: version, card_id: idSchema, spec: shotSpecSchema }),
	// V1S-377: two fresh concepts for one Ghost shot (shot specs; nothing saved), and using one of them.
	z.object({ action: z.literal('fresh_idea'), expected_version: version, target_min: z.number().int().min(1).max(120), card_id: idSchema }),
	z.object({ action: z.literal('use_idea'), expected_version: version, card_id: idSchema, title: z.string().trim().min(1).max(120), spec: shotSpecSchema }),
	// Take one proposed shot out (no takes yet).
	z.object({ action: z.literal('reject'), expected_version: version, card_id: idSchema }),
	// Take fitted beats out again (all, or these scenes'); beats with takes stay.
	z.object({ action: z.literal('unfit'), expected_version: version, scene_ids: sceneIds }),
	// This episode's own target length (V1S-277); null = the series format.
	z.object({ action: z.literal('target'), expected_version: version, target_min: z.number().int().min(1).max(120).nullable() })
]);

/** One JSON object per line: status, checks, each saved scene or shot, then done or error. */
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

/** V1S-371: removed shots' Notion pages go to Notion's Trash; what fails stays queued for the next Sync. */
async function trashRemoved(before: Project, after: Project): Promise<{ shots_trashed: number; trash_error: string | null }> {
	const pages = removedShotPages(before.production.cards, after.production.cards);
	const store = getSeriesStore();
	const record = pages.length && before.series ? await store.read(before.series.series_id) : null;
	if (!record) return { shots_trashed: 0, trash_error: null };
	const queued = await store.write({ ...record, notion_trash: [...new Set([...(record.notion_trash ?? []), ...pages])] });
	const token = getNotionToken();
	if (!token) return { shots_trashed: 0, trash_error: 'NOTION_TOKEN is not set; the shot pages go to Trash on the next Sync' };
	const trash = await drainNotionTrash(createNotionApi(token), queued);
	await store.write(trash.record);
	return { shots_trashed: trash.trashed, trash_error: trash.error };
}

const saveCards = (project: Project, cards: StoryCard[]) =>
	getGateway().saveProduction({ command: 'save_production', project_id: project.project_id, expected_version: project.version, production: { ...project.production, cards } });

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
	const groupsOf = (ids?: string[]) => ids && series.scenes.filter((scene) => ids.includes(scene.page_id)).map((scene) => scene.group_id);
	const b = body.data;

	if (b.action === 'unfit') {
		const outcome = await getGateway().unfitEpisode(projectId.data, b.expected_version, groupsOf(b.scene_ids));
		if (!outcome.ok) return json(outcome, { status: commandStatus(outcome.error) });
		return json({ ...outcome, removed: project.production.cards.length - outcome.data.production.cards.length, ...(await trashRemoved(project, outcome.data)) });
	}
	if (b.action === 'target') {
		const outcome = await getGateway().setTargetLength(projectId.data, b.expected_version, b.target_min);
		return outcome.ok ? json(outcome) : json(outcome, { status: commandStatus(outcome.error) });
	}
	if (b.action === 'reject') {
		const card = project.production.cards.find((entry) => entry.card_id === b.card_id);
		if (!card?.fit?.spec) return fail(400, 'Only a proposed shot can be taken out here');
		const removed = removeShots(project.production, [b.card_id]);
		if (!removed.removed) return fail(400, 'That shot has takes; bench it instead');
		const outcome = await getGateway().saveProduction({ command: 'save_production', project_id: project.project_id, expected_version: project.version, production: removed.production });
		if (!outcome.ok) return json(outcome, { status: commandStatus(outcome.error) });
		return json({ ...outcome, ...(await trashRemoved(project, outcome.data)) });
	}
	if (b.action === 'edit_spec') {
		const card = project.production.cards.find((entry) => entry.card_id === b.card_id);
		if (!card?.fit?.spec) return fail(400, 'That card has no shot spec');
		if (card.fit.approved_at) return fail(400, 'That shot is already approved; its prompt is written from the approved spec');
		const cards = project.production.cards.map((entry) => entry.card_id !== b.card_id ? entry : {
			...entry, beat: specLine(b.spec).slice(0, 4000), duration_ms: b.spec.duration_s * 1000, image_prompt: keyframeOf(b.spec).slice(0, 5000),
			fit: { ...entry.fit!, spec: b.spec, dialogue: b.spec.dialogue || undefined }
		});
		const outcome = await saveCards(project, cards);
		return outcome.ok ? json(outcome) : json(outcome, { status: commandStatus(outcome.error) });
	}

	if (b.action === 'use_idea') {
		const card = project.production.cards.find((entry) => entry.card_id === b.card_id);
		if (!card?.fit?.spec) return fail(400, 'That card has no shot spec');
		if (project.production.assets.some((asset) => asset.card_id === b.card_id && !asset.rejected)) return fail(400, 'That shot already has takes; a fresh idea replaces a shot before it is made');
		// The new spec waits for approval like any proposed shot; Ghost writes its prompt after that.
		const cards = project.production.cards.map((entry) => entry.card_id !== b.card_id ? entry : {
			...entry, beat: specLine(b.spec).slice(0, 4000), duration_ms: b.spec.duration_s * 1000, image_prompt: keyframeOf(b.spec).slice(0, 5000), video_prompt: PROMPT_PENDING,
			fit: { ...entry.fit!, spec: b.spec, approved_at: undefined, qc: undefined, prompt_edited: undefined, ideas_used: [...(entry.fit!.ideas_used ?? []), b.title].slice(-20) }
		});
		const outcome = await saveCards(project, cards);
		return outcome.ok ? json(outcome) : json(outcome, { status: commandStatus(outcome.error) });
	}

	const resolved = await resolveProjectModel(project);
	if (!resolved.ok) return fail(503, `No Agent model: ${resolved.message}`);
	const client = createOpenAICompatibleClient(resolved.connection);
	const agent = resolved.connection.choice.provider === 'kimi' ? `Kimi ${resolved.connection.choice.model}` : resolved.connection.choice.model;
	const record = await getSeriesStore().read(series.series_id);
	const story = record?.story?.text ?? '';
	const allReferences = record?.references?.items ?? [];
	const beats = record?.story_beats?.beats ?? [];
	const banned = bannedTerms((await projectRules(getProjectRoot(), projectId.data)) ?? '');
	const system = await ghostSystem();
	// The ONE SHOT hand-off lines made in Prep (CHARACTER … / LOCATION …): Ghost uses them instead of re-describing anyone.
	const prep = await readPrep(getProjectRoot(), projectId.data);
	const handOffs = Object.fromEntries(Object.values(prep.entries).flatMap((state) => (state.spec && !identityGaps(state.spec).length ? [[state.spec.name, handOffLine(state.spec)]] : [])));
	const target_min = b.target_min;
	/** What Ghost reads for one scene (its action, dialogue, story beats, references, the shots so far). */
	const contextFor = (current: Project, scene: FitContext['scene']): FitContext => {
		const outline = episodeOutline(series, current.production.cards, target_min);
		const order = outline.acts.flatMap((act) => act.scenes);
		const next = order[order.findIndex((row) => row.page_id === scene.page_id) + 1];
		const imported = series.scenes.find((entry) => entry.page_id === scene.page_id);
		const storyBeats = beats.filter((beat) => imported?.story_beat_ids?.includes(beat.page_id) || beat.scene_ids.includes(scene.page_id)).toSorted((x, y) => (x.order ?? 0) - (y.order ?? 0)).map((beat) => ({ title: beat.title, section: beat.section, summary: beat.summary }));
		const references = allReferences.filter((ref) => imported?.reference_ids?.includes(ref.page_id) || ref.scene_ids.includes(scene.page_id));
		const sceneCards = current.production.cards.filter((card) => card.group_id === scene.group_id).toSorted((x, y) => x.order - y.order);
		return { story, series, outline, target_min, scene, sceneCards, banned, storyBeats, references, allReferences, handOffs, nextScene: next ? { title: next.title, summary: next.summary } : null };
	};

	if (b.action === 'fresh_idea') {
		const card = project.production.cards.find((entry) => entry.card_id === b.card_id);
		const scene = series.scenes.find((entry) => entry.group_id === card?.group_id);
		if (!card?.fit?.spec || !scene) return fail(400, 'A fresh idea is for a shot Ghost proposed');
		const context = fitContext(contextFor(project, { page_id: scene.page_id, group_id: scene.group_id, title: scene.title, gap_s: 0, shots_wanted: 1 }));
		try {
			const ideas = await freshIdeas(client, { context, title: card.title, spec: card.fit.spec, earlier: card.fit.ideas_used ?? [] });
			return json({ ok: true, data: ideas });
		} catch (cause) { return fail(502, cause instanceof Error ? cause.message : 'The Agent could not pitch'); }
	}

	if (b.action === 'approve') {
		const scenes = series.scenes.filter((scene) => b.scene_ids.includes(scene.page_id));
		return stream(async (send) => {
			let current: Project = project;
			for (const scene of scenes) {
				const waiting = awaitingApproval(current.production.cards, scene.group_id).toSorted((x, y) => x.order - y.order);
				if (!waiting.length) continue;
				send({ type: 'plan', scene: scene.page_id, shots: waiting.map((card) => card.card_id) });
				const context = fitContext(contextFor(current, { page_id: scene.page_id, group_id: scene.group_id, title: scene.title, gap_s: 0, shots_wanted: waiting.length }));
				for (const card of waiting) {
					send({ type: 'status', scene: scene.page_id, card: card.card_id, text: `${agent} (Ghost) is writing ${card.title}…` });
					try {
						const written = await writeShotPrompt(client, { system, context, title: card.title, spec: card.fit!.spec!, references: allReferences, banned });
						const fresh = (await getProjectStore().readProject(projectId.data)) ?? current;
						const cards = fresh.production.cards.map((entry) => entry.card_id !== card.card_id ? entry : {
							...entry, video_prompt: written.video_prompt.slice(0, 5000),
							fit: { ...entry.fit!, approved_at: new Date().toISOString(), prompt_edited: false, qc: written.qc.map((issue) => issue.slice(0, 500)).slice(0, 40), lint: { rounds: written.rounds, fixed: 0, remaining: written.qc.length } }
						});
						const outcome = await saveCards(fresh, cards);
						if (!outcome.ok) { send({ type: 'error', message: outcome.error.message }); return; }
						current = outcome.data;
						send({ type: 'shot_done', scene: scene.page_id, card: card.card_id, qc: written.qc, data: current });
					} catch (cause) {
						send({ type: 'shot_failed', scene: scene.page_id, card: card.card_id, message: cause instanceof Error ? cause.message : 'model error' });
					}
				}
			}
			send({ type: 'done', ok: true, data: current });
		});
	}

	const plan = fitPlan(episodeOutline(series, project.production.cards, target_min), b.scene_ids);
	if (plan.length === 0) return fail(400, `Every scene already fills its share of ${target_min} min`);
	return stream(async (send) => {
		let current: Project = project;
		send({ type: 'plan', scenes: plan });
		for (const [index, scene] of plan.entries()) {
			const input = contextFor(current, scene);
			send({ type: 'status', scene: scene.page_id, text: `${agent} (Ghost) is proposing ${scene.shots_wanted} shot${scene.shots_wanted === 1 ? '' : 's'} for ${scene.title} (${index + 1} of ${plan.length})…` });
			let specs;
			try { specs = await proposeShots(client, { ...input, system }, (round, problems) => send({ type: 'check', scene: scene.page_id, round, problems })); }
			catch (cause) {
				// One scene failing does not undo the scenes already saved.
				send({ type: 'scene_failed', scene: scene.page_id, message: cause instanceof Error ? cause.message : 'model error', ...(cause instanceof SpecCheckFailed ? { problems: cause.problems } : {}) });
				continue;
			}
			const cards = proposedCards(scene, input.sceneCards, specs, { newId: uuid7ish, now: new Date().toISOString(), target_min, summary: series.scenes.find((s) => s.page_id === scene.page_id)?.summary ?? '' });
			const outcome = await getGateway().fitScene(projectId.data, current.version, scene.group_id, cards);
			if (!outcome.ok) { send({ type: 'error', message: outcome.error.message }); return; }
			current = outcome.data;
			send({ type: 'scene_done', scene: scene.page_id, added: cards.length, seconds: cards.reduce((sum, card) => sum + card.duration_ms / 1000, 0), lint_remaining: 0, data: current });
		}
		send({ type: 'done', ok: true, data: current });
	});
};
