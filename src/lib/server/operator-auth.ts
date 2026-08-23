import { env } from '$env/dynamic/private';
import { verifyOperatorCredentials } from '$lib/server/operator-credentials';
import type { OperatorAuthentication } from '$lib/server/operator-credentials';
export type { OperatorAuthentication } from '$lib/server/operator-credentials';

/**
 * Authenticate the single human operator from server-owned configuration.
 * The request body is deliberately not involved in audit attribution.
 */
export function authenticateOperator(request: Request): OperatorAuthentication {
	return verifyOperatorCredentials(request, env.CSP_OPERATOR_TOKEN, env.CSP_OPERATOR_ID);
}
