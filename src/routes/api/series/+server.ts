import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getNotionToken, getSeriesStore } from '$lib/server/config';
import { createNotionApi, pageIdOf, pageTitle } from '$lib/server/notion';
import { connectSeries } from '$lib/server/series';
import { notionFailure } from './notion-errors';

/** The connected series, and whether a Notion token is set up (its value never leaves the server). */
export const GET: RequestHandler = async () => {
	return json({ ok: true, data: { notion_configured: Boolean(getNotionToken()), series: await getSeriesStore().list() } });
};

const bodySchema = z.object({ root: z.string().min(1).max(500) });

/** Connect a series from its Notion root page (link or id): find, check and list it. Read-only in Notion. */
export const POST: RequestHandler = async ({ request }) => {
	const token = getNotionToken();
	if (!token) return json({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'Add NOTION_TOKEN to .env.local first (your Creative Studio Pro connection token)' } }, { status: 503 });
	const body = bodySchema.safeParse(await request.json().catch(() => null));
	if (!body.success) return json({ ok: false, error: { code: 'INVALID_COMMAND', message: 'Paste the series root page link' } }, { status: 400 });
	const rootId = pageIdOf(body.data.root);
	if (!rootId) return json({ ok: false, error: { code: 'INVALID_COMMAND', message: "That doesn't look like a Notion page link" } }, { status: 400 });
	try {
		const record = await connectSeries(createNotionApi(token), getSeriesStore(), rootId, await pageTitle(token, rootId).catch(() => null));
		return json({ ok: true, data: record });
	} catch (cause) {
		return notionFailure(cause);
	}
};
