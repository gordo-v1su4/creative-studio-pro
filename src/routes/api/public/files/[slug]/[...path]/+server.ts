import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { RequestHandler } from './$types';
import { getPublishedReader, LocalPublishedStore } from '$lib/server/published-store';

const MIME: Record<string, string> = {
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
	'.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4'
};

/** Published media from the local published folder (read-only, ranged for video). The public bucket serves its own. */
export const GET: RequestHandler = async ({ params, request }) => {
	const reader = getPublishedReader();
	if (!(reader instanceof LocalPublishedStore)) error(404, 'Not found');
	const type = MIME[extname(params.path).toLowerCase()];
	if (!type) error(415, 'Unsupported media type');
	const target = reader.filePath(params.slug, params.path);
	if (!target) error(404, 'Not found');
	let body: Buffer;
	try { body = await readFile(target); } catch { error(404, 'Not found'); }
	const headers = { 'content-type': type, 'cache-control': 'public, max-age=300', 'accept-ranges': 'bytes' };
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
