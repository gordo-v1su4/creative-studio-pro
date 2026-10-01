import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getModelSettingsDeps } from '$lib/server/config';
import { testModel } from '$lib/server/model-settings';

/** Pick-time model test: sends a small image, asks for structured JSON, grades rule following. */
export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try { body = await request.json(); }
	catch { return json({ ok: false, error: { code: 'INVALID_COMMAND', message: 'Request body is not JSON' } }, { status: 400 }); }
	const result = await testModel(getModelSettingsDeps(), body);
	return result.ok ? json(result) : json({ ok: false, error: result.error }, { status: result.status });
};
