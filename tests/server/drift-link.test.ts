import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SeriesStore, type SeriesRecord } from '../../src/lib/server/series';
import type { ChangeFeed, ReviewRoomClient } from '../../src/lib/server/review-room';
import type { NotionApi } from '../../src/lib/server/notion';
import type { NotionPage } from '../../src/lib/domain/notion-series';
import type { Project } from '../../src/lib/domain/schemas';
import { isMarkedOld, historyOf } from '../../src/lib/domain/drift';
import { linkSheet } from '../../src/lib/server/drift-link';
import { addPrepEntry, readPrep, update } from '../../src/lib/server/prep';

/**
 * Drift 05 (GitHub #34 / V1S-515, ADR 0012): "link" a stray sheet to the Notion reference its name is close to.
 * The stray's file goes up through the reference upload under the Notion name, as that reference's next version,
 * and only then is the stray marked old. Notion is only read. If the upload fails, nothing is marked. Notion and
 * Review Room are faked and log every call in order.
 */

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const check = { ok: true, missing: [], wrongType: [], optionalMissing: [] };
const refPage = (id: string, name: string, kind: string): NotionPage => ({
	id,
	properties: {
		Name: { type: 'title', title: [{ plain_text: name }] },
		Kind: { type: 'select', select: { name: kind } },
		Handles: { type: 'rich_text', rich_text: [] },
		Scenes: { type: 'relation', relation: [] }
	} as NotionPage['properties']
});

function fakeNotion(pages: NotionPage[] = [refPage('r-bryson', 'Bryson Vane', 'Character'), refPage('r-mara', 'Mara Voss', 'Character'), refPage('r-pool', 'Pool', 'Location')]) {
	const calls: string[] = [];
	const api = new Proxy({}, {
		get: (_, name: string) => {
			if (name === 'query') return async (source: string) => { calls.push(`query ${source}`); return { results: source === 'src-refs' ? pages : [], next_cursor: null, has_more: false }; };
			return async () => { calls.push(name); throw new Error(`Notion ${name} must not be called by a link`); };
		}
	}) as NotionApi;
	return { api, calls };
}

const asset = (assetId: string, folderId: string, assetCode: string | null): ChangeFeed['assets'][number] => ({ assetId, folderId, assetCode, title: assetCode ?? 'drop.png', currentVersionId: `v-${assetId}`, misfiled: false, copiedFromAssetId: null, updatedAt: 1 });

function fakeReviewRoom(options: { failUpload?: Error; failMark?: Error } = {}) {
	const calls: string[] = [];
	const uploaded: Array<{ assetCode: string; name: string; bytes?: Uint8Array }> = [];
	const marks: Array<{ versionId: string; metadata: Record<string, unknown> }> = [];
	const feed = (): ChangeFeed => ({
		cursor: '9',
		assets: [asset('a-bryson', 'f-chr', 'BLR_REF_CHR_BRYSON'), asset('a-mara', 'f-chr', 'BLR_REF_CHR_MARA_VOSS'), asset('a-pool', 'f-loc', 'BLR_REF_LOC_POOL_DECK')],
		versions: uploaded.length ? [{ versionId: 'v-new', assetId: 'a-vane', version: 1, isCurrent: true, processingState: 'ready', mimeType: 'image/png', createdAt: 2 }] : [],
		removedAssets: []
	});
	const client = new Proxy({}, {
		get: (_, name: string) => {
			const log = (line: string) => calls.push(line);
			switch (name) {
				case 'changes': return async () => { log('changes'); return feed(); };
				case 'versionMedia': return async (versionId: string) => { log(`versionMedia ${versionId}`); return { original: { url: `https://rr/${versionId}.png`, mimeType: 'image/png', sizeBytes: 3, expiresAt: 0 }, poster: null }; };
				case 'download': return async (url: string) => { log(`download ${url}`); return new Uint8Array([4, 5, 6]); };
				case 'beginUpload': return async (input: { assetCode: string; name: string }) => {
					log(`beginUpload ${input.assetCode} ${input.name}`);
					if (options.failUpload) throw options.failUpload;
					uploaded.push({ assetCode: input.assetCode, name: input.name });
					return { sessionId: 's', url: 'u', posterUrl: 'p', assetId: 'a-vane' };
				};
				case 'putSigned': return async (url: string, bytes: Uint8Array) => { log(`putSigned ${url}`); if (url === 'u') uploaded.at(-1)!.bytes = bytes; };
				case 'completeUpload': return async () => { log('completeUpload'); return { assetId: 'a-vane', jobId: 'j' }; };
				case 'setCurrentVersion': return async () => { log('setCurrentVersion'); };
				case 'versionMetadata': return async (versionId: string) => { log(`versionMetadata ${versionId}`); return { metadata: { customFields: [] }, updatedAt: 7 }; };
				case 'putMetadata': return async (versionId: string, metadata: Record<string, unknown>) => {
					log(`putMetadata ${versionId}`);
					if (versionId === 'v-a-bryson') { if (options.failMark) throw options.failMark; marks.push({ versionId, metadata }); }
				};
				default: return async () => { log(name); throw new Error(`Review Room ${name} must not be called by a link`); };
			}
		}
	}) as ReviewRoomClient;
	return { client, calls, uploaded, marks };
}

