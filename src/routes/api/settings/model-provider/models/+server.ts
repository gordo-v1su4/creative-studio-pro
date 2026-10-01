import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { modelProviderKindSchema } from '$lib/domain/model-provider';
import { getModelSettingsDeps } from '$lib/server/config';
import { listVisionModels } from '$lib/server/model-settings';

/** Live, vision-only model list for one provider (`?provider=hyper|custom|raycast`). */
export const GET: RequestHandler = async ({ url }) => {
	const provider = modelProviderKindSchema.safeParse(url.searchParams.get('provider'));
	if (!provider.success) return json({ ok: false, error: { code: 'INVALID_COMMAND', message: 'Unknown provider' } }, { status: 400 });
	const result = await listVisionModels(getModelSettingsDeps(), provider.data);
	return result.ok ? json(result) : json({ ok: false, error: result.error }, { status: result.status });
};
