import { describe, expect, test } from 'bun:test';
import { bareTitle, planTree, seriesTree, type RemoteFolder } from '../../src/lib/domain/series-tree';
import { createReviewRoomClient, idempotencyKey, syncSeriesTree, uploadTake } from '../../src/lib/server/review-room';

const episodes = [{
	episode_page_id: 'e1', number: 1, season: 1, title: 'EP01 — The Late Shift',
	scenes: [{ page_id: 's1', title: 'P01 — 2:47 AM (Teaser)', code: 'AMT' }, { page_id: 's2', title: 'P02 — Parking Lot', code: 'PAR' }, { page_id: 's3', title: 'P03 — No code yet' }]
}];

describe('series tree', () => {
	test('series _Deliverables, then EP101 with its _Deliverables and one folder per coded scene', () => {
		expect(bareTitle('EP01 — The Late Shift')).toBe('The Late Shift');
		// A time is not a prefix (the folder read "47 AM" before this was fixed); "12: Title" still is.
		expect(bareTitle('2:47 AM')).toBe('2:47 AM');
		expect(bareTitle('2:47 AM (From Inside)')).toBe('2:47 AM (From Inside)');
		expect(bareTitle('P01 — 2:47 AM (Teaser)')).toBe('2:47 AM (Teaser)');
		expect(bareTitle('12: The Party')).toBe('The Party');
		expect(seriesTree(episodes).map((f) => [f.key, f.title, f.parent])).toEqual([
			['deliverables', '_Deliverables', null],
			['refs', '_References', null],
			['refs:characters', 'Characters', 'refs'],
			['refs:locations', 'Locations', 'refs'],
			['refs:props', 'Props', 'refs'],
			['ep:e1', 'EP101 — The Late Shift', null],
			['ep:e1:deliverables', '_Deliverables', 'ep:e1'],
			['scene:s1', '010 AMT — 2:47 AM (Teaser)', 'ep:e1'],
			['scene:s2', '020 PAR — Parking Lot', 'ep:e1']
		]);
	});

	test('known folders are kept or renamed; an owned folder with the same title is adopted; others are created', () => {
		const wanted = seriesTree(episodes);
		const remote: RemoteFolder[] = [
			{ id: 'f-ep', title: 'EP101 — Late Shift', parentFolderId: null, ownedByCaller: true },
			{ id: 'f-del', title: '_Deliverables', parentFolderId: null, ownedByCaller: true },
			{ id: 'x', title: '_Deliverables', parentFolderId: 'f-ep', ownedByCaller: false }
		];
		const steps = planTree(wanted, { 'ep:e1': 'f-ep' }, remote);
		expect(steps.map((s) => [s.folder.key, s.kind])).toEqual([
			['deliverables', 'keep'], ['refs', 'create'], ['refs:characters', 'create'], ['refs:locations', 'create'], ['refs:props', 'create'], ['ep:e1', 'rename'], ['ep:e1:deliverables', 'create'], ['scene:s1', 'create'], ['scene:s2', 'create']
		]);
	});
});

