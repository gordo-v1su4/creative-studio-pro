import { mkdir, writeFile } from 'node:fs/promises';

/**
 * Derived media the browser may keep: a take's 480p proxy, poster and frame strip, and a picture's thumbnail.
 * Each is asked for with one of these query keys on a project file (see the files route).
 */
export const KEPT_MEDIA_QUERIES = ['proxy', 'poster', 'strip', 'variant'] as const;

/** Build routing only. Project data and provider credentials never enter this deployment. */
export function studioGatewayConfig(origin: string, token: string) {
	const url = new URL(origin);
	if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		throw new Error('CSP_STUDIO_ORIGIN must be an HTTPS origin');
	}
	if (!token.trim() || /[\r\n]/.test(token)) throw new Error('CSP_OPERATOR_TOKEN is required');
	const proof = [{ type: 'request.headers', op: 'set', target: { key: 'x-csp-gateway' }, args: token.trim() }];
	// Vercel's CDN stores nothing from the studio, whatever the route.
	const neverOnTheCdn = { 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' };
	return {
		version: 3,
		routes: [
			// Derived media keeps the app's own Cache-Control (private, a day at most), so the signed-in browser can
			// replay a take or reopen a cut without downloading it again. Errors carry no such header and are not kept.
			...KEPT_MEDIA_QUERIES.map((key) => ({
				src: '/(api/projects/[^/]+/files/.+)', has: [{ type: 'query', key }], dest: `${url.origin}/$1`,
				headers: neverOnTheCdn,
				transforms: proof
			})),
			// Everything else (pages, project data, original files) is never stored anywhere.
			{
				src: '/(.*)', dest: `${url.origin}/$1`,
				headers: { 'Cache-Control': 'private, no-store', ...neverOnTheCdn },
				transforms: proof
			}
		]
	};
}

if (import.meta.main) {
	const config = studioGatewayConfig(process.env.CSP_STUDIO_ORIGIN ?? '', process.env.CSP_OPERATOR_TOKEN ?? '');
	await mkdir('.vercel/output', { recursive: true });
	await writeFile('.vercel/output/config.json', JSON.stringify(config));
	console.log('Built protected studio gateway');
}
