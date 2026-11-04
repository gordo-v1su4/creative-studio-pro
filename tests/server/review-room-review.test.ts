import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { reviewTake } from '../../src/lib/server/review-room-review';
import { pullTakes, type PushDeps } from '../../src/lib/server/review-room-takes';
import { pickFor } from '../../src/lib/domain/takes';
import { createReviewRoomClient, type ReviewRoomClient } from '../../src/lib/server/review-room';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function setup() {
	const root = await mkdtemp(join(tmpdir(), 'csp-review-')); roots.push(root);
	const store = new ProjectStore({ root });
	const gateway = new ProjectCommandGateway(store);
	const made = await gateway.createProject({ command: 'create_project', title: 'Review', brief: '', creative_focus: 'full room', created_by: 'test' });
	if (!made.ok) throw new Error(made.error.message);
	const project = await store.updateProject(made.data.project_id, made.data.version, (p) => ({ ...p,
		review_room: { project_id: 'remote', folder_id: 'root', show_code: 'BLR', code: 'TR100', shots: { shot: { code: 'BLR_TR100_SHT_0010', folder_id: 'shot-folder' } } },
		production: { ...p.production, cards: [{ card_id: 'shot', order: 0, title: 'Shot', beat: 'Run', purpose: 'Escape', duration_ms: 3000, image_prompt: 'Run', video_prompt: 'Run', status: 'draft', pick_take_id: 'take1' }],
			assets: [1, 2].map((n) => ({ asset_id: `take${n}`, card_id: 'shot', kind: 'video' as const, name: `take${n}.mp4`, mime_type: 'video/mp4', url: `/files/take${n}.mp4`, created_at: '2026-11-04T00:00:00.000Z', review_room: { asset_id: 'remote-shot', version_id: `v${n}`, version: n, code: 'BLR_TR100_SHT_0010' } })) }
	}));
	const writes: unknown[] = [];
	const client = { setReviewStatus: async (...args: unknown[]) => { writes.push(['status', ...args]); }, setVersionExcluded: async (...args: unknown[]) => { writes.push(['excluded', ...args]); } } as unknown as ReviewRoomClient;
	return { store, gateway, project, client, writes };
}

test('status is shared across the shot; exclusion affects one take and survives ledger reload', async () => {
	const deps = await setup();
	let p = await reviewTake(deps, deps.project.project_id, { take_id: 'take1', expected_version: deps.project.version, status: 'needs_changes', excluded: true });
	expect(deps.writes).toEqual([['status', 'remote-shot', 'needs_changes'], ['excluded', 'v1', true]]);
	expect(p.production.assets.map((a) => a.review_status)).toEqual(['needs_changes', 'needs_changes']);
	expect(p.production.assets.map((a) => !!a.rejected)).toEqual([true, false]);
	expect(pickFor(p.production, p.production.cards[0])?.asset_id).toBe('take2');
	expect((await deps.store.readProject(p.project_id))?.production.assets[0].rejected).toBeTrue();
	p = await reviewTake(deps, p.project_id, { take_id: 'take1', expected_version: p.version, excluded: false });
	expect(p.production.assets[0].rejected).toBeUndefined();
	expect(p.production.assets[0].url).toBe('/files/take1.mp4');
	expect(pickFor(p.production, p.production.cards[0])?.asset_id).toBe('take2');
});

test('a stale command or failed remote write does not change local review state', async () => {
	const deps = await setup();
	await expect(reviewTake(deps, deps.project.project_id, { take_id: 'take1', expected_version: 0, excluded: true })).rejects.toThrow('changed');
	expect(deps.writes).toEqual([]);
	deps.client.setReviewStatus = async () => { throw new Error('offline'); };
	await expect(reviewTake(deps, deps.project.project_id, { take_id: 'take1', expected_version: deps.project.version, status: 'approved' })).rejects.toThrow('offline');
	expect((await deps.store.readProject(deps.project.project_id))?.version).toBe(deps.project.version);
});

