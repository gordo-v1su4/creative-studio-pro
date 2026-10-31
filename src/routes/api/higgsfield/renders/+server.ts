import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getHiggsfieldRunner } from '$lib/server/config';
import { listRenders } from '$lib/server/higgsfield-renders';

const fail = (status: number, message: string) => json({ ok: false, error: { code: 'INVALID_COMMAND', message, retryable: status >= 500, source: 'higgsfield' } }, { status });

/** The operator's newest finished Higgsfield renders (?kind=video|image, ?size= up to 100), for importing as shots. */
export const GET: RequestHandler = async ({ url }) => {
	const kind = url.searchParams.get('kind') === 'image' ? 'image' : 'video';
	const size = Number(url.searchParams.get('size') ?? 48);
	const run = getHiggsfieldRunner();
	if (!run) return fail(503, 'The Higgsfield CLI is not installed on this machine');
	try {
		return json({ ok: true, data: await listRenders(run, kind, Number.isFinite(size) ? size : 48) });
	} catch (cause) {
		return fail(502, cause instanceof Error ? cause.message : 'Could not list Higgsfield renders');
	}
};
