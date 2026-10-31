import { json } from '@sveltejs/kit';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { barLoudness, planCut, sectionsFromBars, shotsForAssembly } from '$lib/domain/assemble';
import { getGateway, getProjectRoot, getProjectStore } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';
import { PCM_RATE, readPcm } from '$lib/server/audio-envelope';

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : 'INVALID_COMMAND', message, retryable: status >= 500, source: 'assemble' } }, { status });

/**
 * The first cut to the score, planned in code from the shots' tags and the score's sections (Essentia's, or
 * eight-bar loudness sections when the score has none), pushed as a new cut with the score attached. The
 * board and the shots are never changed.
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
	const shots = shotsForAssembly(project.production);
	if (shots.length === 0) return fail(400, 'No shots with a picture or video to cut');

	let sections = score.sections ?? [];
	const notes: string[] = [];
	if (sections.length === 0) {
		const files = resolve(join(getProjectRoot(), projectId.data, 'files'));
		const prefix = `/api/projects/${projectId.data}/files/`;
		const file = score.url.startsWith(prefix) ? resolve(join(files, decodeURIComponent(score.url.slice(prefix.length)))) : null;
		const samples = file && file.startsWith(files + sep) ? await readPcm(file).catch(() => null) : null;
		if (samples) sections = sectionsFromBars(barLoudness(samples, PCM_RATE, score), score.duration_s);
		notes.push('The score has no Essentia sections yet; cut to its loudness in eight-bar blocks');
	}
	const planned = planCut(shots, score, sections);
	if (planned.entries.length === 0) return fail(400, planned.notes.join('; ') || 'Nothing to cut');
	const outcome = await getGateway().pushCut({ command: 'push_cut', project_id: projectId.data, expected_version: project.version, name: `First cut · ${score.name.replace(/\.[^.]+$/, '')}`.slice(0, 120), entries: planned.entries, music: score });
	if (!outcome.ok) return json(outcome, { status: commandStatus(outcome.error) });
	const cut = outcome.data.production.cuts?.at(-1);
	return json({ ok: true, data: outcome.data, cut_id: cut?.cut_id ?? null, notes: [...notes, ...planned.notes] });
};
