import type { Handle } from '@sveltejs/kit';
import { isPublicSite } from '$lib/server/public-site';

/**
 * Public mode: the same app, deployed for visitors (on Vercel, or with CSP_PUBLIC_SITE=1), is read-only.
 * Only the watch pages, their read API and the built assets are served; every studio page and every
 * studio API (projects, Agent, renders, Notion, settings) answers 404, and nothing but GET/HEAD is accepted.
 * The studio itself keeps running on the operator's machine, where none of this applies.
 */
const PUBLIC_PATHS = [/^\/watch(?:\/|$)/, /^\/api\/public(?:\/|$)/, /^\/_app\//, /^\/favicon\.[a-z]+$/, /^\/robots\.txt$/];

export const handle: Handle = async ({ event, resolve }) => {
	if (!isPublicSite()) return resolve(event);
	const { pathname } = event.url;
	if (pathname === '/') return new Response(null, { status: 302, headers: { location: '/watch' } });
	const readOnly = event.request.method === 'GET' || event.request.method === 'HEAD';
	if (!readOnly || !PUBLIC_PATHS.some((pattern) => pattern.test(pathname))) {
		return pathname.startsWith('/api/')
			? new Response(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Not available on the public site' } }), { status: 404, headers: { 'content-type': 'application/json' } })
			: new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
	}
	return resolve(event);
};
