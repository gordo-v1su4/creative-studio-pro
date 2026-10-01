import { json } from '@sveltejs/kit';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { uuid7ish } from '$lib/domain/ids';
import { isUnder2K, mediaKind, safeFileName, ACCEPTED_EXTENSIONS } from '$lib/domain/media';
import { getGateway, getProjectRoot, getProjectStore } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';
import { probeMedia } from '$lib/server/media-probe';

const fail = (status: number, code: string, message: string) =>
	json({ ok: false, error: { code, message, retryable: false, source: 'application' } }, { status });

/**
 * Board intake (AD-1, AD-3): a file dropped on the board. The raw body is the
 * file (name in ?name=); it is copied into the project folder, probed, then
 * added through the gateway as a take on ?card_id= (add_take) or, without a
 * card, as a new benched beat placed at ?x=&y= on the canvas (add_beat).
 */
export const POST: RequestHandler = async ({ params, request, url }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'INVALID_COMMAND', 'Invalid project id');
	const name = url.searchParams.get('name') ?? '';
	const kind = mediaKind(name);
	if (!kind) return fail(415, 'INVALID_COMMAND', `${name || 'That file'} is not an image or video the board can take (${ACCEPTED_EXTENSIONS.join(' ')})`);
	const expectedVersion = Number(url.searchParams.get('expected_version'));
	if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return fail(400, 'INVALID_COMMAND', 'expected_version is required');
	const cardId = url.searchParams.get('card_id');
	if (cardId !== null && !idSchema.safeParse(cardId).success) return fail(400, 'INVALID_COMMAND', 'Invalid card_id');
	if (!request.body) return fail(400, 'INVALID_COMMAND', 'Empty upload');

	const takeId = uuid7ish();
	const fileName = `${takeId.slice(-8)}-${safeFileName(name)}`;
	const folder = join(getProjectRoot(), projectId.data, 'files', 'board');
	const target = join(folder, fileName);
	await mkdir(folder, { recursive: true });
	try {
		await pipeline(Readable.fromWeb(request.body as unknown as WebReadableStream<Uint8Array>), createWriteStream(target));
	} catch {
		await rm(target, { force: true });
		return fail(400, 'INVALID_COMMAND', 'Upload was interrupted');
	}

	const probe = await probeMedia(target);
	const take = {
		asset_id: takeId, kind, name,
		mime_type: request.headers.get('content-type') || `${kind}/*`,
		url: `/api/projects/${projectId.data}/files/board/${encodeURIComponent(fileName)}`,
		...probe,
		created_at: new Date().toISOString()
	};
	const newBeatId = uuid7ish();
	const outcome = cardId
		? await getGateway().addTake({ command: 'add_take', project_id: projectId.data, expected_version: expectedVersion, card_id: cardId, take })
		: await getGateway().addBeat({
				command: 'add_beat', project_id: projectId.data, expected_version: expectedVersion, card_id: newBeatId,
				title: name.replace(/\.[^.]+$/, '').slice(0, 200) || 'Dropped file', take
			});
	if (!outcome.ok) {
		await rm(target, { force: true });
		return json(outcome, { status: commandStatus(outcome.error) });
	}

	// A new beat lands where it was dropped (canvas layout is last-writer-wins, outside the ledger).
	if (!cardId) {
		const x = Number(url.searchParams.get('x')), y = Number(url.searchParams.get('y'));
		if (Number.isFinite(x) && Number.isFinite(y)) {
			const store = getProjectStore();
			const layout = await store.readCanvasLayout(projectId.data);
			const node = { node_id: newBeatId, type: 'story_card' as const, lane: 'storyboard' as const, x, y, width: 320, height: 400 };
			await store.writeCanvasLayout(projectId.data, layout
				? { ...layout, nodes: [...layout.nodes, node] }
				: { schema_version: 1, project_id: projectId.data, nodes: [node], viewport: { x: 0, y: 0, zoom: 1 }, updated_at: new Date().toISOString() });
		}
	}
	return json({ ...outcome, take: { ...take, under_2k: isUnder2K(take) }, beat_id: cardId ?? newBeatId });
};
