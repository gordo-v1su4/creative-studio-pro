import { json } from '@sveltejs/kit';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { uuid7ish } from '$lib/domain/ids';
import { isUnder2K, safeFileName } from '$lib/domain/media';
import { getAnimateDeps, getGateway, getHiggsfieldRunner, getProjectRoot, getProjectStore } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';
import { probeMedia } from '$lib/server/media-probe';
import { getRender, renderFileName } from '$lib/server/higgsfield-renders';

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : 'INVALID_COMMAND', message, retryable: status >= 500, source: 'higgsfield' } }, { status });

/**
 * Import one finished Higgsfield render (?job_id=) as a new shot, benched like a dropped file (?group_id= for
 * the board's group). The render is read fresh through the CLI and its file downloaded into the project; the
 * take keeps the job id and prompt. A render already in the project is refused.
 */
export const POST: RequestHandler = async ({ params, url }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	const jobId = url.searchParams.get('job_id') ?? '';
	if (!/^[\w-]{8,100}$/.test(jobId)) return fail(400, 'job_id is required');
	const expectedVersion = Number(url.searchParams.get('expected_version'));
	if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return fail(400, 'expected_version is required');
	const groupId = url.searchParams.get('group_id');
	if (groupId !== null && !idSchema.safeParse(groupId).success) return fail(400, 'Invalid group_id');
	const project = await getProjectStore().readProject(projectId.data);
	if (!project) return fail(404, 'Project not found');
	if (project.production.assets.some((asset) => asset.job_id === jobId)) return fail(400, 'That render is already in this project');
	const run = getHiggsfieldRunner();
	if (!run) return fail(503, 'The Higgsfield CLI is not installed on this machine');

	let render;
	try { render = await getRender(run, jobId); } catch (cause) { return fail(502, cause instanceof Error ? cause.message : 'Could not read the render'); }
	if (!render) return fail(400, 'That render is not finished or has no file');

	const takeId = uuid7ish();
	const name = renderFileName(render);
	const fileName = `${takeId.slice(-8)}-${safeFileName(name)}`;
	const folder = join(getProjectRoot(), projectId.data, 'files', 'board');
	const target = join(folder, fileName);
	await mkdir(folder, { recursive: true });
	try {
		await writeFile(target, await (await getAnimateDeps()).download(render.result_url));
	} catch (cause) {
		await rm(target, { force: true });
		return fail(502, cause instanceof Error ? cause.message : 'Download failed');
	}
	const take = {
		asset_id: takeId, kind: render.kind, name,
		mime_type: render.kind === 'video' ? 'video/mp4' : `image/${name.split('.').pop()?.toLowerCase().replace('jpg', 'jpeg') ?? 'png'}`,
		url: `/api/projects/${projectId.data}/files/board/${encodeURIComponent(fileName)}`,
		...(await probeMedia(target)),
		job_id: render.job_id,
		generation: { provider: 'higgsfield', model: render.model, resolution: render.resolution ?? 'unknown', prompt: render.prompt || '(no prompt)', ...(render.duration_s ? { duration_s: render.duration_s } : {}) },
		created_at: new Date().toISOString()
	};
	const title = (render.prompt.replace(/\s+/g, ' ').trim().split(/[.!?\n]/)[0] || name.replace(/\.[^.]+$/, '')).slice(0, 80);
	const beatId = uuid7ish();
	const outcome = await getGateway().addBeat({
		command: 'add_beat', project_id: projectId.data, expected_version: expectedVersion, card_id: beatId,
		title, take, ...(groupId ? { group_id: groupId } : {})
	});
	if (!outcome.ok) {
		await rm(target, { force: true });
		return json(outcome, { status: commandStatus(outcome.error) });
	}
	return json({ ...outcome, take: { ...take, under_2k: isUnder2K(take) }, beat_id: beatId });
};
