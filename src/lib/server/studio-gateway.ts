import { timingSafeEqual } from 'node:crypto';

/** The hosted origin is reachable only through the sign-in-protected Vercel gateway. */
export function guardStudioGateway(request: Request, required: boolean, token: string | undefined): Response | null {
	if (!required) return null;
	const expected = Buffer.from(token?.trim() ?? '');
	if (!expected.length) return new Response('Studio gateway is not configured', { status: 503 });
	const supplied = Buffer.from(request.headers.get('x-csp-gateway') ?? '');
	if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
		return new Response('Sign in through the studio domain', { status: 401, headers: { 'cache-control': 'no-store' } });
	}
	return null;
}
