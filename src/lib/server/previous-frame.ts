import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectStore } from '$lib/adapters/project-store';
import type { ProjectCommandGateway } from '$lib/application/gateway';
import type { Project } from '$lib/domain/schemas';
import { previousPick } from '$lib/domain/shot-references';
import { MIN_LONG_EDGE } from '$lib/domain/media';
import type { MediaProbe } from './media-probe';
import type { ReviewRoomClient } from './review-room';

/**
 * Previous shot as a reference (V1S-328): the last frame of the previous shot's pick, taken from the pick's
 * file in Review Room (never a local copy), stored with the project as a reference of this shot and shown as
 * a chip. Chosen per shot by the operator, never automatic. A frame under 2K on the long edge (a 1080p or
 * 480p pick) is scaled up to 2048 px so it can pass the send gate (operator's call, 2026-10-20).
 */
export interface PreviousFrameDeps {
	store: ProjectStore; gateway: ProjectCommandGateway; projectRoot: string;
	client: ReviewRoomClient | null;
	probe: (file: string) => Promise<MediaProbe>;
	/** Writes the last frame of the video at `source` (a signed URL) to `output` as a JPEG. */
	lastFrame: (source: string, output: string) => Promise<void>;
	/** Writes `input` scaled so its long edge is `longEdge` px to `output` (a JPEG). */
	upscale: (input: string, output: string, longEdge: number) => Promise<void>;
}

type Failure = { ok: false; status: number; message: string };
const fail = (status: number, message: string): Failure => ({ ok: false, status, message });

export async function attachPreviousFrame(deps: PreviousFrameDeps, input: { project_id: string; card_id: string; expected_version: number }): Promise<{ ok: true; project: Project } | Failure> {
	const project = await deps.store.readProject(input.project_id);
	if (!project) return fail(404, 'Project not found');
	const card = project.production.cards.find((entry) => entry.card_id === input.card_id);
	if (!card) return fail(404, 'That shot is not on the board');
	const previous = previousPick(project.production, input.card_id);
	if (!previous) return fail(400, 'The previous shot has no pick yet');
	const stored = previous.pick.review_room;
	if (!stored) return fail(400, `The pick of "${previous.card.title}" is not in Review Room yet; send it there first`);
	if (!deps.client) return fail(503, 'Review Room is not configured (CSP_REVIEW_ROOM_URL, CSP_REVIEW_ROOM_API_KEY)');

	const media = await deps.client.versionMedia(stored.version_id).catch((cause: unknown) => cause instanceof Error ? cause : new Error('Review Room refused'));
	if (media instanceof Error) return fail(502, `Couldn't read the pick from Review Room: ${media.message}`);
	const folder = join(deps.projectRoot, input.project_id, 'files', 'references');
	await mkdir(folder, { recursive: true });
	const name = `prev-${input.card_id.slice(-8)}-${previous.pick.asset_id.slice(-8)}.jpg`;
	const file = join(folder, name);
	try {
		if (previous.pick.kind === 'video') await deps.lastFrame(media.original.url, file);
		else await writeFile(file, await deps.client.download(media.original.url));
	} catch (cause) {
		return fail(502, `Couldn't take the last frame: ${cause instanceof Error ? cause.message : 'error'}`);
	}
	let probed = await deps.probe(file).catch(() => ({} as MediaProbe));
	let upscaledFrom: { width: number; height: number } | null = null;
	if (probed.width && probed.height && Math.max(probed.width, probed.height) < MIN_LONG_EDGE) {
		const scaled = `${file}.2k.jpg`;
		try {
			await deps.upscale(file, scaled, MIN_LONG_EDGE);
			await rename(scaled, file);
		} catch (cause) {
			return fail(502, `Couldn't scale the frame up to ${MIN_LONG_EDGE} px: ${cause instanceof Error ? cause.message : 'error'}`);
		}
		upscaledFrom = { width: probed.width, height: probed.height };
		probed = await deps.probe(file).catch(() => ({} as MediaProbe));
	}
	const frame = {
		kind: 'previous_frame' as const, from_card_id: previous.card.card_id, take_id: previous.pick.asset_id,
		url: `/api/projects/${input.project_id}/files/references/${name}`,
		...(probed.width && probed.height ? { width: probed.width, height: probed.height } : {}),
		...(upscaledFrom ? { upscaled_from: upscaledFrom } : {}), at: new Date().toISOString()
	};
	const references = [...(card.references ?? []).filter((reference) => reference.kind !== 'previous_frame'), frame];
	const outcome = await deps.gateway.handle({ command: 'set_shot_references', project_id: input.project_id, expected_version: input.expected_version, card_id: input.card_id, references });
	if (!outcome.ok) return fail(409, outcome.error.message);
	return { ok: true, project: outcome.data as Project };
}

/** ffmpeg arguments for the last frame of a video (seek from the end, keep the final decoded frame). */
export const lastFrameArgs = (source: string, output: string) => ['-y', '-sseof', '-0.5', '-i', source, '-update', '1', '-q:v', '2', output];

/** ffmpeg arguments to scale an image so its long edge is `longEdge` px (lanczos, even sides kept). */
export const upscaleArgs = (input: string, output: string, longEdge: number) => [
	'-y', '-i', input, '-vf', `scale='if(gte(iw,ih),${longEdge},-2)':'if(gte(iw,ih),-2,${longEdge})':flags=lanczos`, '-q:v', '2', output
];
