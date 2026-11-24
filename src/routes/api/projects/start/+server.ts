import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getGateway, getProjectStore, getSeriesStore, getNotionToken } from '$lib/server/config';
import { createNotionApi, pageIdOf, pageTitle } from '$lib/server/notion';
import { connectSeries } from '$lib/server/series';
import { emptyPlan, type StoryPlan } from '$lib/domain/story-plan';

const schema = z.object({
	path: z.enum(['need_idea', 'have_idea', 'have_story']), title: z.string().trim().min(1).max(200),
	text: z.string().trim().max(100_000).default(''), series_id: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(), notion_root: z.string().max(500).optional(),
	prep_source_project_id: z.string().regex(/^[A-Za-z0-9_-]+$/).optional()
});
export const POST: RequestHandler = async ({ request }) => {
	const parsed = schema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return json({ ok: false, error: { message: parsed.error.issues[0]?.message ?? 'Invalid starting point' } }, { status: 400 });
	const input = parsed.data;
	let record = input.series_id ? await getSeriesStore().read(input.series_id) : null;
	if (input.series_id && !record) return json({ ok: false, error: { message: 'The connected series was not found' } }, { status: 404 });
	if (input.prep_source_project_id && !(await getProjectStore().readProject(input.prep_source_project_id))) return json({ ok: false, error: { message: 'The reference project was not found' } }, { status: 404 });
	try {
		if (input.notion_root || record) {
			const token = getNotionToken();
			if (!token) throw new Error('Connect Notion in Settings before importing a series');
			const root = input.notion_root ? pageIdOf(input.notion_root) : record!.notion_root_id;
			if (!root) throw new Error('Paste a valid Notion series page link');
			record = await connectSeries(createNotionApi(token), getSeriesStore(), root, await pageTitle(token, root));
			if (!record.story?.text.trim()) throw new Error('No story Bible was found under that series. Connect its containing series page or paste the story text.');
		}
		const text = record?.story?.text ?? input.text;
		if (input.path !== 'need_idea' && !text.trim()) throw new Error('Add your idea, paste your story, or import a Notion series');
		const created = await getGateway().createProject({ command: 'create_project', title: input.title, brief: text.slice(0, 5000), creative_focus: 'full room', created_by: 'gordo' });
		if (!created.ok) return json(created, { status: 400 });
		const project = created.data;
		// Every project has a story plan from the start, so its five levels show even before there is an idea (the Agent pitches one).
		const plan: StoryPlan = {
			...emptyPlan(input.title, text, {
				...(record ? { series_id: record.series_id, url: `https://www.notion.so/${record.story!.page_id}` } : {}),
				title: record?.story?.title ?? (input.path === 'have_story' ? 'Supplied story' : input.path === 'need_idea' ? 'Direction for the pitch' : 'Starting idea'),
				references: record?.references?.items.map(ref => ({ key: ref.page_id, name: ref.name, kind: ref.kind })) ?? []
			}),
			...(input.prep_source_project_id ? { prep_source_project_id: input.prep_source_project_id } : {})
		};
		const saved = await getGateway().saveProduction({ command: 'save_production', project_id: project.project_id, expected_version: project.version, production: { ...project.production, title: input.title, premise: record ? 'Develop this deliverable from the linked Notion Bible. The imported text is a read-only source snapshot; Notion remains the story master.' : input.text.slice(0, 8000), story_plan: plan } });
		if (!saved.ok) return json({ ...saved, project_id: project.project_id }, { status: 400 });
		return json(saved, { status: 201 });
	} catch (cause) { return json({ ok: false, error: { message: cause instanceof Error ? cause.message : 'Could not import the story' } }, { status: 400 }); }
};