async function setup(review: ReturnType<typeof fakeReviewRoom> | null, notion = fakeNotion()) {
	const root = await mkdtemp(join(tmpdir(), 'csp-drift-link-')); roots.push(root);
	const series = new SeriesStore(join(root, 'series'));
	const ref = (page_id: string, name: string, kind = 'Character') => ({ page_id, name, kind, role: '', handles: [], file_name: '', name_on_sheet: false, scene_ids: [] });
	const record: SeriesRecord = {
		schema_version: 1, series_id: 'ser1', title: 'Blood Rush', notion_root_id: 'ser1',
		sources: { episodes: 'src-ep', scenes: 'src-sc', shots: 'src-sh' }, checks: { episodes: check, scenes: check, shots: check }, story: null, episodes: [],
		references: { database: 'db-refs', source: 'src-refs', check, items: [ref('r-bryson', 'Bryson Vane'), ref('r-mara', 'Mara Voss'), ref('r-pool', 'Pool', 'Location')] },
		runtime_min: 10, episode_projects: {}, show_code: 'BLR',
		review_room: { project_id: 'rr1', folders: { 'refs:characters': 'f-chr', 'refs:locations': 'f-loc', 'refs:props': 'f-prp' }, synced_at: null },
		checked_at: '2026-11-25T00:00:00.000Z', created_at: '2026-11-25T00:00:00.000Z'
	};
	await series.write(record);
	const project = { project_id: 'p-tr110', title: 'TR110', series: { series_id: 'ser1' }, production: {} } as unknown as Project;
	const references = review ? {
		client: review.client, store: series, cacheDir: join(root, 'cache'), sourceDir: join(root, 'sources'),
		probe: async () => ({ width: 2048, height: 1152 }), poster: async (_input: string, output: string) => { await writeFile(output, 'jpg'); }
	} : null;
	const projectRoot = join(root, 'projects');
	return { deps: { projectRoot, series, notion: notion.api, references }, project, series, notion, projectRoot };
}

