import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getAppSettingsStore, getNotionView } from '$lib/server/config';
import { applyNotionSettings } from '$lib/server/app-settings';
import { checkNotionKey } from '$lib/server/notion';

const fail = (status: number, message: string) => json({ ok: false, error: { code: 'INVALID_COMMAND', message, retryable: false, source: 'settings' } }, { status });

/** Settings → Notion (decision 23): whether a key is set and where it comes from, and the public template's address. Never the key. */
export const GET: RequestHandler = async () => json({ ok: true, data: await getNotionView() });

/**
 * Enter or remove the key, or set the template's address. A new key is checked with Notion first: one Notion
 * refuses is not saved; when Notion cannot be reached the key is saved and the answer says it was not checked.
 */
export const POST: RequestHandler = async ({ request }) => {
	const parsed = z.object({ api_key: z.string().max(4000).nullable().optional(), template_url: z.string().max(500).nullable().optional() }).safeParse(await request.json().catch(() => null));
	if (!parsed.success) return fail(400, 'Send the key or the template address');
	const store = getAppSettingsStore();
	const tried = applyNotionSettings(await store.read(), parsed.data);
	if (!tried.ok) return fail(400, tried.message);
	let note: string | null = null;
	const key = parsed.data.api_key?.trim();
	if (key) {
		const checked = await checkNotionKey(key);
		if (!checked.ok && checked.refused) return fail(400, checked.message);
		note = checked.ok ? `Notion accepts the key${checked.name ? ` (${checked.name})` : ''}.` : 'Saved, but Notion could not be reached to check it.';
	}
	// Applied again inside the write, so a change made meanwhile to another setting is kept.
	await store.update((current) => { const next = applyNotionSettings(current, parsed.data); return next.ok ? next.settings : current; });
	return json({ ok: true, data: await getNotionView(), note });
};
