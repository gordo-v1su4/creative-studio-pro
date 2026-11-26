import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SeriesStore, type SeriesRecord } from '../../src/lib/server/series';
import { referenceSourcePath, reviewRoomReferenceFiles, uploadReference, type ReferenceFileDeps } from '../../src/lib/server/reference-files';
import { referenceCode } from '../../src/lib/domain/series-tree';
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
	const sent: Uint8Array[] = [];
	const client = {
		changes: async () => ({ cursor: '1', assets: [], versions: [{ versionId: 'v1', assetId: 'a1', version: 1, isCurrent: true, processingState: 'ready', mimeType: 'image/png', createdAt: 1 }], removedAssets: [] }),
		beginUpload: async (input: { assetCode: string; folderId: string }) => { calls.push(`begin ${input.assetCode} ${input.folderId}`); return { sessionId: 's', url: 'u', posterUrl: 'p', assetId: 'a1' }; },
		putSigned: async (url: string, bytes: Uint8Array) => { if (url === 'u') sent.push(bytes); }, completeUpload: async () => ({ assetId: 'a1', jobId: 'j' }), putMetadata: async () => {}, setCurrentVersion: async () => {},
		versionMedia: async () => ({ original: { url: 'https://x/o.png', mimeType: 'image/png', sizeBytes: 1, expiresAt: 0 }, poster: null }),
		download: async () => { calls.push('download'); return new Uint8Array([7]); }
	} as unknown as ReviewRoomClient;
	const deps: ReferenceFileDeps = { client, store, cacheDir: join(root, 'cache'), sourceDir: join(root, 'sources'), probe: async () => size, poster: async (_input, output) => { await writeFile(output, 'jpg'); } };
	return { deps, store, calls, sent };
}

