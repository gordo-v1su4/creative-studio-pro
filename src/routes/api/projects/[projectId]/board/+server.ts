import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGateway, getProjectStore, getReviewRoomConfig } from '$lib/server/config';
import { createReviewRoomClient, idempotencyKey } from '$lib/server/review-room';
import { reviewTake } from '$lib/server/review-room-review';
import { commandStatus } from '$lib/server/http';

const BOARD_COMMANDS = new Set(['set_pick', 'reject_take', 'restore_take', 'bench_beat', 'unbench_beat', 'rewire_spine', 'set_shot_references', 'create_group', 'rename_group', 'move_beats', 'create_assembly', 'update_assembly', 'remove_assembly', 'remove_group', 'remove_beats', 'set_take_tags']);

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
	if ((body.command === 'reject_take' || body.command === 'restore_take') && typeof body.take_id === 'string' && typeof body.expected_version === 'number') {
		const config = getReviewRoomConfig();
		try {
			const data = await reviewTake({ store: getProjectStore(), client: config ? createReviewRoomClient(config) : undefined }, params.projectId, { take_id: body.take_id, expected_version: body.expected_version, excluded: body.command === 'reject_take' });
			return json({ ok: true, data });
		} catch (cause) { return json({ ok: false, error: { code: 'INVALID_COMMAND', message: cause instanceof Error ? cause.message : 'Review could not be saved' } }, { status: 400 }); }
	}
	const outcome = await getGateway().handle({ ...body, project_id: params.projectId });
	if (!outcome.ok) return json(outcome, { status: commandStatus(outcome.error) });
	// A take stored in Review Room: the pick here is Review Room's current version (V1S-276). The board change
	// stands even if Review Room cannot be reached; the answer then says so (`room_error`), and the screen keeps the
	// pick to send again, so the two apps never silently disagree (ADR 0008).
	if (body.command === 'set_pick' && typeof body.take_id === 'string') {
		const take = (outcome.data as { production?: { assets?: Array<{ asset_id: string; card_id?: string; review_room?: { asset_id: string; version_id: string } }> } }).production?.assets?.find((asset) => asset.asset_id === body.take_id);
		const config = take?.review_room ? getReviewRoomConfig() : null;
		if (take?.review_room && config) {
			const failed = await createReviewRoomClient(config).setCurrentVersion(take.review_room.asset_id, take.review_room.version_id, idempotencyKey('current', take.review_room.asset_id, take.review_room.version_id, crypto.randomUUID()))
				.then(() => null, (cause) => (cause instanceof Error ? cause.message : 'Review Room could not be reached'));
			if (failed) return json({ ...outcome, room_error: failed, room_take: { take_id: take.asset_id, card_id: take.card_id ?? null } });
		}
	}
	return json(outcome);
};
