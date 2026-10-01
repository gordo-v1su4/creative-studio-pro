import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getAppSettingsStore } from '$lib/server/config';

/** Settings → Video generation: the Higgsfield key is write-only; responses say only whether one is set. */
export const GET: RequestHandler = async () => {
	const settings = await getAppSettingsStore().read();
	return json({ ok: true, data: { higgsfield: { has_key: Boolean(settings.higgsfield.api_key) } } });
};

const bodySchema = z.object({
	/** "KEY_ID:KEY_SECRET"; empty string clears it. */
	higgsfield_key: z.string().trim().max(4000).refine((value) => value === '' || /^[^:\s]+:[^:\s]+$/.test(value), 'Paste the key as KEY_ID:KEY_SECRET')
});

export const POST: RequestHandler = async ({ request }) => {
	let raw: unknown;
	try { raw = await request.json(); }
	catch { return json({ ok: false, error: { code: 'INVALID_COMMAND', message: 'Request body is not JSON' } }, { status: 400 }); }
	const parsed = bodySchema.safeParse(raw);
	if (!parsed.success) return json({ ok: false, error: { code: 'INVALID_COMMAND', message: parsed.error.issues[0]?.message ?? 'Invalid key' } }, { status: 400 });
	const next = await getAppSettingsStore().update((current) => ({ ...current, higgsfield: { api_key: parsed.data.higgsfield_key || null } }));
	return json({ ok: true, data: { higgsfield: { has_key: Boolean(next.higgsfield.api_key) } } });
};
