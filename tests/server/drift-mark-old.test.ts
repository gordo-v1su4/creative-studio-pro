import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SeriesStore, type SeriesRecord } from '../../src/lib/server/series';
import { ReviewRoomError, type ChangeFeed, type ReviewRoomClient } from '../../src/lib/server/review-room';
import type { Project } from '../../src/lib/domain/schemas';
import { markedOld } from '../../src/lib/domain/drift';
import { markOld } from '../../src/lib/server/drift';
import { sheetFiles } from '../../src/lib/server/caption-cast';

/**
 * Drift 04 (GitHub #33 / V1S-511, ADR 0012): "mark as old" on a Review Room sheet no Notion reference uses. It
 * writes only the old flag (and the reference it is history of) into the asset's current version metadata, read
 * first and written back with its revision, then stops offering the sheet here. Review Room is faked and logs
 * every call; a failed write leaves everything as it was.
 */

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const check = { ok: true, missing: [], wrongType: [], optionalMissing: [] };
const asset = (assetId: string, folderId: string, assetCode: string | null): ChangeFeed['assets'][number] => ({ assetId, folderId, assetCode, title: assetCode ?? 'drop.png', currentVersionId: `v-${assetId}`, misfiled: false, copiedFromAssetId: null, updatedAt: 1 });
const readBack = (versionId: string) => ({
	metadata: { model: '', prompt: '', sourceLabel: 'Creative Studio Pro', referenceImageVersionIds: [], notes: `notes of ${versionId}`, customFields: [{ id: 'reference', label: 'reference', kind: 'text', value: 'Lucian Vale' }] },
	updatedAt: 41
});

function fakeReviewRoom(options: { failWrite?: Error; old?: string[] } = {}) {
	const calls: string[] = [];
	const writes: Array<{ versionId: string; metadata: Record<string, unknown>; expectedUpdatedAt: number | null }> = [];
	const feed: ChangeFeed = {
		cursor: '99',
		assets: [
			asset('a-mara', 'f-chr', 'BLR_REF_CHR_MARA_VOSS'), asset('a-vale', 'f-chr', 'BLR_REF_CHR_LUCIAN_VALE'),
			asset('a-gone', 'f-prp', 'BLR_REF_PRP_GONE'), asset('a-shot', 'f-scene', 'BLR_101_010_PAR_010')
		],
		versions: [], removedAssets: [{ assetId: 'a-gone', mergedIntoAssetId: null, reason: 'deleted' }]
	};
	const client = new Proxy({}, {
		get: (_, name: string) => {
			if (name === 'changes') return async (projectId: string, since: string) => { calls.push(`changes ${projectId} ${since}`); return feed; };
			if (name === 'versionMetadata') return async (versionId: string) => {
				calls.push(`versionMetadata ${versionId}`);
				const read = readBack(versionId);
				return options.old?.includes(versionId) ? { ...read, metadata: markedOld(read.metadata, null) } : read;
			};
			if (name === 'putMetadata') return async (versionId: string, metadata: Record<string, unknown>, expectedUpdatedAt: number | null) => {
				calls.push(`putMetadata ${versionId}`);
				if (options.failWrite) throw options.failWrite;
				writes.push({ versionId, metadata, expectedUpdatedAt });
			};
			return async () => { calls.push(name); throw new Error(`${name} must not be called when marking a sheet old`); };
		}
	}) as ReviewRoomClient;
	return { client, calls, writes };
}

async function setup(client: ReviewRoomClient | null, files: SeriesRecord['reference_files'] = undefined) {
	const root = await mkdtemp(join(tmpdir(), 'csp-drift-old-')); roots.push(root);
	const series = new SeriesStore(join(root, 'series'));
	const ref = (page_id: string, name: string) => ({ page_id, name, kind: 'Character', role: '', handles: [], file_name: '', name_on_sheet: false, scene_ids: [] });
	const record: SeriesRecord = {
		schema_version: 1, series_id: 'ser1', title: 'Blood Rush', notion_root_id: 'ser1',
		sources: { episodes: 'src-ep', scenes: 'src-sc', shots: 'src-sh' }, checks: { episodes: check, scenes: check, shots: check }, story: null, episodes: [],
		references: { database: 'db-refs', source: 'src-refs', check, items: [ref('r-mara', 'Mara Voss'), ref('r-lucian', 'Lucian Blaise')] },
		...(files ? { reference_files: files } : {}),
		runtime_min: 10, episode_projects: {}, show_code: 'BLR',
		review_room: { project_id: 'rr1', folders: { 'refs:characters': 'f-chr', 'refs:locations': 'f-loc', 'refs:props': 'f-prp', 'scene:s-ep1': 'f-scene' }, synced_at: null },
		checked_at: '2026-11-25T00:00:00.000Z', created_at: '2026-11-25T00:00:00.000Z'
	};
	await series.write(record);
	const project = { project_id: 'p-tr110', title: 'TR110', series: { series_id: 'ser1' }, production: {} } as unknown as Project;
	return { deps: { projectRoot: join(root, 'projects'), series, client }, project, series };
}

