import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { emptyPlan, storyPlanSchema, planShotSchema, reconcileMomentEdits, sceneGroupId } from '$lib/domain/story-plan';
import { getGateway, getProjectStore, resolveProjectModel, getReviewRoomConfig, getSeriesStore, getNotionToken } from '$lib/server/config';
import { createNotionApi, pageTitle } from '$lib/server/notion';
import { connectSeries } from '$lib/server/series';
import { commandStatus } from '$lib/server/http';
import { createOpenAICompatibleClient, generateStructured } from '$lib/server/model-provider';
import { readAgentSkill } from '$lib/server/agent-skills';
import { plannedScenes, savePlannedBoard } from '$lib/server/planned-board';
import { connectTrailer } from '$lib/server/review-room-trailer';
import { applyLevelApproval, STORY_LEVELS } from '$lib/domain/story-levels';
import { proposeLevel } from '$lib/server/story-propose';
import type { Project } from '$lib/domain/schemas';
import { createReviewRoomClient } from '$lib/server/review-room';

const requestSchema = z.discriminatedUnion('action', [
	// The Agent proposes one level of the plan (acts, scenes, story beats, shots) for the operator to read and approve.
	z.object({ action: z.literal('propose'), expected_version: z.number().int().nonnegative(), level: z.enum(['acts', 'scenes', 'beats', 'shots']), target_s: z.number().int().min(4).max(600).optional() }),
	z.object({ action: z.literal('approve'), expected_version: z.number().int().nonnegative(), moment_id: z.string() }),
	z.object({ action: z.literal('breakdown'), expected_version: z.number().int().nonnegative(), moment_id: z.string() }),
	z.object({ action: z.literal('save'), expected_version: z.number().int().nonnegative(), plan: storyPlanSchema }),
	z.object({ action: z.literal('board'), expected_version: z.number().int().nonnegative() }),
	// A project from before the story plan gets an empty one (three acts, nothing else).
	z.object({ action: z.literal('begin'), expected_version: z.number().int().nonnegative() }),
	// Approve a story plan level: its names are fixed from here on (decision 22).
	z.object({ action: z.literal('approve_level'), expected_version: z.number().int().nonnegative(), level: z.enum(STORY_LEVELS), show_code: z.string().max(10).optional(), project_code: z.string().max(10).optional() }),
	// Re-read the linked Notion series and replace the Bible snapshot (Notion stays the story master).
	z.object({ action: z.literal('refresh_source'), expected_version: z.number().int().nonnegative() })
]);
export const POST: RequestHandler = async ({ params, request }) => {
	const parsed = requestSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return json({ ok: false, error: { message: parsed.error.issues[0]?.message ?? 'Invalid plan' } }, { status: 400 });
	const store = getProjectStore();
	const project = await store.readProject(params.projectId);
	if (!project) return json({ ok: false, error: { message: 'Project not found' } }, { status: 404 });
	const input = parsed.data;
	if (project.version !== input.expected_version) return json({ ok: false, error: { message: 'Project changed. Reload before continuing.' } }, { status: 409 });
	if (input.action === 'begin') {
		if (project.production.story_plan) return json({ ok: false, error: { message: 'This project already has a story plan' } }, { status: 409 });
		if (project.series) return json({ ok: false, error: { message: 'An episode imported from a series keeps the outline it came with' } }, { status: 400 });
		const story_plan = emptyPlan(project.title, project.seed.brief);
		const outcome = await getGateway().saveProduction({ command: 'save_production', project_id: project.project_id, expected_version: input.expected_version, production: { ...project.production, story_plan } });
		return json(outcome, { status: outcome.ok ? 200 : commandStatus(outcome.error) });
	}
	if (input.action === 'approve_level') {
		const { level, show_code, project_code } = input;
		const codes = { ...(show_code ? { show_code } : {}), ...(project_code ? { project_code } : {}) };
		try {
			// A trailer stored in Review Room gets its new scene folders and shot names there in the same step.
			let connection: Project['review_room'];
			if (level === 'shots' && project.review_room) {
				const config = getReviewRoomConfig();
				if (!config) return json({ ok: false, error: { message: 'Review Room must be configured before this trailer’s shot list is approved' } }, { status: 503 });
				const preview = applyLevelApproval(project, level, new Date().toISOString(), codes);
				connection = await connectTrailer(createReviewRoomClient(config), preview, { ...project.review_room, scenes: plannedScenes(project, preview.production) });
			}
			const outcome = await getGateway().approveStoryLevel(project.project_id, input.expected_version, { level, ...codes }, connection);
			return json(outcome, { status: outcome.ok ? 200 : commandStatus(outcome.error) });
		} catch (cause) {
			return json({ ok: false, error: { message: cause instanceof Error ? cause.message : 'That level could not be approved' } }, { status: 400 });
		}
	}
	if (input.action === 'refresh_source') {
		const plan = project.production.story_plan;
		const seriesId = plan?.source?.series_id;
		if (!plan?.source || !seriesId) return json({ ok: false, error: { message: 'This story was not imported from a Notion series' } }, { status: 400 });
		const token = await getNotionToken();
		if (!token) return json({ ok: false, error: { message: 'Connect Notion in Settings first' } }, { status: 503 });
		const record = await getSeriesStore().read(seriesId);
		if (!record) return json({ ok: false, error: { message: 'The linked Notion series is no longer connected' } }, { status: 404 });
		try {
			const fresh = await connectSeries(createNotionApi(token), getSeriesStore(), record.notion_root_id, await pageTitle(token, record.notion_root_id));
			if (!fresh.story) return json({ ok: false, error: { message: 'No story page in the Notion series' } }, { status: 400 });
			const source = { ...plan.source, title: fresh.story.title, text: fresh.story.text, url: `https://www.notion.so/${fresh.story.page_id}`, imported_at: new Date().toISOString(),
				references: fresh.references?.items.map((ref) => ({ key: ref.page_id, name: ref.name, kind: ref.kind })) ?? plan.source.references };
			const saved = await getGateway().saveProduction({ command: 'save_production', project_id: project.project_id, expected_version: project.version, production: { ...project.production, story_plan: { ...plan, source } } });
			return saved.ok ? json({ ok: true, data: saved.data, source: { title: source.title, imported_at: source.imported_at } }) : json({ ok: false, error: saved.error }, { status: 409 });
		} catch (cause) {
			return json({ ok: false, error: { message: cause instanceof Error ? cause.message : 'Notion could not be read' } }, { status: 502 });
		}
	}
	if (input.action === 'save') {
		const source = input.plan.prep_source_project_id;
		if (source && (source === project.project_id || !(await store.readProject(source)))) return json({ ok: false, error: { message: 'Choose an existing reference project other than this project' } }, { status: 400 });
		if (input.plan.sections.some(section => section.moments.some(shot => shot.candidate_asset_id && !project.production.assets.some(asset => asset.asset_id === shot.candidate_asset_id)))) return json({ ok: false, error: { message: 'A candidate take is no longer in this project' } }, { status: 400 });
		if (input.plan.sections.some(section => section.moments.some(moment => moment.shots.some(shot => shot.card_id && !project.production.cards.some(card => card.card_id === shot.card_id))))) return json({ ok: false, error: { message: 'A linked board shot is no longer in this project' } }, { status: 400 });
		const scenes = input.plan.sections.flatMap(section => section.scenes);
		const lost = scenes.find(scene => scene.group_id && !project.production.groups?.some(group => group.group_id === scene.group_id));
		if (lost) return json({ ok: false, error: { message: `${lost.title} points at a board group that is no longer in this project` } }, { status: 400 });
		const taken = Object.entries(project.review_room?.scenes ?? {});
		const clash = scenes.find(scene => scene.scene_code && taken.some(([groupId, stored]) => stored.code === scene.scene_code && groupId !== sceneGroupId(scene)));
		if (clash) return json({ ok: false, error: { message: `Scene code ${clash.scene_code} already names another scene in Review Room` } }, { status: 400 });
		const renamed = scenes.find(scene => { const stored = project.review_room?.scenes?.[sceneGroupId(scene)]; return stored && scene.scene_code && scene.scene_code !== stored.code; });
		if (renamed) return json({ ok: false, error: { message: `${renamed.title} already has the Review Room scene code ${project.review_room!.scenes![sceneGroupId(renamed)].code}; codes never change` } }, { status: 400 });
	} else if (!project.production.story_plan) return json({ ok: false, error: { message: 'Save a shot plan first' } }, { status: 400 });
	let production = input.action === 'save' ? { ...project.production, story_plan: reconcileMomentEdits(project.production.story_plan, input.plan) } : project.production;
	if (input.action === 'propose') {
		// The Agent proposes one level. It fills what is empty and never touches what is there (domain/story-propose).
		const resolved = await resolveProjectModel(project);
		if (!resolved.ok) return json({ ok: false, error: { message: resolved.message } }, { status: 503 });
		try {
			const proposed = await proposeLevel(createOpenAICompatibleClient(resolved.connection), project, input.level, { target_s: input.target_s, shotRules: input.level === 'shots' ? `The Ghost skill guides physical, readable coverage:\n${await readAgentSkill('ghost')}` : undefined });
			if (!proposed.ok) return json({ ok: false, error: { message: proposed.why } }, { status: 400 });
			const outcome = await getGateway().saveProduction({ command: 'save_production', project_id: project.project_id, expected_version: input.expected_version, production: { ...project.production, story_plan: proposed.plan } });
			return json(outcome.ok ? { ...outcome, added: proposed.added } : outcome, { status: outcome.ok ? 200 : commandStatus(outcome.error) });
		} catch (cause) {
			return json({ ok: false, error: { message: cause instanceof Error ? cause.message : 'The Agent could not propose that level' } }, { status: 502 });
		}
	}
	if (input.action === 'board') {
		try {
			const config = getReviewRoomConfig();
			const outcome = await savePlannedBoard(project, getGateway(), config ? createReviewRoomClient(config) : undefined);
			return json(outcome, { status: outcome.ok ? 200 : commandStatus(outcome.error) });
		} catch (cause) {
			return json({ ok: false, error: { message: cause instanceof Error ? cause.message : 'Review Room folder sync failed' } }, { status: 502 });
		}
	}
	if (input.action === 'approve' || input.action === 'breakdown') {
		const plan = structuredClone(project.production.story_plan!);
		const moment = plan.sections.flatMap(section => section.moments).find(entry => entry.id === input.moment_id);
		if (!moment) return json({ ok: false, error: { message: 'Story beat not found' } }, { status: 404 });
		if (input.action === 'approve') moment.approved = true;
		else {
			if (!moment.approved) return json({ ok: false, error: { message: 'Approve this story beat before drafting shots' } }, { status: 400 });
			if (moment.shots.length) return json({ ok: false, error: { message: 'This story beat already has a breakdown; review it before replacing it' } }, { status: 409 });
			const resolved = await resolveProjectModel(project);
			if (!resolved.ok) return json({ ok: false, error: { message: resolved.message } }, { status: 503 });
			try {
				const schema = z.object({ shots: z.array(planShotSchema.omit({ id: true, card_id: true })).min(1).max(12) });
				const result = await generateStructured(createOpenAICompatibleClient(resolved.connection), {
					system: `You are a trailer editor breaking one owner-approved story beat into shots. Follow the supplied Bible; never invent new canon, identities, powers, reveals or dialogue. Preserve its misdirection. This is a shot specification, not a final generation prompt. Use exact declared character names and locations; never generic substitutes. Do not generate media. The Ghost skill guides physical, readable coverage:\n${await readAgentSkill('ghost')}`,
					prompt: `Return JSON only {shots:[{title,beat,duration_s}]}. Durations must sum to ${moment.duration_s} seconds. Give concrete shots, dramatic intent and any specified internal narration, and room for longer source performances. Source Bible:\n${plan.source?.text ?? '(none)'}\nTrailer direction:\n${project.production.premise}\nApproved moment:\n${JSON.stringify(moment)}\nExisting named references:\n${JSON.stringify(plan.source?.references ?? [])}`,
					maxOutputTokens: 2400, timeoutMs: 90_000
				}, value => schema.parse(value));
				if (Math.abs(result.shots.reduce((sum, shot) => sum + shot.duration_s, 0) - moment.duration_s) > 0.05) throw new Error('The proposed shots do not fit this story beat’s time budget. Try drafting again.');
				moment.shots = result.shots.map(shot => ({ ...shot, id: crypto.randomUUID() }));
			} catch (cause) { return json({ ok: false, error: { message: cause instanceof Error ? cause.message : 'Shot breakdown failed' } }, { status: 502 }); }
		}
		production = { ...production, story_plan: plan };
	}
	const outcome = await getGateway().saveProduction({ command: 'save_production', project_id: project.project_id, expected_version: input.expected_version, production });
	return json(outcome, { status: outcome.ok ? 200 : commandStatus(outcome.error) });
};
