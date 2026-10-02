import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getAppSettingsStore, getSfxFolder } from '$lib/server/config';
import { clearSfxIndex, sfxSummary } from '$lib/server/effects';

/** Settings → Sound effects (V1S-129): the local folder the Agent picks effects from, and what it holds. */
export const GET: RequestHandler = async () => json({ ok: true, data: await sfxSummary(await getSfxFolder()) });

export const POST: RequestHandler = async ({ request }) => {
	const parsed = z.object({ folder: z.string().trim().max(1000).nullable() }).safeParse(await request.json().catch(() => null));
	if (!parsed.success) return json({ ok: false, error: { code: 'INVALID_COMMAND', message: 'folder must be a path or null', retryable: false, source: 'settings' } }, { status: 400 });
	await getAppSettingsStore().update((settings) => ({ ...settings, sfx_folder: parsed.data.folder || null }));
	clearSfxIndex();
	return json({ ok: true, data: await sfxSummary(await getSfxFolder()) });
};
