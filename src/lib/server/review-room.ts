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
		}
	};
}
export type ReviewRoomClient = ReturnType<typeof createReviewRoomClient>;

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
