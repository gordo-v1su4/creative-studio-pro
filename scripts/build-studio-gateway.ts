import { mkdir, writeFile } from 'node:fs/promises';

/** Build routing only. Project data and provider credentials never enter this deployment. */
export function studioGatewayConfig(origin: string, token: string) {
	const url = new URL(origin);
	if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		throw new Error('CSP_STUDIO_ORIGIN must be an HTTPS origin');
	}
	if (!token.trim() || /[\r\n]/.test(token)) throw new Error('CSP_OPERATOR_TOKEN is required');
	return {
		version: 3,
		routes: [{
			src: '/(.*)', dest: `${url.origin}/$1`,
			headers: { 'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' },
			transforms: [{ type: 'request.headers', op: 'set', target: { key: 'x-csp-gateway' }, args: token.trim() }]
		}]
	};
}

if (import.meta.main) {
	const config = studioGatewayConfig(process.env.CSP_STUDIO_ORIGIN ?? '', process.env.CSP_OPERATOR_TOKEN ?? '');
	await mkdir('.vercel/output', { recursive: true });
	await writeFile('.vercel/output/config.json', JSON.stringify(config));
	console.log('Built protected studio gateway');
}
