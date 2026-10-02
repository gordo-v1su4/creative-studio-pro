import { json } from '@sveltejs/kit';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { RequestHandler } from './$types';
import { idSchema, type Project, type TrailerHouse } from '$lib/domain/schemas';
import { uuid7ish } from '$lib/domain/ids';
import { MIN_LONG_EDGE, mediaKind, safeFileName } from '$lib/domain/media';
import { DEFAULT_TARGET } from '$lib/domain/trailer-house';
import { getGateway, getProjectRoot, getProjectStore } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';
import { probeMedia } from '$lib/server/media-probe';

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : status === 409 ? 'VERSION_CONFLICT' : 'INVALID_COMMAND', message, retryable: false, source: 'trailer-house' } }, { status });
const folder = (projectId: string) => join(getProjectRoot(), projectId, 'files', 'trailer-house');

/** A Trailer House state to edit, starting a fresh one when the project has none yet. */
const houseOf = (project: Project): TrailerHouse => project.trailer_house ?? {
	target: { ...DEFAULT_TARGET }, seeds: '', character: '', character_image: null, rounds: [], picked: null, blueprint: null, characters: null, outline: null, renders: [], updated_at: new Date().toISOString()
};

async function load(params: { projectId: string }, url: URL): Promise<Response | { project: Project; expected: number }> {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	const expected = Number(url.searchParams.get('expected_version'));
	if (!Number.isInteger(expected) || expected < 0) return fail(400, 'expected_version is required');
	const project = await getProjectStore().readProject(projectId.data);
	if (!project) return fail(404, 'Project not found');
	if (project.version !== expected) return fail(409, 'The project changed; reload and try again');
	return { project, expected };
}

async function save(project: Project, expected: number, next: TrailerHouse) {
	const outcome = await getGateway().setTrailerHouse(project.project_id, expected, next);
	return outcome.ok ? json(outcome) : json(outcome, { status: commandStatus(outcome.error) });
}

/** Attach the main character's reference image (at least 2K on the long edge), replacing any earlier one. */
export const POST: RequestHandler = async ({ params, request, url }) => {
	const loaded = await load(params, url);
	if (loaded instanceof Response) return loaded;
	const { project, expected } = loaded;
	const name = url.searchParams.get('name') ?? '';
	if (mediaKind(name) !== 'image') return fail(415, `${name || 'That file'} is not an image (png, jpg, webp)`);
	if (!request.body) return fail(400, 'Empty upload');

	const file = `${uuid7ish().slice(-8)}-${safeFileName(name)}`;
	const target = join(folder(project.project_id), file);
	await mkdir(folder(project.project_id), { recursive: true });
	try {
		await pipeline(Readable.fromWeb(request.body as unknown as WebReadableStream<Uint8Array>), createWriteStream(target));
	} catch {
		await rm(target, { force: true });
		return fail(400, 'Upload was interrupted');
	}
	const probe = await probeMedia(target);
	const longEdge = Math.max(probe.width ?? 0, probe.height ?? 0);
	if (longEdge < MIN_LONG_EDGE) {
		await rm(target, { force: true });
		return fail(400, `Character references must be at least 2K on the long edge; ${name} is ${probe.width ?? '?'}×${probe.height ?? '?'}. Use the full-size file.`);
	}

	const house = houseOf(project);
	const previous = house.character_image?.file;
	const response = await save(project, expected, {
		...house,
		character_image: {
			file, name, mime_type: request.headers.get('content-type') || 'image/png', width: probe.width!, height: probe.height!,
			url: `/api/projects/${project.project_id}/files/trailer-house/${encodeURIComponent(file)}`
		},
		updated_at: new Date().toISOString()
	});
	if (response.ok && previous) await rm(join(folder(project.project_id), previous), { force: true });
	else if (!response.ok) await rm(target, { force: true });
	return response;
};

/** Remove the reference image. */
export const DELETE: RequestHandler = async ({ params, url }) => {
	const loaded = await load(params, url);
	if (loaded instanceof Response) return loaded;
	const { project, expected } = loaded;
	const previous = project.trailer_house?.character_image?.file;
	if (!project.trailer_house || !previous) return fail(400, 'No character image is attached');
	const response = await save(project, expected, { ...project.trailer_house, character_image: null, updated_at: new Date().toISOString() });
	if (response.ok) await rm(join(folder(project.project_id), previous), { force: true });
	return response;
};
