import { json } from '@sveltejs/kit';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { RequestHandler } from './$types';
import { getReferenceCacheDir, getReferenceFileDeps, getSeriesStore } from '$lib/server/config';
import { cachedReference, uploadReference } from '$lib/server/reference-files';

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'INVALID_COMMAND', message, retryable: status >= 500, source: 'references' } }, { status });

/**
 * A series' reference images (V1S-326). POST (multipart: page_id, file) uploads one vetted image to the
 * series' Review Room `_References/<Kind>`; GET ?page_id= serves its cached copy for the References drawer.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const deps = getReferenceFileDeps();
	if (!deps) return fail(503, 'Review Room is not configured (CSP_REVIEW_ROOM_URL, CSP_REVIEW_ROOM_API_KEY)');
	const form = await request.formData().catch(() => null);
	const pageId = form?.get('page_id');
	const file = form?.get('file');
	if (typeof pageId !== 'string' || !(file instanceof File)) return fail(400, 'Send page_id and the image file');
	try {
		const result = await uploadReference(deps, params.seriesId, { page_id: pageId, file_name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
		return result.ok ? json({ ok: true, data: result.record }) : fail(result.status, result.message);
	} catch (cause) {
		return fail(502, cause instanceof Error ? cause.message : 'Upload failed');
	}
};

export const GET: RequestHandler = async ({ params, url }) => {
	const record = await getSeriesStore().read(params.seriesId);
	const file = record?.reference_files?.[url.searchParams.get('page_id') ?? ''];
	if (!file) return fail(404, 'No image uploaded for that reference yet');
	// A copy already cached on this machine is served without Review Room; only a missing one is fetched.
	const cached = join(getReferenceCacheDir(), `${file.version_id}${extname(file.file_name).toLowerCase() || '.png'}`);
	if (existsSync(cached)) return new Response(await readFile(cached), { headers: { 'content-type': file.mime_type, 'cache-control': 'private, max-age=3600' } });
	const deps = getReferenceFileDeps();
	if (!deps) return fail(503, 'Review Room is not configured');
	try {
		const path = await cachedReference(deps, file);
		return new Response(await readFile(path), { headers: { 'content-type': file.mime_type, 'cache-control': 'private, max-age=3600' } });
	} catch (cause) {
		return fail(502, cause instanceof Error ? cause.message : 'Could not fetch the image from Review Room');
	}
};
