import { json } from '@sveltejs/kit';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { getGateway, getProjectRoot, getProjectStore, resolveProjectModel } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';
import { AgentRuleBreakError, createOpenAICompatibleClient } from '$lib/server/model-provider';
import { assembleFirstCut, frameOf } from '$lib/server/assemble';
import { PCM_RATE, readPcm } from '$lib/server/audio-envelope';

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : 'INVALID_COMMAND', message, retryable: status >= 500, source: 'assemble' } }, { status });

/**
 * The Agent's first cut to the score: it looks at a frame of every shot and the score's beats and loudness,
 * chooses the shots and their order, and the result is pushed as a new cut with the score attached. The board
 * and the shots are never changed.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	const body = z.object({ expected_version: z.number().int().nonnegative() }).safeParse(await request.json().catch(() => null));
	if (!body.success) return fail(400, 'expected_version is required');
	const project = await getProjectStore().readProject(projectId.data);
	if (!project) return fail(404, 'Project not found');
	if (project.version !== body.data.expected_version) return fail(409, 'The project changed; reload and try again');
	const score = project.production.score;
	if (!score) return fail(400, 'Add a score first');
	const resolved = await resolveProjectModel(project);
	if (!resolved.ok) return fail(503, `No Agent model: ${resolved.message}`);

	const files = resolve(join(getProjectRoot(), projectId.data, 'files'));
	const prefix = `/api/projects/${projectId.data}/files/`;
	const local = (url: string) => {
		if (!url.startsWith(prefix)) return null;
		const file = resolve(join(files, decodeURIComponent(url.slice(prefix.length))));
		return file.startsWith(files + sep) ? file : null;
	};
	const assets = new Map(project.production.assets.map((asset) => [asset.asset_id, asset]));
	let assembly;
	try {
		assembly = await assembleFirstCut(createOpenAICompatibleClient(resolved.connection), project, score, {
			frame: async (shot) => {
				const take = assets.get(shot.asset_id);
				const file = take ? local(take.url) : null;
				return file ? frameOf(file, shot.kind === 'video' ? shot.in_s + shot.max_s / 2 : null) : null;
			},
			pcm: async () => {
				const file = local(score.url);
				const samples = file ? await readPcm(file).catch(() => null) : null;
				return samples ? { samples, rate: PCM_RATE } : null;
			}
		});
	} catch (cause) {
		return fail(cause instanceof AgentRuleBreakError ? 422 : 502, cause instanceof Error ? cause.message : 'The Agent could not cut to the score');
	}
	if (!assembly) return fail(400, 'No shots with a picture or video to cut');
	const outcome = await getGateway().pushCut({ command: 'push_cut', project_id: projectId.data, expected_version: project.version, name: assembly.name, entries: assembly.entries, music: score });
	if (!outcome.ok) return json(outcome, { status: commandStatus(outcome.error) });
	const cut = outcome.data.production.cuts?.at(-1);
	return json({ ok: true, data: outcome.data, cut_id: cut?.cut_id ?? null, notes: assembly.notes });
};