describe('linking a stray sheet to its Notion reference (Drift 05)', () => {
	test('Bryson goes up under Bryson Vane first, then the stray is marked old as its history', async () => {
		const review = fakeReviewRoom();
		const { deps, project, series, notion } = await setup(review);
		const out = await linkSheet(deps, project, { page_id: 'r-bryson', asset_id: 'a-bryson' });
		expect(out).toMatchObject({ ok: true, name: 'Bryson Vane', sent: { code: 'BLR_REF_CHR_BRYSON_VANE' }, marked: { code: 'BLR_REF_CHR_BRYSON' } });

		// The stray's own file, under the Notion name, as Bryson Vane's sheet.
		expect(review.uploaded).toHaveLength(1);
		expect(review.uploaded[0].assetCode).toBe('BLR_REF_CHR_BRYSON_VANE');
		expect(review.uploaded[0].name).toBe('Bryson_Vane_sheet.png');
		expect(review.uploaded[0].bytes).toEqual(new Uint8Array([4, 5, 6]));
		expect((await series.read('ser1'))!.reference_files!['r-bryson']).toMatchObject({ asset_id: 'a-vane', code: 'BLR_REF_CHR_BRYSON_VANE' });

		// Upload first, mark second.
		const upload = review.calls.indexOf('beginUpload BLR_REF_CHR_BRYSON_VANE Bryson_Vane_sheet.png');
		const mark = review.calls.indexOf('putMetadata v-a-bryson');
		expect(upload).toBeGreaterThan(review.calls.indexOf('download https://rr/v-a-bryson.png'));
		expect(mark).toBeGreaterThan(upload);
		expect(review.marks).toHaveLength(1);
		expect(isMarkedOld(review.marks[0].metadata)).toBeTrue();
		expect(historyOf(review.marks[0].metadata)).toEqual({ page_id: 'r-bryson', name: 'Bryson Vane' });

		// Notion is only read.
		expect(notion.calls.every((call) => call.startsWith('query '))).toBeTrue();
	});

	test('if the upload fails nothing is marked and nothing is recorded', async () => {
		const review = fakeReviewRoom({ failUpload: new Error('Review Room timed out') });
		const { deps, project, series } = await setup(review);
		const out = await linkSheet(deps, project, { page_id: 'r-bryson', asset_id: 'a-bryson' });
		expect(out.ok).toBeFalse();
		if (!out.ok) expect(out.message).toContain('Nothing was marked old');
		expect(review.calls.filter((call) => call.startsWith('putMetadata') || call.startsWith('versionMetadata'))).toEqual([]);
		expect(review.marks).toEqual([]);
		expect((await series.read('ser1'))!.reference_files).toBeUndefined();
	});

	test('an upload the reference upload refuses (under 2K) marks nothing', async () => {
		const review = fakeReviewRoom();
		const { deps, project } = await setup(review);
		const small = { ...deps, references: { ...deps.references!, probe: async () => ({ width: 1678, height: 944 }) } };
		const out = await linkSheet(small, project, { page_id: 'r-bryson', asset_id: 'a-bryson' });
		expect(out.ok).toBeFalse();
		if (!out.ok) expect(out.message).toContain('1678');
		expect(review.calls.some((call) => call.startsWith('beginUpload') || call.startsWith('putMetadata'))).toBeFalse();
	});

	test('a mark that fails after the upload says the sheet is in and the stray is not marked', async () => {
		const review = fakeReviewRoom({ failMark: new Error('conflict') });
		const { deps, project, series } = await setup(review);
		const out = await linkSheet(deps, project, { page_id: 'r-bryson', asset_id: 'a-bryson' });
		expect(out.ok).toBeFalse();
		if (!out.ok) expect(out.message).toMatch(/BLR_REF_CHR_BRYSON_VANE.*BLR_REF_CHR_BRYSON was not marked old/);
		expect((await series.read('ser1'))!.reference_files!['r-bryson'].code).toBe('BLR_REF_CHR_BRYSON_VANE');
	});

	test('a reference renamed in Notion since the last re-check is refused before any write', async () => {
		const review = fakeReviewRoom();
		const { deps, project } = await setup(review, fakeNotion([refPage('r-bryson', 'Bryson Vance', 'Character')]));
		const out = await linkSheet(deps, project, { page_id: 'r-bryson', asset_id: 'a-bryson' });
		expect(out).toMatchObject({ ok: false, status: 409 });
		expect(review.calls.filter((call) => call !== 'changes')).toEqual([]);
	});

	test('refuses before any write: a sheet of another kind, a sheet a reference uses, an unknown sheet, no Notion, no Review Room', async () => {
		const review = fakeReviewRoom();
		const { deps, project } = await setup(review);
		const writes = () => review.calls.filter((call) => !['changes'].includes(call));
		expect(await linkSheet(deps, project, { page_id: 'r-bryson', asset_id: 'a-pool' })).toMatchObject({ ok: false, status: 400 });
		expect(await linkSheet(deps, project, { page_id: 'r-bryson', asset_id: 'a-mara' })).toMatchObject({ ok: false, status: 409 });
		expect(await linkSheet(deps, project, { page_id: 'r-bryson', asset_id: 'a-none' })).toMatchObject({ ok: false, status: 404 });
		expect(await linkSheet(deps, project, { page_id: 'r-nobody', asset_id: 'a-bryson' })).toMatchObject({ ok: false, status: 400 });
		expect(writes()).toEqual([]);
		expect(await linkSheet({ ...deps, notion: null }, project, { page_id: 'r-bryson', asset_id: 'a-bryson' })).toMatchObject({ ok: false, status: 503 });
		expect(await linkSheet({ ...deps, references: null }, project, { page_id: 'r-bryson', asset_id: 'a-bryson' })).toMatchObject({ ok: false, status: 503 });
		expect(writes()).toEqual([]);
	});

	test('a Prep entry under a stray name is pointed at the Notion page, its work kept; with no sheet nothing reaches Review Room', async () => {
		const review = fakeReviewRoom();
		const { deps, project, projectRoot } = await setup(review);
		await mkdir(join(projectRoot, project.project_id), { recursive: true });
		await addPrepEntry({ projectRoot }, project.project_id, 'character', 'Bryson');
		await update(projectRoot, project.project_id, 'character:Bryson', (state) => ({ ...state, prompt: 'tall, scar', prompt_edited: true }));
		const out = await linkSheet(deps, project, { page_id: 'r-bryson', former_names: ['Bryson'] });
		expect(out).toMatchObject({ ok: true, name: 'Bryson Vane', sent: null, marked: null });
		const after = await readPrep(projectRoot, project.project_id);
		expect(after.custom_entries).toEqual([{ kind: 'character', name: 'Bryson Vane', reference_page_id: 'r-bryson' }]);
		expect(after.entries['r-bryson']).toMatchObject({ prompt: 'tall, scar' });
		expect(after.entries['character:Bryson']).toBeUndefined();
		expect(review.calls.filter((call) => call !== 'changes')).toEqual([]);
	});

	test('a link with neither a sheet nor a Prep entry is refused', async () => {
		const { deps, project } = await setup(fakeReviewRoom());
		expect(await linkSheet(deps, project, { page_id: 'r-bryson' })).toMatchObject({ ok: false, status: 400 });
	});
});
