import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import type { ProjectCommandGateway } from '$lib/application/gateway';
import type { ProjectStore } from '$lib/adapters/project-store';
import type { Project } from '$lib/domain/schemas';
import { DELIVERABLE_KINDS, episodeCode, formatDeliverableCode, formatShotCode, type DeliverableKind } from '$lib/domain/shot-codes';
import { pickFor } from '$lib/domain/takes';
import type { SeriesStore } from './series';
import { uploadTake, type ReviewRoomClient } from './review-room';
import type { MediaProbe } from './media-probe';

/**
 * Store a series take in Review Room (V1S-276, ADR 0001): its shot code names the asset, the scene's locked
 * folder holds it, it lands as the shot's next version with its model and prompt, and it becomes the current
 * version when it is the pick. The first take sent locks the series' codes for good.
 */
export interface PushDeps {
	store: ProjectStore; gateway: ProjectCommandGateway; series: SeriesStore; projectRoot: string; client: ReviewRoomClient;
	probe: (file: string) => Promise<MediaProbe>;
	/** Writes a JPEG poster of `input` to `output` (a frame of a video, or the still itself). */
	poster: (input: string, output: string) => Promise<void>;
}

/**
 * Store an exported cut as a deliverable (V1S-280): `BLR_EP101_EPC` in the episode's `_Deliverables`, or
 * `BLR_S1_TRL01` in the series-level one. Each export of the same deliverable becomes its next version.
 */
export async function pushDeliverable(deps: PushDeps, projectId: string, input: { file: string; name: string; kind: DeliverableKind; index?: number; scope: 'episode' | 'series' }): Promise<{ ok: true; code: string; version: number } | { ok: false; status: number; message: string }> {
	const project = await deps.store.readProject(projectId);
	if (!project?.series) return { ok: false, status: 400, message: 'Only a series episode has deliverables' };
	const record = await deps.series.read(project.series.series_id);
	if (!record?.review_room || !record.show_code) return { ok: false, status: 400, message: 'Link the series to Review Room and set its show code first (Series page)' };
	const folderKey = input.scope === 'series' ? 'deliverables' : `ep:${project.series.episode_page_id}:deliverables`;
	const folderId = record.review_room.folders[folderKey];
	if (!folderId) return { ok: false, status: 400, message: 'No _Deliverables folder yet; sync folders on the Series page' };
	const season = project.series.season ?? 1;
	const code = formatDeliverableCode({ show: record.show_code, scope: input.scope === 'series' ? `S${season}` : episodeCode(season, project.series.episode_number), kind: input.kind, index: input.index });
	const work = await mkdtemp(join(tmpdir(), 'csp-poster-'));
	try {
		const posterPath = join(work, 'poster.jpg');
		await deps.poster(input.file, posterPath);
		const probed = await deps.probe(input.file);
		const stored = await uploadTake(deps.client, {
			projectId: record.review_room.project_id, folderId, assetCode: code, name: input.name, type: 'video/mp4',
			bytes: new Uint8Array(await readFile(input.file)), poster: new Uint8Array(await readFile(posterPath)),
			durationSec: probed.duration_s ?? 0, width: probed.width ?? 0, height: probed.height ?? 0,
			metadata: { sourceLabel: 'Creative Studio Pro', notes: `${DELIVERABLE_KINDS[input.kind]} · ${project.series.episode_title}` }, makeCurrent: true
		});
		return { ok: true, code, version: stored.version };
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}

type Pushed ={ ok: true; project: Project; code: string; version: number } | { ok: false; status: number; message: string };

export async function pushTake(deps: PushDeps, projectId: string, takeId: string): Promise<Pushed> {
	const project = await deps.store.readProject(projectId);
	if (!project?.series) return { ok: false, status: 400, message: 'Only a series episode stores its takes in Review Room' };
	const take = project.production.assets.find((asset) => asset.asset_id === takeId);
	const card = take && project.production.cards.find((entry) => entry.card_id === take.card_id);
	if (!take || !card) return { ok: false, status: 404, message: 'Take not found' };
	if (take.review_room) return { ok: true, project, code: take.review_room.code, version: take.review_room.version };
	if (take.kind === 'audio') return { ok: false, status: 400, message: 'Audio takes stay with the sound stage' };
	const record = await deps.series.read(project.series.series_id);
	if (!record?.review_room) return { ok: false, status: 400, message: 'Link this series to its Review Room project first (Series page)' };
	if (!record.show_code) return { ok: false, status: 400, message: 'Set the show code first (Series page)' };
	const scene = project.series.scenes.find((entry) => entry.group_id === card.group_id);
	if (!scene?.code || !card.shot_number) return { ok: false, status: 400, message: `${card.title} has no shot code yet; assign codes on the Series page` };
	const folderId = record.review_room.folders[`scene:${scene.page_id}`];
	if (!folderId) return { ok: false, status: 400, message: `${scene.title} has no Review Room folder yet; sync folders on the Series page` };

	const files = resolve(join(deps.projectRoot, projectId, 'files'));
	const prefix = `/api/projects/${projectId}/files/`;
	if (!take.url.startsWith(prefix)) return { ok: false, status: 400, message: 'The take is not stored in the project folder' };
	const path = resolve(join(files, decodeURIComponent(take.url.slice(prefix.length))));
	if (!path.startsWith(files + sep)) return { ok: false, status: 400, message: 'Take path escapes the project folder' };

	const code = formatShotCode({ show: record.show_code, episode: episodeCode(project.series.season ?? null, project.series.episode_number), scene: scene.code, shot: card.shot_number });
	const work = await mkdtemp(join(tmpdir(), 'csp-poster-'));
	try {
		const posterPath = join(work, 'poster.jpg');
		await deps.poster(path, posterPath);
		const probed = await deps.probe(path);
		const stored = await uploadTake(deps.client, {
			projectId: record.review_room.project_id, folderId, assetCode: code, name: take.name, type: take.mime_type,
			bytes: new Uint8Array(await readFile(path)), poster: new Uint8Array(await readFile(posterPath)),
			durationSec: take.kind === 'image' ? 0 : probed.duration_s ?? take.duration_s ?? 0, width: probed.width ?? take.width ?? 0, height: probed.height ?? take.height ?? 0,
			metadata: { model: take.generation?.model ?? '', prompt: take.generation?.prompt ?? (take.kind === 'image' ? card.image_prompt : card.video_prompt), sourceLabel: 'Creative Studio Pro', notes: `${card.title} · ${scene.title}` },
			makeCurrent: pickFor(project.production, card)?.asset_id === takeId
		});
		const marked = await deps.gateway.markTakeStored(projectId, project.version, takeId, { asset_id: stored.assetId, version_id: stored.versionId, version: stored.version, code });
		if (!marked.ok) return { ok: false, status: 409, message: `Stored as ${code} v${stored.version}, but noting it failed: ${marked.error.message}` };
		if (!record.codes_locked_at) await deps.series.write({ ...record, codes_locked_at: new Date().toISOString() });
		return { ok: true, project: marked.data, code, version: stored.version };
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}
