import { json } from '@sveltejs/kit';
import type { ProjectCommandGateway } from '$lib/application/gateway';
import type { OperatorAuthentication } from '$lib/server/operator-credentials';
import { commandStatus } from '$lib/server/http';

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
	try { return await request.json() as Record<string, unknown>; } catch { return null; }
}

export async function handleBriefLockRequest(
	request: Request,
	projectId: string,
	dependencies: { gateway: Pick<ProjectCommandGateway, 'lockBrief'>; authenticate: (request: Request) => OperatorAuthentication }
): Promise<Response> {
	const authentication = dependencies.authenticate(request);
	if (!authentication.ok) {
		return json({ ok: false, error: { code: authentication.status === 401 ? 'UNAUTHORIZED' : 'CAPABILITY_UNAVAILABLE', message: authentication.message, retryable: false, source: 'application' } }, {
			status: authentication.status,
			...(authentication.status === 401 && { headers: { 'www-authenticate': 'Bearer realm="operator"' } })
		});
	}
	const body = await readBody(request);
	if (!body) return json({ ok: false, error: { code: 'INVALID_COMMAND', message: 'Request body is not JSON', retryable: false, source: 'application' } }, { status: 400 });
	const outcome = await dependencies.gateway.lockBrief({ ...body, command: 'lock_brief', project_id: projectId, operator: authentication.operator });
	return json(outcome, { status: outcome.ok ? 200 : commandStatus(outcome.error) });
}
