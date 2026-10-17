import { createHash } from 'node:crypto';
import { planTree, type RemoteFolder, type TreeFolder } from '$lib/domain/series-tree';

/**
 * Review Room automation client (V1S-275): the base URL and a project-scoped bearer key come from
 * CSP_REVIEW_ROOM_URL / CSP_REVIEW_ROOM_API_KEY (BWS CREATIVE_STUDIO_PRO_REVIEW_ROOM_API_KEY). Contract:
 * review-room-svelte docs/agent-api.md. `fetch` is injected so tests run without the network.
 */
export interface ReviewRoomConfig { baseUrl: string; apiKey: string; fetch?: typeof fetch }

export class ReviewRoomError extends Error {
	constructor(readonly status: number, message: string) { super(message); }
}

/** A stable Idempotency-Key for one operation: same series + folder + body → same key on every retry. */
export const idempotencyKey = (...parts: string[]) => `csp-${createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 48)}`;

export function createReviewRoomClient(config: ReviewRoomConfig) {
	const call = config.fetch ?? fetch;
	async function request<T>(method: string, path: string, body?: unknown, key?: string): Promise<T> {
		const response = await call(`${config.baseUrl.replace(/\/$/, '')}${path}`, {
			method,
			headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const text = await response.text();
		const json = text ? JSON.parse(text) : {};
		if (!response.ok) throw new ReviewRoomError(response.status, (typeof json?.error === 'string' ? json.error : json?.error?.message) ?? json?.message ?? `Review Room ${method} ${path} failed (${response.status})`);
		return json as T;
	}
	return {
		/** The folders of one project, with lock/ownership flags. */
		async folders(projectId: string): Promise<RemoteFolder[]> {
			const body = await request<{ folders?: Array<RemoteFolder & { projectId: string }> }>('GET', `/api/v1/catalog?projectId=${encodeURIComponent(projectId)}`);
			return (body.folders ?? []).filter((folder) => folder.projectId === projectId);
		},
		async createFolder(projectId: string, title: string, parentFolderId: string | null, key: string): Promise<{ id: string }> {
			const body = await request<{ folderId?: string }>('POST', `/api/v1/projects/${encodeURIComponent(projectId)}/folders`, { title, ownerApp: 'creative-studio-pro', ...(parentFolderId ? { parentFolderId } : {}) }, key);
			const id = body.folderId;
			if (!id) throw new ReviewRoomError(502, 'Review Room did not return the new folder id');
			return { id };
		},
		async renameFolder(projectId: string, folderId: string, title: string, key: string): Promise<void> {
			await request('PATCH', `/api/v1/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folderId)}`, { title }, key);
		},
		// ---- Takes (V1S-276): upload by shot code, pick = current version, metadata, changes feed ----
		async beginUpload(input: { projectId: string; folderId: string; assetCode: string; name: string; type: string; size: number; sha256: string; keepCurrentVersion?: boolean }, key: string) {
			return request<{ sessionId: string; url: string; posterUrl: string; assetId?: string }>('POST', '/api/v1/uploads', input, key);
		},
		/** PUT bytes to a signed storage URL (no Review Room bearer; the URL is the credential). */
		async putSigned(url: string, bytes: Uint8Array, type: string): Promise<void> {
			const response = await call(url, { method: 'PUT', headers: { 'content-type': type }, body: new Blob([bytes as Uint8Array<ArrayBuffer>], { type }) });
			if (!response.ok) throw new ReviewRoomError(response.status, `Storage upload failed (${response.status})`);
		},
		async completeUpload(sessionId: string, input: { posterSizeBytes: number; durationSec: number; width: number; height: number }) {
			return request<{ assetId: string; jobId?: string }>('POST', `/api/v1/uploads/${encodeURIComponent(sessionId)}/complete`, input);
		},
		async setCurrentVersion(assetId: string, versionId: string, key: string): Promise<void> {
			await request('PUT', `/api/v1/assets/${encodeURIComponent(assetId)}/current-version`, { versionId }, key);
		},
		async putMetadata(versionId: string, metadata: Record<string, unknown>, expectedUpdatedAt: number | null = null): Promise<void> {
			await request('PUT', `/api/v1/versions/${encodeURIComponent(versionId)}/metadata`, { metadata, expectedUpdatedAt });
		},
		/** Short-lived signed URLs for one version's original and poster (V1S-284). */
		async versionMedia(versionId: string) {
			return request<{ original: { url: string; mimeType: string; sizeBytes: number; expiresAt: number }; poster: { url: string; expiresAt: number } | null }>('GET', `/api/v1/versions/${encodeURIComponent(versionId)}/media`);
		},
		async download(url: string): Promise<Uint8Array> {
			const response = await call(url);
			if (!response.ok) throw new ReviewRoomError(response.status, `Download failed (${response.status})`);
			return new Uint8Array(await response.arrayBuffer());
		},
		async changes(projectId: string, since: number | string) {
			return request<ChangeFeed>('GET', `/api/v1/projects/${encodeURIComponent(projectId)}/changes?since=${encodeURIComponent(String(since))}`);
		}
	};
}
export type ReviewRoomClient = ReturnType<typeof createReviewRoomClient>;

/** Review Room's changes feed (docs/agent-api.md "Changes since a cursor"). */
export interface ChangeFeed {
	cursor: string;
	assets: Array<{ assetId: string; folderId: string | null; assetCode: string | null; title: string; currentVersionId: string | null; misfiled: boolean; copiedFromAssetId: string | null; updatedAt: number }>;
	versions: Array<{ versionId: string; assetId: string; version: number; isCurrent: boolean; processingState: string; mimeType: string; createdAt: number }>;
	removedAssets: Array<{ assetId: string; mergedIntoAssetId: string | null; reason: string }>;
}

export interface TakeUpload {
	projectId: string; folderId: string; assetCode: string; name: string; type: string;
	bytes: Uint8Array; poster: Uint8Array; durationSec: number; width: number; height: number;
	/** Model, prompt, references, grid… written as the version's creative metadata. */
	metadata: Record<string, unknown>;
	/** Make it the pick (Review Room's current version); false adds the take without changing the pick. */
	makeCurrent: boolean;
}

/**
 * Upload one take (V1S-276): begin by shot code (an existing shot gets its next version), PUT the original and
 * a JPEG poster to the signed URLs, complete, find the new version in the changes feed, write its metadata,
 * and set it current when it is the pick. Returns where it lives in Review Room.
 */
export async function uploadTake(client: ReviewRoomClient, take: TakeUpload): Promise<{ assetId: string; versionId: string; version: number }> {
	const sha256 = createHash('sha256').update(take.bytes).digest('hex');
	const before = await client.changes(take.projectId, 0).then((feed) => feed.cursor).catch(() => '0');
	const begun = await client.beginUpload({ projectId: take.projectId, folderId: take.folderId, assetCode: take.assetCode, name: take.name, type: take.type, size: take.bytes.byteLength, sha256, keepCurrentVersion: !take.makeCurrent }, idempotencyKey('upload', take.projectId, take.assetCode, sha256));
	await client.putSigned(begun.url, take.bytes, take.type);
	await client.putSigned(begun.posterUrl, take.poster, 'image/jpeg');
	const done = await client.completeUpload(begun.sessionId, { posterSizeBytes: take.poster.byteLength, durationSec: take.durationSec, width: take.width, height: take.height });
	const feed = await client.changes(take.projectId, before);
	const version = feed.versions.filter((entry) => entry.assetId === done.assetId).toSorted((a, b) => b.version - a.version)[0];
	if (!version) throw new ReviewRoomError(502, `Uploaded ${take.assetCode}, but its new version is not in the changes feed yet`);
	await client.putMetadata(version.versionId, take.metadata);
	if (take.makeCurrent && !version.isCurrent) await client.setCurrentVersion(done.assetId, version.versionId, idempotencyKey('current', done.assetId, version.versionId));
	return { assetId: done.assetId, versionId: version.versionId, version: version.version };
}

/**
 * Make the series tree in Review Room match `wanted`: create missing folders (locked, owned by this app),
 * rename ones whose title changed, keep the rest. Returns the key → folder id map to store on the series.
 */
export async function syncSeriesTree(client: ReviewRoomClient, seriesId: string, projectId: string, wanted: TreeFolder[], known: Record<string, string>): Promise<{ folders: Record<string, string>; created: number; renamed: number }> {
	const remote = await client.folders(projectId);
	const steps = planTree(wanted, known, remote);
	const folders: Record<string, string> = {};
	let created = 0, renamed = 0;
	for (const step of steps) {
		const parentId = step.folder.parent === null ? null : folders[step.folder.parent] ?? null;
		if (step.kind === 'create') {
			const { id } = await client.createFolder(projectId, step.folder.title, parentId, idempotencyKey(seriesId, projectId, step.folder.key, step.folder.title, parentId ?? ''));
			folders[step.folder.key] = id; created += 1;
		} else {
			if (step.kind === 'rename') { await client.renameFolder(projectId, step.id, step.folder.title, idempotencyKey(seriesId, projectId, step.folder.key, 'rename', step.folder.title)); renamed += 1; }
			folders[step.folder.key] = step.id;
		}
	}
	return { folders, created, renamed };
}