const lucianFile = { asset_id: 'a-vale', version_id: 'v-a-vale', version: 1, code: 'BLR_REF_CHR_LUCIAN_VALE', file_name: 'Lucian Vale.png', mime_type: 'image/png', width: 2048, height: 1152, uploaded_at: '2026-11-01T00:00:00.000Z' };

describe('marking a stray sheet old (Drift 04)', () => {
	test('writes only the flag and the reference it is history of into the current version, with its revision', async () => {
		const room = fakeReviewRoom();
		const { deps, project, series } = await setup(room.client);
		const before = await series.read('ser1');
		const marked = await markOld(deps, project, { asset_id: 'a-vale', history_of: 'r-lucian' });
		expect(marked).toMatchObject({ ok: true, code: 'BLR_REF_CHR_LUCIAN_VALE', history_of: { page_id: 'r-lucian', name: 'Lucian Blaise' } });
		expect(room.calls).toEqual(['changes rr1 0', 'versionMetadata v-a-vale', 'putMetadata v-a-vale']);
		expect(room.writes).toEqual([{ versionId: 'v-a-vale', metadata: markedOld(readBack('v-a-vale').metadata, { page_id: 'r-lucian', name: 'Lucian Blaise' }), expectedUpdatedAt: 41 }]);
		// Nothing else changes here: only Review Room's metadata is written.
		expect(await series.read('ser1')).toEqual(before);
	});

	test('with no reference, only the flag is written', async () => {
		const room = fakeReviewRoom();
		const { deps, project } = await setup(room.client);
		expect(await markOld(deps, project, { asset_id: 'a-vale' })).toMatchObject({ ok: true, history_of: null });
		expect(room.writes[0].metadata.customFields).toEqual([...readBack('v-a-vale').metadata.customFields, { id: 'old', label: 'Old', kind: 'boolean', value: true }]);
	});

	test("a sheet still a reference's picture here is refused, so Prep, the shot pickers and sends never hold an old sheet", async () => {
		const room = fakeReviewRoom();
		const { deps, project, series } = await setup(room.client, { 'r-lucian': lucianFile });
		const before = await series.read('ser1');
		const marked = await markOld(deps, project, { asset_id: 'a-vale' });
		expect(marked).toMatchObject({ ok: false, status: 409 });
		if (!marked.ok) expect(marked.message).toContain("Lucian Blaise's picture");
		expect(room.calls).toEqual(['changes rr1 0']);
		const record = (await series.read('ser1'))!;
		expect(record).toEqual(before!);
		expect(await sheetFiles(record, join(deps.projectRoot, 'cache'))(record.references!.items[1])).toBeNull();
	});

	test('a failed write leaves the asset and the series as they were, and says why', async () => {
		const room = fakeReviewRoom({ failWrite: new ReviewRoomError(409, 'Metadata changed since your read; read it again and retry') });
		const { deps, project, series } = await setup(room.client);
		const before = await series.read('ser1');
		const marked = await markOld(deps, project, { asset_id: 'a-vale', history_of: 'r-lucian' });
		expect(marked).toMatchObject({ ok: false, status: 409 });
		if (!marked.ok) {
			expect(marked.message).toContain('Metadata changed since your read');
			expect(marked.message).toContain('Nothing was changed');
		}
		expect(room.writes).toEqual([]);
		expect(await series.read('ser1')).toEqual(before);
	});

	test('a sheet already marked old is not written again', async () => {
		const room = fakeReviewRoom({ old: ['v-a-vale'] });
		const { deps, project } = await setup(room.client);
		expect(await markOld(deps, project, { asset_id: 'a-vale' })).toMatchObject({ ok: true });
		expect(room.calls).toEqual(['changes rr1 0', 'versionMetadata v-a-vale']);
	});

	test('refuses, with no metadata read or written: a sheet a Notion reference uses, a shot, a removed or unknown asset, a reference outside the series', async () => {
		const room = fakeReviewRoom();
		const { deps, project } = await setup(room.client);
		const inUse = await markOld(deps, project, { asset_id: 'a-mara' });
		expect(inUse).toMatchObject({ ok: false, status: 409 });
		if (!inUse.ok) expect(inUse.message).toContain('Mara Voss');
		for (const asset_id of ['a-shot', 'a-gone', 'a-none']) expect(await markOld(deps, project, { asset_id })).toMatchObject({ ok: false, status: 404 });
		expect(await markOld(deps, project, { asset_id: 'a-vale', history_of: 'r-elsewhere' })).toMatchObject({ ok: false, status: 400 });
		// A character sheet is never a prop's history.
		const prop = { page_id: 'r-shades', name: "Kai's Sunglasses", kind: 'Prop', role: '', handles: [], file_name: '', name_on_sheet: false, scene_ids: [] };
		await deps.series.update('ser1', (now) => ({ ...now, references: { ...now.references!, items: [...now.references!.items, prop] } }));
		expect(await markOld(deps, project, { asset_id: 'a-vale', history_of: 'r-shades' })).toMatchObject({ ok: false, status: 400 });
		expect(room.calls.filter((call) => !call.startsWith('changes'))).toEqual([]);
	});

	test('without Review Room configured here, says so and writes nothing', async () => {
		const { deps, project } = await setup(null);
		expect(await markOld(deps, project, { asset_id: 'a-vale' })).toMatchObject({ ok: false, status: 503 });
	});
});
