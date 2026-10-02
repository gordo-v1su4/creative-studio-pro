import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getGateway, getNotionToken, getProjectStore, getSeriesStore } from '$lib/server/config';
import { createNotionApi, pageTitle } from '$lib/server/notion';
import { connectSeries, importEpisode } from '$lib/server/series';
import { notionFailure } from '../notion-errors';

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : 'INVALID_COMMAND', message } }, { status });

export const GET: RequestHandler = async ({ params }) => {
	const record = await getSeriesStore().read(params.seriesId);
	return record ? json({ ok: true, data: record }) : fail(404, 'Series not found');
};

const bodySchema = z.discriminatedUnion('action', [
	// Read the series again from Notion (template check, story, episode list).
	z.object({ action: z.literal('refresh') }),
	// The episode length to plan for.
	z.object({ action: z.literal('runtime'), runtime_min: z.number().int().min(1).max(120) }),
	// Import one episode as a new project.
	z.object({ action: z.literal('import'), episode_page_id: z.string().min(1).max(64) })
]);

export const POST: RequestHandler = async ({ params, request }) => {
	const store = getSeriesStore();
	const record = await store.read(params.seriesId);
	if (!record) return fail(404, 'Series not found');
	const body = bodySchema.safeParse(await request.json().catch(() => null));
	if (!body.success) return fail(400, body.error.issues[0]?.message ?? 'Invalid request');
	if (body.data.action === 'runtime') return json({ ok: true, data: await store.write({ ...record, runtime_min: body.data.runtime_min }) });

	const token = getNotionToken();
	if (!token) return json({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'Add NOTION_TOKEN to .env.local first' } }, { status: 503 });
	const api = createNotionApi(token);
	try {
		if (body.data.action === 'refresh') {
			return json({ ok: true, data: await connectSeries(api, store, record.notion_root_id, await pageTitle(token, record.notion_root_id).catch(() => record.title)) });
		}
		const existing = record.episode_projects[body.data.episode_page_id];
		if (existing && (await getProjectStore().readProject(existing))) return fail(400, 'That episode is already imported; open its project');
		const result = await importEpisode(api, store, getGateway(), record, body.data.episode_page_id);
		return json({ ok: true, data: result.record, project_id: result.project.project_id, scenes: result.layout.scenes.length, shots: result.project.production.cards.length, seconds: result.layout.seconds });
	} catch (cause) {
		if (cause instanceof Error && !(cause as { code?: string }).code) return fail(400, cause.message);
		return notionFailure(cause);
	}
};
