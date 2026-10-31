import { json } from '@sveltejs/kit';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { getCaptionGateway, getGateway, getProjectRoot, getProjectStore, resolveProjectModel } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';
import { createOpenAICompatibleClient } from '$lib/server/model-provider';
import { tagTake } from '$lib/server/shot-tags';

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : 'INVALID_COMMAND', message, retryable: status >= 500, source: 'tags' } }, { status });

/** Tag one take (?take_id in the body): caption its middle frame and measure its motion, then save the tags on it. */
export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	const body = z.object({ take_id: idSchema }).safeParse(await request.json().catch(() => null));
	if (!body.success) return fail(400, 'Send the take id');
	const store = getProjectStore();
	const project = await store.readProject(projectId.data);
	if (!project) return fail(404, 'Project not found');
	const take = project.production.assets.find((asset) => asset.asset_id === body.data.take_id);
	if (!take || take.kind === 'audio') return fail(404, 'That take is not a picture or video of this project');
	const files = resolve(join(getProjectRoot(), projectId.data, 'files'));
	const prefix = `/api/projects/${projectId.data}/files/`;
	const file = take.url.startsWith(prefix) ? resolve(join(files, decodeURIComponent(take.url.slice(prefix.length)))) : null;
	if (!file || !file.startsWith(files + sep)) return fail(400, `${take.name} is not stored in the project folder`);

	let tags;
	try {
		tags = await tagTake({
			gateway: getCaptionGateway(),
			agent: async () => { const resolved = await resolveProjectModel(project); return resolved.ok ? createOpenAICompatibleClient(resolved.connection) : null; }
		}, project, take, file);
	} catch (cause) {
		return fail(502, cause instanceof Error ? cause.message : 'Tagging failed');
	}
	// Tagging takes a while; save against the project as it is now, so other edits meanwhile don't lose it.
	for (let attempt = 0; attempt < 3; attempt++) {
		const latest = await store.readProject(projectId.data);
		if (!latest) return fail(404, 'Project not found');
		const outcome = await getGateway().setTakeTags({ command: 'set_take_tags', project_id: projectId.data, expected_version: latest.version, take_id: take.asset_id, tags });
		if (outcome.ok) return json({ ...outcome, tags });
		if (outcome.error.code !== 'VERSION_CONFLICT') return json(outcome, { status: commandStatus(outcome.error) });
	}
	return fail(409, 'The project kept changing; tag it again');
};
