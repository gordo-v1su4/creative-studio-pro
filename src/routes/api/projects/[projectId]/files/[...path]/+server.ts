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
export const GET: RequestHandler = async ({ params }) => {
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
	return new Response(new Uint8Array(body), { headers: { 'content-type': type, 'cache-control': 'no-cache' } });
};
