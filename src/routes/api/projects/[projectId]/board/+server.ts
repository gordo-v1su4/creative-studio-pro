import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGateway, getReviewRoomConfig } from '$lib/server/config';
import { createReviewRoomClient, idempotencyKey } from '$lib/server/review-room';
import { commandStatus } from '$lib/server/http';

const BOARD_COMMANDS = new Set(['set_pick', 'reject_take', 'restore_take', 'bench_beat', 'unbench_beat', 'rewire_spine', 'create_group', 'rename_group', 'move_beats']);

/** Thin same-origin command route (AD-1, AD-3): board edits to beats and their takes. */
export const POST: RequestHandler = async ({ params, request }) => {
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ ok: false, error: { code: 'INVALID_COMMAND', message: 'Request body is not JSON', retryable: false, source: 'application' } }, { status: 400 });
	}
	if (!BOARD_COMMANDS.has(String(body.command))) {
		return json({ ok: false, error: { code: 'INVALID_COMMAND', message: `Not a board command: ${String(body.command)}`, retryable: false, source: 'application' } }, { status: 400 });
	}
	const outcome = await getGateway().handle({ ...body, project_id: params.projectId });
	if (!outcome.ok) return json(outcome, { status: commandStatus(outcome.error) });
	// A series take stored in Review Room: the pick here is Review Room's current version (V1S-276). Best effort;
	// the board change stands even if Review Room is unreachable, and the next push or sync settles it.
	if (body.command === 'set_pick' && typeof body.take_id === 'string') {
		const take = (outcome.data as { production?: { assets?: Array<{ asset_id: string; review_room?: { asset_id: string; version_id: string } }> } }).production?.assets?.find((asset) => asset.asset_id === body.take_id);
		const config = take?.review_room ? getReviewRoomConfig() : null;
		if (take?.review_room && config) {
			await createReviewRoomClient(config).setCurrentVersion(take.review_room.asset_id, take.review_room.version_id, idempotencyKey('current', take.review_room.asset_id, take.review_room.version_id)).catch(() => {});
		}
	}
	return json(outcome);
};