describe('reference images in Review Room', () => {
	test('legacy large sheets resolve to a PNG working copy while retaining the stored version', async () => {
		const { deps, store } = await setup();
		const out = await uploadReference(deps, 's1', { page_id: 'r1', file_name: 'Kai_Hoodie_Santana.png', bytes: new Uint8Array([1, 2]) });
		expect(out.ok).toBe(true);
		let conversions = 0, original = '';
		deps.normalizeSheet = async (input, output) => { conversions++; original = input; await writeFile(output, '2K PNG'); return output; };
		const path = await reviewRoomReferenceFiles(deps)(kai);
		expect(await readFile(path!, 'utf8')).toBe('2K PNG');
		expect(new Uint8Array(await readFile(original))).toEqual(new Uint8Array([1, 2]));
		await reviewRoomReferenceFiles(deps)(kai);
		expect(conversions).toBe(1);
		expect((await store.read('s1'))!.reference_files!.r1.version_id).toBe('v1');
	});
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

/** A fake 2K scaler like `normalizeReferenceSheet`: never upscales, writes a PNG no wider than 2048 on its long edge. */
function sized(deps: ReferenceFileDeps, sizes: Record<string, { width: number; height: number }>) {
	const scaled: string[] = [];
	deps.probe = async (file) => {
		if (file.endsWith('.2k.png')) return { width: 2048, height: 1152 } as never;
		const name = Object.keys(sizes).sort((a, b) => b.length - a.length).find((key) => file.endsWith(key));
		return (name ? sizes[name] : { width: 0, height: 0 }) as never;
	};
	deps.normalizeSheet = async (input, output) => { scaled.push(input); await writeFile(output, '2K PNG'); return output; };
	return scaled;
}

describe('Drift 07: keep the full-size sheet, send 2K (V1S-509)', () => {
	test('a 4K sheet lands in Review Room at 2K and its full-size file is kept as the reference\'s source image', async () => {
		const { deps, store, sent } = await setup();
		sized(deps, { '.jpg': { width: 4096, height: 2304 } });
		const out = await uploadReference(deps, 's1', { page_id: 'r1', file_name: 'Kai_Hoodie_Santana_4k.jpg', bytes: new Uint8Array([4, 0, 9, 6]) });
		expect(out.ok).toBeTrue();
		expect(sent).toEqual([new Uint8Array(Buffer.from('2K PNG'))]);
		const file = (await store.read('s1'))!.reference_files!.r1;
		expect(file).toMatchObject({ file_name: 'Kai_Hoodie_Santana_4k.png', mime_type: 'image/png', width: 2048, height: 1152 });
		expect(file.source_image).toMatchObject({ file_name: 'Kai_Hoodie_Santana_4k.jpg', mime_type: 'image/jpeg', width: 4096, height: 2304 });
		expect(new Uint8Array(await readFile(referenceSourcePath(deps.sourceDir, file)!))).toEqual(new Uint8Array([4, 0, 9, 6]));
		// The send still attaches the 2K, never the full-size file.
		expect(await readFile((await reviewRoomReferenceFiles(deps)(kai))!, 'utf8')).toBe('2K PNG');
	});

	test('a sheet already at 2K is sent unchanged and nothing extra is kept', async () => {
		const { deps, store, sent } = await setup();
		const scaled = sized(deps, { '.png': { width: 2048, height: 1152 } });
		const out = await uploadReference(deps, 's1', { page_id: 'r1', file_name: 'Kai_Hoodie_Santana.png', bytes: new Uint8Array([2, 0, 4, 8]) });
		expect(out.ok).toBeTrue();
		expect(scaled).toEqual([]);
		expect(sent).toEqual([new Uint8Array([2, 0, 4, 8])]);
		const file = (await store.read('s1'))!.reference_files!.r1;
		expect(file.source_image).toBeUndefined();
		expect(referenceSourcePath(deps.sourceDir, file)).toBeNull();
		expect(existsSync(deps.sourceDir) ? await readdir(deps.sourceDir) : []).toEqual([]);
	});

	test('a sheet already scaled by Prep keeps the full-size file it was made from', async () => {
		const { deps, store, sent } = await setup();
		sized(deps, { '.png': { width: 2048, height: 1152 }, 'made-4k.png': { width: 4096, height: 2304 } });
		const fullSize = join(deps.cacheDir, '..', 'Kai_Hoodie_Santana_sheet-made-4k.png');
		await writeFile(fullSize, new Uint8Array([4, 4]));
		const out = await uploadReference(deps, 's1', { page_id: 'r1', file_name: 'Kai_Hoodie_Santana_sheet.png', bytes: new Uint8Array([2, 2]), full_size: fullSize });
		expect(out.ok).toBeTrue();
		expect(sent).toEqual([new Uint8Array([2, 2])]);
		const file = (await store.read('s1'))!.reference_files!.r1;
		expect(file.source_image).toMatchObject({ file_name: 'Kai_Hoodie_Santana_sheet-made-4k.png', width: 4096, height: 2304 });
		expect(new Uint8Array(await readFile(referenceSourcePath(deps.sourceDir, file)!))).toEqual(new Uint8Array([4, 4]));
	});

	test('a full-size file that cannot be kept sends nothing to Review Room', async () => {
		const { deps, store, sent } = await setup();
		sized(deps, { '.jpg': { width: 4096, height: 2304 } });
		await writeFile(deps.sourceDir, 'a file where the folder should be');
		await expect(uploadReference(deps, 's1', { page_id: 'r1', file_name: 'Kai_Hoodie_Santana_4k.jpg', bytes: new Uint8Array([4]) })).rejects.toThrow();
		expect(sent).toEqual([]);
		expect((await store.read('s1'))!.reference_files).toBeUndefined();
	});

	test('a full-size file no larger than the 2K sent is not kept', async () => {
		const { deps, store } = await setup();
		sized(deps, { '.png': { width: 2048, height: 1152 } });
		const fullSize = join(deps.cacheDir, '..', 'Kai_Hoodie_Santana_sheet-made.png');
		await writeFile(fullSize, new Uint8Array([2]));
		expect((await uploadReference(deps, 's1', { page_id: 'r1', file_name: 'Kai_Hoodie_Santana_sheet.png', bytes: new Uint8Array([2]), full_size: fullSize })).ok).toBeTrue();
		expect((await store.read('s1'))!.reference_files!.r1.source_image).toBeUndefined();
	});

	test('a sheet under 2K is still refused, never scaled up', async () => {
		const { deps, store, sent } = await setup();
		sized(deps, { '.png': { width: 1678, height: 944 } });
		expect(await uploadReference(deps, 's1', { page_id: 'r1', file_name: 'Kai_Hoodie_Santana.png', bytes: new Uint8Array([1]) })).toMatchObject({ ok: false, message: expect.stringContaining('2048') });
		expect(sent).toEqual([]);
		expect((await store.read('s1'))!.reference_files).toBeUndefined();
	});
});
