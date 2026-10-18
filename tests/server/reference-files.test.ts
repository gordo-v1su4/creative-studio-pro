import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SeriesStore, type SeriesRecord } from '../../src/lib/server/series';
import { referenceCode, reviewRoomReferenceFiles, uploadReference, type ReferenceFileDeps } from '../../src/lib/server/reference-files';
import type { ReviewRoomClient } from '../../src/lib/server/review-room';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const check = { ok: true, missing: [], wrongType: [], optionalMissing: [] };
const kai = { page_id: 'r1', name: 'Kai "Hoodie" Santana', kind: 'Character', role: '', handles: ['@Kai'], file_name: 'Kai_Hoodie_Santana.png', name_on_sheet: true, scene_ids: [] };
const record = (folders: Record<string, string>): SeriesRecord => ({
	schema_version: 1, series_id: 's1', title: 'Blood Rush', notion_root_id: 's1', sources: { episodes: 'e', scenes: 's', shots: 'h' },
	checks: { episodes: check, scenes: check, shots: check }, story: null, episodes: [], runtime_min: 10, episode_projects: {},
	references: { database: 'd', source: 'src', check, items: [kai] }, show_code: 'BLR',
	review_room: { project_id: 'rr', folders, synced_at: null }, checked_at: '2026-10-18T00:00:00Z', created_at: '2026-10-18T00:00:00Z'
});

async function setup(folders: Record<string, string> = { 'refs:characters': 'f-chr' }, size = { width: 2400, height: 1350 }) {
	const root = await mkdtemp(join(tmpdir(), 'csp-reffiles-')); roots.push(root);
	const store = new SeriesStore(join(root, 'series'));
	await store.write(record(folders));
	const calls: string[] = [];
	const client = {
		changes: async () => ({ cursor: '1', assets: [], versions: [{ versionId: 'v1', assetId: 'a1', version: 1, isCurrent: true, processingState: 'ready', mimeType: 'image/png', createdAt: 1 }], removedAssets: [] }),
		beginUpload: async (input: { assetCode: string; folderId: string }) => { calls.push(`begin ${input.assetCode} ${input.folderId}`); return { sessionId: 's', url: 'u', posterUrl: 'p', assetId: 'a1' }; },
		putSigned: async () => {}, completeUpload: async () => ({ assetId: 'a1', jobId: 'j' }), putMetadata: async () => {}, setCurrentVersion: async () => {},
		versionMedia: async () => ({ original: { url: 'https://x/o.png', mimeType: 'image/png', sizeBytes: 1, expiresAt: 0 }, poster: null }),
		download: async () => { calls.push('download'); return new Uint8Array([7]); }
	} as unknown as ReviewRoomClient;
	const deps: ReferenceFileDeps = { client, store, cacheDir: join(root, 'cache'), probe: async () => size, poster: async (_input, output) => { await writeFile(output, 'jpg'); } };
	return { deps, store, calls };
}

describe('reference images in Review Room', () => {
	test('a vetted image goes to _References/Characters under a stable code and is recorded on the series', async () => {
		const { deps, store, calls } = await setup();
		const out = await uploadReference(deps, 's1', { page_id: 'r1', file_name: 'Kai_Hoodie_Santana_sheet.png', bytes: new Uint8Array([1, 2]) });
		expect(out.ok).toBeTrue();
		expect(calls).toEqual(['begin BLR_REF_CHR_KAI_HOODIE_SANTANA f-chr']);
		expect((await store.read('s1'))!.reference_files!.r1).toMatchObject({ asset_id: 'a1', version_id: 'v1', width: 2400, height: 1350 });
		// The send attaches the cached copy; no download needed after the upload.
		const file = await reviewRoomReferenceFiles(deps)(kai);
		expect(new Uint8Array(await readFile(file!))).toEqual(new Uint8Array([1, 2]));
		expect(calls).not.toContain('download');
	});

	test('refused: a file name without the exact name, under 2K, or no _References folders yet', async () => {
		const named = await setup();
		expect(await uploadReference(named.deps, 's1', { page_id: 'r1', file_name: 'kai.png', bytes: new Uint8Array([1]) })).toMatchObject({ ok: false, status: 400 });
		const small = await setup(undefined, { width: 1920, height: 1080 });
		expect(await uploadReference(small.deps, 's1', { page_id: 'r1', file_name: 'Kai_Hoodie_Santana.png', bytes: new Uint8Array([1]) })).toMatchObject({ ok: false, message: expect.stringContaining('2048') });
		const noFolders = await setup({});
		expect(await uploadReference(noFolders.deps, 's1', { page_id: 'r1', file_name: 'Kai_Hoodie_Santana.png', bytes: new Uint8Array([1]) })).toMatchObject({ ok: false, status: 409 });
	});

	test('reference codes are stable per kind and name', () => {
		expect(referenceCode('BLR', 'refs:locations', 'the Video Haven interior')).toBe('BLR_REF_LOC_THE_VIDEO_HAVEN_INTERIOR');
	});
});
