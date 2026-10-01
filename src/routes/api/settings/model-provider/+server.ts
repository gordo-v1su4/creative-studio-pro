import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getModelSettingsDeps } from '$lib/server/config';
import { getModelSettingsView, saveModelSettings } from '$lib/server/model-settings';

/** Settings → Agent model. Keys are write-only: responses carry presence flags only. */
export const GET: RequestHandler = async () => {
	return json({ ok: true, data: await getModelSettingsView(getModelSettingsDeps()) });
};

export const PUT: RequestHandler = async ({ request }) => {
	let body: unknown;
	try { body = await request.json(); }
	catch { return json({ ok: false, error: { code: 'INVALID_COMMAND', message: 'Request body is not JSON' } }, { status: 400 }); }
	const result = await saveModelSettings(getModelSettingsDeps(), body);
	return result.ok ? json(result) : json({ ok: false, error: result.error }, { status: result.status });
};
