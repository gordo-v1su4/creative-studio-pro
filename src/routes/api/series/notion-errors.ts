import { json } from '@sveltejs/kit';

/** A Notion API failure as plain advice (an unshared page is the usual cause). */
export function notionFailure(cause: unknown) {
	const code = (cause as { code?: string })?.code;
	const message = cause instanceof Error ? cause.message : 'Notion request failed';
	if (code === 'unauthorized') return json({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'Notion refused the token: check NOTION_TOKEN in .env.local' } }, { status: 401 });
	if (code === 'object_not_found' || code === 'restricted_resource') return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Notion can\'t see that page: open it in Notion → ••• → Connections → add "Creative Studio Pro"' } }, { status: 404 });
	if (code === 'rate_limited') return json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Notion is rate-limiting; try again in a minute' } }, { status: 429 });
	return json({ ok: false, error: { code: 'NOTION_ERROR', message } }, { status: 502 });
}