test('pull updates already-known versions and restores exclusions without importing duplicates', async () => {
	const deps = await setup();
	let excluded = true;
	deps.client.changes = async () => ({ cursor: '42', assets: [{ assetId: 'remote-shot', folderId: 'shot-folder', assetCode: 'BLR_TR100_SHT_0010', title: 'Shot', currentVersionId: 'v1', misfiled: false, copiedFromAssetId: null, updatedAt: 42, status: 'approved' }], versions: [{ versionId: 'v1', assetId: 'remote-shot', version: 1, isCurrent: true, processingState: 'ready', mimeType: 'video/mp4', createdAt: 1, excluded }], removedAssets: [] });
	const pullDeps = { ...deps, series: { read: async () => null }, projectRoot: '/unused' } as unknown as PushDeps;
	let result = await pullTakes(pullDeps, deps.project.project_id);
	if (!result.ok) throw new Error(result.message);
	expect(result.added).toBe(0);
	expect(result.project.production.assets[0]).toMatchObject({ rejected: true, review_status: 'approved' });
	expect(pickFor(result.project.production, result.project.production.cards[0])?.asset_id).toBe('take2');
	excluded = false;
	result = await pullTakes(pullDeps, deps.project.project_id);
	if (!result.ok) throw new Error(result.message);
	expect(result.project.production.assets[0].rejected).toBeUndefined();
	expect(result.project.production.cards[0].pick_take_id).toBe('take1');
	expect(result.project.production.assets).toHaveLength(2);
});

test('client uses the review API contract and fresh action keys when excluding, restoring and excluding again', async () => {
	const calls: Array<{ url: string; body: unknown; key: string | null }> = [];
	const client = createReviewRoomClient({ baseUrl: 'https://review.test', apiKey: 'test', fetch: (async (url, init) => {
		calls.push({ url: String(url), body: JSON.parse(String(init?.body)), key: new Headers(init?.headers).get('idempotency-key') });
		return new Response('{}', { status: 200 });
	}) as typeof fetch });
	await client.setReviewStatus('shot', 'in_progress');
	await client.setVersionExcluded('v1', true);
	await client.setVersionExcluded('v1', false);
	await client.setVersionExcluded('v1', true);
	expect(calls[0]).toMatchObject({ url: 'https://review.test/api/v1/assets/shot/review-status', body: { status: 'in_progress' } });
	expect(calls[1]).toMatchObject({ url: 'https://review.test/api/v1/versions/v1/exclusion', body: { excluded: true } });
	expect(new Set(calls.map((call) => call.key)).size).toBe(4);
});

test('a bulk review refresh saves its decisions once and avoids rewriting unchanged effective picks', async () => {
	const deps = await setup();
	const p = await deps.store.updateProject(deps.project.project_id, deps.project.version, (p) => ({ ...p, production: { ...p.production,
		cards: [...p.production.cards, { ...p.production.cards[0], card_id: 'shot2', order: 1, pick_take_id: undefined }],
		assets: [...p.production.assets, { ...p.production.assets[0], asset_id: 'take3', card_id: 'shot2', review_room: { asset_id: 'remote-shot2', version_id: 'v3', version: 1, code: 'BLR_TR100_SHT_0020' } }] },
		review_room: { ...p.review_room!, shots: { ...p.review_room!.shots, shot2: { code: 'BLR_TR100_SHT_0020', folder_id: 'folder2' } } } }));
	deps.client.changes = async () => ({ cursor: '43', assets: [1, 2].map((n) => ({ assetId: n === 1 ? 'remote-shot' : 'remote-shot2', folderId: 'folder', assetCode: `BLR_TR100_SHT_00${n}0`, title: 'Shot', currentVersionId: n === 1 ? 'v1' : 'v3', misfiled: false, copiedFromAssetId: null, updatedAt: 43, status: 'in_progress' as const })), versions: [], removedAssets: [] });
	let writes = 0;
	const update = deps.store.updateProject.bind(deps.store);
	deps.store.updateProject = async (...args: Parameters<ProjectStore['updateProject']>) => { writes++; return update(...args); };
	const result = await pullTakes({ ...deps, series: { read: async () => null } } as unknown as PushDeps, p.project_id);
	if (!result.ok) throw new Error(result.message);
	expect(result.project.production.assets.every((a) => a.review_status === 'in_progress')).toBeTrue();
	expect(result.picked).toBe(0);
	expect(writes).toBe(2); // One review update and one cursor update, independent of shot count.
});
