import { json } from '@sveltejs/kit';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { suggestTrims, type TrimSuggestion } from '$lib/domain/trim-suggest';
import { getProjectRoot, getProjectStore } from '$lib/server/config';
import { readFrameSignal } from '$lib/server/frame-signal';

const requestSchema = z.object({
	entries: z.array(z.object({ entry_id: idSchema, asset_id: idSchema, in_s: z.number().nonnegative(), out_s: z.number().positive() })).min(1).max(200)
});

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : 'INVALID_COMMAND', message, retryable: false, source: 'trim-suggest' } }, { status });

/**
 * Suggest trims (V1S-123): read-only. For each entry, decode its take and
 * propose in/out points for frozen frames, stutter, bad starts and stray
 * frames inside the entry's current trim. Nothing is saved here; accepted
 * suggestions go through the cut's normal edit.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	let body: z.infer<typeof requestSchema>;
	try {
		const parsed = requestSchema.safeParse(await request.json());
		if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? 'Invalid request');
		body = parsed.data;
	} catch {
		return fail(400, 'Request body is not JSON');
	}
	const project = await getProjectStore().readProject(projectId.data);
	if (!project) return fail(404, 'Project not found');

	const files = resolve(join(getProjectRoot(), projectId.data, 'files'));
	const prefix = `/api/projects/${projectId.data}/files/`;
	const results: Array<{ entry_id: string; suggestions: TrimSuggestion[] } | { entry_id: string; skipped: string }> = [];
	for (const entry of body.entries) {
		const take = project.production.assets.find((asset) => asset.asset_id === entry.asset_id);
		if (!take || take.kind !== 'video') { results.push({ entry_id: entry.entry_id, skipped: 'not a video take of this project' }); continue; }
		if (!take.url.startsWith(prefix)) { results.push({ entry_id: entry.entry_id, skipped: 'the file is not stored in the project folder' }); continue; }
		const file = resolve(join(files, decodeURIComponent(take.url.slice(prefix.length))));
		if (!file.startsWith(files + sep)) { results.push({ entry_id: entry.entry_id, skipped: 'path escapes the project folder' }); continue; }
		try {
			results.push({ entry_id: entry.entry_id, suggestions: suggestTrims(await readFrameSignal(file), entry) });
		} catch (cause) {
			results.push({ entry_id: entry.entry_id, skipped: cause instanceof Error ? cause.message : 'could not read the video' });
		}
	}
	return json({ ok: true, data: results });
};
