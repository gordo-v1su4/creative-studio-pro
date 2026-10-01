import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { higgsfieldCliPath } from '$lib/server/higgsfield';
import { getVideoGenerator } from '$lib/server/config';

/** Settings → Video generation: is the Higgsfield CLI installed and logged in, and how many plan credits are left. */
export const GET: RequestHandler = async () => {
	const bin = higgsfieldCliPath(env.HIGGSFIELD_CLI);
	const generator = getVideoGenerator();
	const balance = generator ? await generator.balance() : null;
	return json({ ok: true, data: { cli: bin, installed: Boolean(generator), logged_in: balance !== null, balance } });
};
