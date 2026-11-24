import { expect, test } from 'bun:test';
import { guardStudioGateway } from '../../src/lib/server/studio-gateway';
import { KEPT_MEDIA_QUERIES, studioGatewayConfig } from '../../scripts/build-studio-gateway';

test('hosted origin refuses unauthenticated reads, writes and missing configuration', () => {
	for (const method of ['GET', 'POST', 'DELETE']) {
		const request = new Request('https://origin.example/api/projects', { method });
		expect(guardStudioGateway(request, true, 'test-secret')?.status).toBe(401);
		expect(guardStudioGateway(request, true, undefined)?.status).toBe(503);
		expect(guardStudioGateway(request, false, undefined)).toBeNull();
	}
});

test('gateway proof must match exactly; the route overwrites browser-supplied proof', () => {
	for (const value of ['wrong', 'test-secrex', 'test-secret extra']) {
		expect(guardStudioGateway(new Request('https://origin.example/', { headers: { 'x-csp-gateway': value } }), true, 'test-secret')?.status).toBe(401);
	}
	expect(guardStudioGateway(new Request('https://origin.example/', { headers: { 'x-csp-gateway': 'test-secret' } }), true, 'test-secret')).toBeNull();
	const config = studioGatewayConfig('https://origin.example', 'test-secret');
	// Every route carries the proof, the derived-media routes included.
	for (const route of config.routes) expect(route.transforms[0]).toEqual({ type: 'request.headers', op: 'set', target: { key: 'x-csp-gateway' }, args: 'test-secret' });
	for (const origin of ['http://origin.example', 'https://user:pass@origin.example', 'https://origin.example/path', 'https://origin.example/?key=x']) {
		expect(() => studioGatewayConfig(origin, 'test-secret')).toThrow();
	}
});

type Route = ReturnType<typeof studioGatewayConfig>['routes'][number];
/** The first route a request matches, the way the gateway picks one: path, then any required query key. */
function routeFor(path: string): Route {
	const url = new URL(path, 'https://studio.example');
	const config = studioGatewayConfig('https://origin.example', 'test-secret');
	const route = config.routes.find((entry) => new RegExp(`^${entry.src}$`).test(url.pathname) && ('has' in entry ? entry.has.every((need) => url.searchParams.has(need.key)) : true));
	if (!route) throw new Error(`no route for ${path}`);
	return route;
}
const header = (route: Route, name: string) => (route.headers as Record<string, string>)[name];

test('the browser may keep derived media; the gateway does not overwrite the app\'s own Cache-Control on it', () => {
	expect([...KEPT_MEDIA_QUERIES]).toEqual(['proxy', 'poster', 'strip', 'variant']);
	for (const query of ['proxy=1', 'poster=1&t=1.5', 'strip=1', 'variant=small']) {
		const route = routeFor(`/api/projects/p1/files/board/take.mp4?${query}`);
		expect(header(route, 'Cache-Control')).toBeUndefined();
		expect(route.dest).toBe('https://origin.example/$1');
	}
});

test('nothing else is kept: pages, project data and original files stay no-store', () => {
	for (const path of ['/', '/api/projects', '/api/projects/p1', '/api/projects/p1/files/board/take.mp4', '/api/projects/p1/board?proxy=1', '/api/projects/p1/files/?proxy=1']) {
		expect(header(routeFor(path), 'Cache-Control')).toBe('private, no-store');
	}
});

test('Vercel\'s CDN stores nothing on any route', () => {
	for (const route of studioGatewayConfig('https://origin.example', 'test-secret').routes) {
		expect(header(route, 'CDN-Cache-Control')).toBe('no-store');
		expect(header(route, 'Vercel-CDN-Cache-Control')).toBe('no-store');
	}
});
