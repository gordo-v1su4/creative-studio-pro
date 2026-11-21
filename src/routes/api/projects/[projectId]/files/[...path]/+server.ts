import { error } from '@sveltejs/kit';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { videoPoster } from '$lib/server/video-posters';
import { proxyCacheDir, videoProxy } from '$lib/server/video-proxies';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { getProjectRoot, getReferenceVariants } from '$lib/server/config';
import { referenceImageSize } from '$lib/server/reference-variants';
import { createHash } from 'node:crypto';

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
export const GET: RequestHandler = async ({ params, request, url }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) error(400, 'Invalid project id');
	const type = MIME[extname(params.path).toLowerCase()];
	if (!type) error(415, 'Unsupported media type');
	const base = resolve(join(getProjectRoot(), projectId.data, 'files'));
	const target = resolve(join(base, params.path));
	if (!target.startsWith(base + sep)) error(403, 'Path escapes project files');
	const variant = referenceImageSize(url.searchParams.get('variant'));
	const variants = type.startsWith('image/') && variant ? getReferenceVariants() : null;
	if (variants && variant) {
		try {
			const bytes = await variants.read(target, variant);
			const etag = `"${createHash('sha256').update(bytes).digest('hex')}"`;
			const headers = { 'content-type': 'image/webp', 'cache-control': 'private, max-age=3600', etag };
			return new Response(request.headers.get('if-none-match') === etag ? null : new Uint8Array(bytes), { status: request.headers.get('if-none-match') === etag ? 304 : 200, headers });
		} catch { error(503, 'Reference thumbnail is not ready; retry shortly'); }
	}
	// ?poster=1 on a video: a small cached JPEG still, so boards don't download whole clips for one frame.
	if (type.startsWith('video/') && url.searchParams.get('poster') === '1') {
		try {
			const bytes = await videoPoster(target, join(dirname(getProjectRoot()), 'video-posters'));
			const etag = `"${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}"`;
			const headers = { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400', etag };
			return new Response(request.headers.get('if-none-match') === etag ? null : new Uint8Array(bytes), { status: request.headers.get('if-none-match') === etag ? 304 : 200, headers });
		} catch { error(404, 'No poster for this file'); }
	}
	// ?proxy=1 on a video: the 480p editing proxy (made on first request when ingest didn't already make it).
	let file = target;
	if (type.startsWith('video/') && url.searchParams.get('proxy') === '1') {
		try { file = await videoProxy(target, proxyCacheDir(getProjectRoot())); }
		catch { error(404, 'File not found'); }
	}
	let size: number, mtime: number;
	try { const info = await stat(file); size = info.size; mtime = info.mtimeMs; }
	catch { error(404, 'File not found'); }
	// Proxies and originals never change in place (a new take is a new file), so a validator is enough.
	const etag = `"${size.toString(16)}-${Math.round(mtime).toString(16)}"`;
	const headers = { 'content-type': file === target ? type : 'video/mp4', 'cache-control': file === target ? 'no-cache' : 'private, max-age=86400', 'accept-ranges': 'bytes', etag };
	if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
	// Byte ranges let video players and the GPU decoder seek without re-downloading the whole file; streamed from disk.
	const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
	if (range && (range[1] || range[2])) {
		const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
		const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
		if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
		return new Response(stream(file, start, end), { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) } });
	}
	return new Response(stream(file, 0, size - 1), { headers: { ...headers, 'content-length': String(size) } });
};

const stream = (file: string, start: number, end: number) => Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream<Uint8Array>;
