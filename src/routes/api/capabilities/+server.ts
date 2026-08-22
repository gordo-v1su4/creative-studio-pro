import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { checkCapabilities } from '$lib/adapters/capability';

/**
 * Capability read route (FR-032): runs non-billable, time-bounded health
 * checks server-side. Endpoint URLs stay server-side (NFR-004); the client
 * only sees states and observed details.
 */
export const GET: RequestHandler = async () => {
	const reports = await checkCapabilities({
		m3BridgeUrl: env.CSP_M3_BRIDGE_URL,
		splitterUrl: env.CSP_SPLITTER_URL,
		desktopUrl: env.CSP_DESKTOP_URL
	});
	return json({ ok: true, data: reports });
};
