import { timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

export type OperatorAuthentication =
	| { ok: true; operator: string }
	| { ok: false; status: 401 | 503; message: string };

/**
 * Authenticate the single human operator from server-owned configuration.
 * The request body is deliberately not involved in audit attribution.
 */
export function authenticateOperator(request: Request): OperatorAuthentication {
	const expectedToken = env.CSP_OPERATOR_TOKEN?.trim();
	const operator = env.CSP_OPERATOR_ID?.trim();
	if (!expectedToken || !operator) {
		return {
			ok: false,
			status: 503,
			message: 'Operator authentication is not configured'
		};
	}

	const [scheme, suppliedToken = ''] = request.headers.get('authorization')?.split(/\s+/, 2) ?? [];
	if (scheme?.toLowerCase() !== 'bearer' || suppliedToken.length === 0) {
		return { ok: false, status: 401, message: 'Operator authentication is required' };
	}

	const supplied = Buffer.from(suppliedToken, 'utf8');
	const expected = Buffer.from(expectedToken, 'utf8');
	if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
		return { ok: false, status: 401, message: 'Operator authentication failed' };
	}

	return { ok: true, operator };
}