describe('uploadTake against a fake Review Room', () => {
	function fakeUploads() {
		const calls: Array<{ method: string; path: string; auth: boolean; body: unknown; key?: string }> = [];
		const versions: Array<{ versionId: string; assetId: string; version: number; isCurrent: boolean; processingState: string; mimeType: string; createdAt: number }> = [{ versionId: 'v1', assetId: 'a1', version: 1, isCurrent: true, processingState: 'ready', mimeType: 'video/mp4', createdAt: 1 }];
		const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
			const u = String(url); const method = init?.method ?? 'GET';
			const headers = (init?.headers ?? {}) as Record<string, string>;
			const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
			calls.push({ method, path: u.replace(/^https:\/\/[^/]+/, '').split('?')[0], auth: !!headers.authorization, body, key: headers['idempotency-key'] });
			if (u.startsWith('https://storage.test')) return new Response(null, { status: 200 });
			// Like Review Room: every write except completing an upload needs a valid Idempotency-Key.
			if (method !== 'GET' && !u.endsWith('/complete') && !/^[a-zA-Z0-9._:-]{8,128}$/.test(headers['idempotency-key'] ?? '')) return new Response(JSON.stringify({ error: 'Invalid idempotency key' }), { status: 400 });
			if (u.includes('/changes')) return new Response(JSON.stringify({ cursor: '5', assets: [], versions, removedAssets: [] }));
			if (method === 'POST' && u.endsWith('/api/v1/uploads')) return new Response(JSON.stringify({ sessionId: 's1', url: 'https://storage.test/o', posterUrl: 'https://storage.test/p', assetId: 'a1' }), { status: 201 });
			if (u.endsWith('/complete')) { versions.push({ versionId: 'v2', assetId: 'a1', version: 2, isCurrent: false, processingState: 'processing', mimeType: 'video/mp4', createdAt: 2 }); return new Response(JSON.stringify({ assetId: 'a1', jobId: 'j1' })); }
			return new Response(JSON.stringify({ ok: true }));
		}) as typeof fetch;
		return { client: createReviewRoomClient({ baseUrl: 'https://review.test', apiKey: 'k', fetch: fetcher }), calls };
	}
	const take = { projectId: 'p1', folderId: 'f-par', assetCode: 'BLR_EP101_PAR_0020', name: 'BLR_EP101_PAR_0020.mp4', type: 'video/mp4', bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([9]), durationSec: 5, width: 854, height: 480, metadata: { model: 'seedance_2_5', prompt: 'x' } };

	test('uploads by shot code as the next version, writes metadata, makes it the pick', async () => {
		const { client, calls } = fakeUploads();
		const out = await uploadTake(client, { ...take, makeCurrent: true });
		expect(out).toEqual({ assetId: 'a1', versionId: 'v2', version: 2 });
		const begin = calls.find((c) => c.path === '/api/v1/uploads')!;
		expect(begin.body).toMatchObject({ assetCode: 'BLR_EP101_PAR_0020', folderId: 'f-par', keepCurrentVersion: false, size: 3 });
		expect(calls.filter((c) => c.path === '/o' || c.path === '/p').every((c) => !c.auth)).toBeTrue();
		expect(calls.some((c) => c.method === 'PUT' && c.path === '/api/v1/versions/v2/metadata')).toBeTrue();
		expect(calls.some((c) => c.method === 'PUT' && c.path === '/api/v1/assets/a1/current-version')).toBeTrue();
	});

	test('a take that is not the pick keeps the current version', async () => {
		const { client, calls } = fakeUploads();
		await uploadTake(client, { ...take, makeCurrent: false });
		expect(calls.find((c) => c.path === '/api/v1/uploads')!.body).toMatchObject({ keepCurrentVersion: true });
		expect(calls.some((c) => c.path.endsWith('/current-version'))).toBeFalse();
	});

	test('metadata goes out in Review Room\'s shape; extra fields ride as text custom fields', async () => {
		const { client, calls } = fakeUploads();
		await uploadTake(client, { ...take, metadata: { reference: 'Mara Voss', kind: 'Character', handles: ['@Mara'] }, makeCurrent: true });
		const sent = calls.find((c) => c.path === '/api/v1/versions/v2/metadata')!.body as { metadata: Record<string, unknown> };
		expect(sent.metadata).toMatchObject({ model: '', prompt: '', sourceLabel: 'Creative Studio Pro', referenceImageVersionIds: [] });
		expect(sent.metadata.customFields).toEqual([
			{ id: 'reference', label: 'reference', kind: 'text', value: 'Mara Voss' },
			{ id: 'kind', label: 'kind', kind: 'text', value: 'Character' },
			{ id: 'handles', label: 'handles', kind: 'text', value: '@Mara' }
		]);
		expect(Object.keys(sent.metadata)).not.toContain('reference');
	});

	test('a retry of the same file (no new version) settles on the asset\'s latest version', async () => {
		const { client } = fakeUploads();
		await uploadTake(client, { ...take, makeCurrent: true });
		// The fake's /complete appends a version each time; a real retry does not, so the feed since "before" is empty.
		const retried = await uploadTake({ ...client, changes: async (projectId: string, since: number | string) => (since === 0 ? client.changes(projectId, 0) : { cursor: '9', assets: [], versions: [], removedAssets: [] }) }, { ...take, makeCurrent: true });
		expect(retried.assetId).toBe('a1');
	});
});

