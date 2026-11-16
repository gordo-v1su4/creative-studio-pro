import { expect, test } from 'bun:test';
import { guardStudioGateway } from '../../src/lib/server/studio-gateway';
import { studioGatewayConfig } from '../../scripts/build-studio-gateway';

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
	expect(config.routes[0].transforms[0]).toEqual({ type: 'request.headers', op: 'set', target: { key: 'x-csp-gateway' }, args: 'test-secret' });
	expect(config.routes[0].headers['Cache-Control']).toContain('no-store');
	for (const origin of ['http://origin.example', 'https://user:pass@origin.example', 'https://origin.example/path', 'https://origin.example/?key=x']) {
		expect(() => studioGatewayConfig(origin, 'test-secret')).toThrow();
	}
});
