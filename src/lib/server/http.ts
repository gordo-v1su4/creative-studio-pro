import type { CommandFailure } from '$lib/application/gateway';

export function commandStatus(error: CommandFailure['error']): number {
	switch (error.code) {
		case 'NOT_FOUND':
			return 404;
		case 'VERSION_CONFLICT':
			return 409;
		case 'INVALID_COMMAND':
			return 400;
		case 'CAPABILITY_UNAVAILABLE':
		case 'UNAUTHORIZED':
			return 503;
		case 'OFFLINE':
		case 'TIMEOUT':
			return 504;
		default:
			return error.retryable ? 502 : 500;
	}
}
