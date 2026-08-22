import { timingSafeEqual } from 'node:crypto';

export type OperatorAuthentication =
	| { ok: true; operator: string }
	| { ok: false; status: 401 | 503; message: string };

export function verifyOperatorCredentials(
	request: Request,
	configuredToken: string | undefined,
	configuredOperator: string | undefined
): OperatorAuthentication {
	const expectedToken = configuredToken?.trim();
	const operator = configuredOperator?.trim();
	if (!expectedToken || !operator) return { ok: false, status: 503, message: 'Operator authentication is not configured' };
	const authorization = request.headers.get('authorization') ?? '';
	const match = /^Bearer ([^\s]+)$/i.exec(authorization);
	if (!match) return { ok: false, status: 401, message: 'Operator authentication is required' };
	const suppliedToken = match[1];
	const supplied = Buffer.from(suppliedToken, 'utf8');
	const expected = Buffer.from(expectedToken, 'utf8');
	if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return { ok: false, status: 401, message: 'Operator authentication failed' };
	return { ok: true, operator };
}
