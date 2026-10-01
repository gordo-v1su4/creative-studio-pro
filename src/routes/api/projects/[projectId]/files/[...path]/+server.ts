import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { getProjectRoot } from '$lib/server/config';

const MIME: Record<string, string> = {
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
	'.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
	'.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4'
};

/**
 * Read-only media route: serves returned renders stored beside the project
 * ledger in `<root>/<projectId>/files/`. Production assets reference these by
 * same-origin URL; paths outside that folder are refused.
 */
export const GET: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) error(400, 'Invalid project id');
	const type = MIME[extname(params.path).toLowerCase()];
	if (!type) error(415, 'Unsupported media type');
	const base = resolve(join(getProjectRoot(), projectId.data, 'files'));
	const target = resolve(join(base, params.path));
	if (!target.startsWith(base + sep)) error(403, 'Path escapes project files');
	let body: Buffer;
	try { body = await readFile(target); }
	catch { error(404, 'File not found'); }
	const headers = { 'content-type': type, 'cache-control': 'no-cache', 'accept-ranges': 'bytes' };
	// Byte ranges let video players seek without re-downloading the whole file.
	const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
	if (range && (range[1] || range[2])) {
		const size = body.length;
		const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
		const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
		if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
		return new Response(new Uint8Array(body.subarray(start, end + 1)), { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}` } });
	}
	return new Response(new Uint8Array(body), { headers });
};