describe('syncSeriesTree against a fake Review Room', () => {
	function fakeReviewRoom() {
		const folders: Array<RemoteFolder & { projectId: string }> = [];
		const calls: string[] = [];
		const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
			const path = String(url).replace('https://review.test', '');
			const body = init?.body ? JSON.parse(String(init.body)) : null;
			const headers = (init?.headers ?? {}) as Record<string, string>;
			calls.push(`${init?.method} ${path.split('?')[0]} ${headers['idempotency-key'] ? 'keyed' : ''}`.trim());
			if (headers.authorization !== 'Bearer test-key') return new Response(JSON.stringify({ error: 'Automation credential unavailable' }), { status: 401 });
			if (init?.method === 'GET') return new Response(JSON.stringify({ projects: [{ id: 'p1' }], folders }));
			if (init?.method === 'POST') {
				const id = `f${folders.length + 1}`;
				folders.push({ id, projectId: 'p1', title: body.title, parentFolderId: body.parentFolderId ?? null, locked: body.ownerApp === 'creative-studio-pro', ownedByCaller: true });
				return new Response(JSON.stringify({ folderId: id, locked: true }), { status: 201 });
			}
			const folder = folders.find((f) => path.endsWith(`/folders/${f.id}`))!;
			folder.title = body.title;
			return new Response(JSON.stringify({ folderId: folder.id }));
		}) as typeof fetch;
		return { client: createReviewRoomClient({ baseUrl: 'https://review.test', apiKey: 'test-key', fetch: fetcher }), folders, calls };
	}

	test('creates the tree locked, then a second run changes nothing; a renamed scene renames its folder', async () => {
		const room = fakeReviewRoom();
		const first = await syncSeriesTree(room.client, 'series-1', 'p1', seriesTree(episodes), {});
		expect(first).toMatchObject({ created: 9, renamed: 0 });
		expect(room.folders.every((f) => f.locked)).toBeTrue();
		expect(room.folders.find((f) => f.title === 'Characters')?.parentFolderId).toBe(first.folders.refs);
		expect(room.folders.find((f) => f.title === '020 PAR — Parking Lot')?.parentFolderId).toBe(first.folders['ep:e1']);
		expect(room.calls.filter((c) => c.startsWith('POST')).every((c) => c.endsWith('keyed'))).toBeTrue();

		const again = await syncSeriesTree(room.client, 'series-1', 'p1', seriesTree(episodes), first.folders);
		expect(again).toMatchObject({ created: 0, renamed: 0, folders: first.folders });

		const renamed = structuredClone(episodes);
		renamed[0].scenes[1].title = 'P02 — The Parking Lot';
		const third = await syncSeriesTree(room.client, 'series-1', 'p1', seriesTree(renamed), first.folders);
		expect(third.renamed).toBe(1);
		expect(room.folders.find((f) => f.id === first.folders['scene:s2'])?.title).toBe('020 PAR — The Parking Lot');
	});

	test('idempotency keys are stable per operation and differ when the body changes', () => {
		expect(idempotencyKey('a', 'b')).toBe(idempotencyKey('a', 'b'));
		expect(idempotencyKey('a', 'b')).not.toBe(idempotencyKey('a', 'c'));
		expect(idempotencyKey('a', 'b')).toMatch(/^csp-[0-9a-f]{48}$/);
	});

	test('a refused key surfaces Review Room\'s message', async () => {
		const refuse = (async () => new Response(JSON.stringify({ error: 'Automation credential unavailable' }), { status: 401 })) as unknown as typeof fetch;
		const client = createReviewRoomClient({ baseUrl: 'https://review.test', apiKey: 'wrong', fetch: refuse });
		await expect(client.folders('p1')).rejects.toThrow('Automation credential unavailable');
	});
});
