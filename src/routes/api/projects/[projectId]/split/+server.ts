import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { uuid7ish } from '$lib/domain/ids';
import { shotsOf } from '$lib/domain/groups';
import { getGateway, getProjectRoot, getProjectStore } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';
import { probeMedia } from '$lib/server/media-probe';
import { createSplitter } from '$lib/server/splitter';

const requestSchema = z.object({ take_id: idSchema, name: z.string().trim().min(1).max(120).optional() });
const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : 'INVALID_COMMAND', message, retryable: status >= 500, source: 'splitter' } }, { status });

/**
 * Split a take into shots (V1S-131): the splitter scene-detects it, the shot
 * clips are saved under files/shots/, and a new group of shot beats is made.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	const parsed = requestSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? 'Invalid split request');
	const project = await getProjectStore().readProject(projectId.data);
	if (!project) return fail(404, 'Project not found');
	const take = project.production.assets.find((asset) => asset.asset_id === parsed.data.take_id);
	if (!take || take.kind !== 'video') return fail(400, 'Only a video take can be split into shots');
	const files = resolve(join(getProjectRoot(), projectId.data, 'files'));
	const prefix = `/api/projects/${projectId.data}/files/`;
	const source = take.url.startsWith(prefix) ? resolve(join(files, decodeURIComponent(take.url.slice(prefix.length)))) : null;
	if (!source || !source.startsWith(files + sep)) return fail(400, 'The take is not a file in the project folder');

	const splitter = createSplitter({ url: env.CSP_SPLITTER_URL || 'https://splitter.serving.cloud', pin: env.SPLITTER_APP_ACCESS_PIN || null });
	let result;
	try { result = await splitter.split(source); }
	catch (cause) { return fail(502, cause instanceof Error ? cause.message : 'The splitter failed'); }
	const shots = shotsOf(result.manifest);
	if (!shots.length) return fail(422, 'The splitter found no shots in that take');

	const folderName = `${take.asset_id.slice(-8)}-${result.manifest.job_id.slice(0, 8)}`;
	const folder = join(files, 'shots', folderName);
	await mkdir(folder, { recursive: true });
	const saved = [];
	for (const shot of shots) {
		await writeFile(join(folder, shot.file_name), await result.download(shot.clip_path));
		const probe = await probeMedia(join(folder, shot.file_name));
		saved.push({ ...shot, url: `${prefix}shots/${folderName}/${shot.file_name}`, width: probe.width, height: probe.height });
	}
	// Re-read: the project may have moved on while the splitter worked.
	const current = await getProjectStore().readProject(projectId.data);
	if (!current) return fail(404, 'Project not found');
	const groupId = uuid7ish();
	const name = parsed.data.name ?? `${take.name.replace(/\.[^.]+$/, '')} — shots`;
	const outcome = await getGateway().splitIntoShots(projectId.data, current.version, { group_id: groupId, name, source: take, shots: saved, ids: uuid7ish });
	return outcome.ok ? json({ ok: true, data: outcome.data, group_id: groupId, shots: saved.length }) : json(outcome, { status: commandStatus(outcome.error) });
};
