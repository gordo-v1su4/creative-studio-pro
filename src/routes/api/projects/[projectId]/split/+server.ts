import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { uuid7ish } from '$lib/domain/ids';
import { getGateway, getProjectRoot, getProjectStore } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';
import { saveVerifiedSplit } from '$lib/server/split-shots';
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
	const projectDir = resolve(getProjectRoot(), projectId.data);
	const files = join(projectDir, 'files');
	const prefix = `/api/projects/${projectId.data}/files/`;
	const source = take.url.startsWith(prefix) ? resolve(join(files, decodeURIComponent(take.url.slice(prefix.length)))) : null;
	if (!source || !source.startsWith(files + sep)) return fail(400, 'The take is not a file in the project folder');

	const splitter = createSplitter({ url: env.CSP_SPLITTER_URL || 'https://splitter.serving.cloud', pin: env.SPLITTER_APP_ACCESS_PIN || null });
	const groupId = uuid7ish();
	let split;
	try {
		split = await saveVerifiedSplit({ source, splitter, projectDir, groupId, filePrefix: prefix });
	} catch (cause) {
		return fail(502, cause instanceof Error ? cause.message : 'The splitter failed');
	}
	// Re-read: the project may have moved on while the splitter worked.
	const current = await getProjectStore().readProject(projectId.data);
	const currentTake = current?.production.assets.find((asset) => asset.asset_id === take.asset_id && asset.url === take.url);
	if (!current || !currentTake) {
		await rm(split.folder, { recursive: true, force: true });
		return fail(404, 'The source take is no longer in the project');
	}
	const name = parsed.data.name ?? `${take.name.replace(/\.[^.]+$/, '')} — shots`;
	const outcome = await getGateway().splitIntoShots(projectId.data, current.version, { group_id: groupId, name, source: currentTake, shots: split.saved, ids: uuid7ish });
	if (!outcome.ok) {
		const status = commandStatus(outcome.error);
		if (status < 500) await rm(split.folder, { recursive: true, force: true });
		return json(outcome, { status });
	}
	return json({ ok: true, data: outcome.data, group_id: groupId, shots: split.saved.length, coverage: split.coverage });
};
