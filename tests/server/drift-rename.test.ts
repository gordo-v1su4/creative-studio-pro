import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { SeriesStore, type SeriesRecord } from '../../src/lib/server/series';
import type { NotionApi } from '../../src/lib/server/notion';
import { ReviewRoomError, type ChangeFeed, type ReviewRoomClient } from '../../src/lib/server/review-room';
import type { NotionPage } from '../../src/lib/domain/notion-series';
import { markedOld } from '../../src/lib/domain/drift';
import { answerRename, checkDrift } from '../../src/lib/server/drift';
import { uploadReference } from '../../src/lib/server/reference-files';

/**
 * Drift 06 (GitHub #35 / V1S-516, ADR 0012): a name changed in Notion after its code is set is caught, never
 * followed. Lucian Vale's sheet was sent from Notion page r-lucian; Notion now calls that page Lucian Blaise. Notion
 * and Review Room are faked and log every call.
 */

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const check = { ok: true, missing: [], wrongType: [], optionalMissing: [] };
const refPage = (id: string, name: string, kind: string): NotionPage => ({
	id, properties: { Name: { type: 'title', title: [{ plain_text: name }] }, Kind: { type: 'select', select: { name: kind } } } as NotionPage['properties']
});

function fakeNotion(options: { names?: Record<string, string>; failUpdate?: Error } = {}) {
	const calls: string[] = [];
	const updates: Array<{ page: string; properties: Record<string, unknown> }> = [];
	const names = { 'r-lucian': 'Lucian Blaise', 'r-mara': 'Mara Voss', ...options.names };
	const api = {
		query: async (source: string) => { calls.push(`query ${source}`); return { results: source === 'src-refs' ? Object.entries(names).map(([id, name]) => refPage(id, name, 'Character')) : [], next_cursor: null, has_more: false }; },
		updatePage: async (page: string, properties: Record<string, unknown>) => { calls.push(`update ${page}`); if (options.failUpdate) throw options.failUpdate; updates.push({ page, properties }); },
		createPage: async () => { calls.push('create'); throw new Error('create must not be called'); },
		trashPage: async () => { calls.push('trash'); throw new Error('trash must not be called'); }
	} as unknown as NotionApi;
	return { api, calls, updates };
}

const asset = (assetId: string, assetCode: string): ChangeFeed['assets'][number] => ({ assetId, folderId: 'f-chr', assetCode, title: `${assetCode}.png`, currentVersionId: `v-${assetId}`, misfiled: false, copiedFromAssetId: null, updatedAt: 1 });
/** The metadata a reference upload writes: its name and Notion page as custom fields. */
const sentMetadata = (reference: string, page: string) => ({
	model: '', prompt: '', sourceLabel: 'Creative Studio Pro', referenceImageVersionIds: [],
	customFields: [{ id: 'reference', label: 'reference', kind: 'text', value: reference }, { id: 'notion_page_id', label: 'notion page id', kind: 'text', value: page }]
});

function fakeReviewRoom(options: { failWrite?: Error } = {}) {
	const calls: string[] = [];
	const metadata: Record<string, Record<string, unknown>> = { 'v-a-mara': sentMetadata('Mara Voss', 'r-mara'), 'v-a-vale': sentMetadata('Lucian Vale', 'r-lucian') };
	const feed: ChangeFeed = { cursor: '9', assets: [asset('a-mara', 'BLR_REF_CHR_MARA_VOSS'), asset('a-vale', 'BLR_REF_CHR_LUCIAN_VALE')], versions: [], removedAssets: [] };
	const client = new Proxy({}, {
		get: (_, name: string) => {
			if (name === 'changes') return async (projectId: string, since: string) => { calls.push(`changes ${projectId} ${since}`); return feed; };
			if (name === 'versionMetadata') return async (versionId: string) => { calls.push(`versionMetadata ${versionId}`); return { metadata: metadata[versionId], updatedAt: 7 }; };
			if (name === 'putMetadata') return async (versionId: string, next: Record<string, unknown>) => {
				calls.push(`putMetadata ${versionId}`);
				if (options.failWrite) throw options.failWrite;
				metadata[versionId] = next;
			};
			return async () => { calls.push(name); throw new Error(`${name} must not be called`); };
		}
	}) as ReviewRoomClient;
	return { client, calls, metadata };
}

const lucianFile = { asset_id: 'a-vale', version_id: 'v-a-vale', version: 1, code: 'BLR_REF_CHR_LUCIAN_VALE', file_name: 'Lucian Vale.png', mime_type: 'image/png', width: 2048, height: 1152, uploaded_at: '2026-11-01T00:00:00.000Z' };
const maraFile = { ...lucianFile, asset_id: 'a-mara', version_id: 'v-a-mara', code: 'BLR_REF_CHR_MARA_VOSS', file_name: 'Mara Voss.png' };

async function setup(notion: NotionApi, client: ReviewRoomClient | null) {
	const root = await mkdtemp(join(tmpdir(), 'csp-drift-rename-')); roots.push(root);
	const projectRoot = join(root, 'projects');
	const store = new ProjectStore({ root: projectRoot });
	const gateway = new ProjectCommandGateway(store);
	const created = await gateway.createProject({ command: 'create_project', title: 'TR110', brief: '', creative_focus: 'full room', created_by: 'test' });
	if (!created.ok) throw new Error(created.error.message);
	const imported = await gateway.importEpisode(created.data.project_id, created.data.version, {
		series: { series_id: 'ser1', episode_page_id: 'ep1', episode_number: 1, season: 1, episode_title: 'TR110', summary: '', twist: '', cliffhanger: '', imported_at: '2026-11-25T00:00:00.000Z', outline: '', scenes: [] },
		groups: [], cards: [], title: 'TR110', logline: ''
	});
	if (!imported.ok) throw new Error(imported.error.message);
	const series = new SeriesStore(join(root, 'series'));
	const ref = (page_id: string, name: string) => ({ page_id, name, kind: 'Character', role: '', handles: [], file_name: '', name_on_sheet: false, scene_ids: [] });
	const record: SeriesRecord = {
		schema_version: 1, series_id: 'ser1', title: 'Blood Rush', notion_root_id: 'ser1',
		sources: { episodes: 'src-ep', scenes: 'src-sc', shots: 'src-sh' }, checks: { episodes: check, scenes: check, shots: check }, story: null, episodes: [],
		// The record still holds the name from the last re-check; Notion has moved on.
		references: { database: 'db-refs', source: 'src-refs', check, items: [ref('rmara', 'Mara Voss'), ref('rlucian', 'Lucian Vale')] },
		reference_files: { rmara: maraFile, rlucian: lucianFile },
		runtime_min: 10, episode_projects: { ep1: created.data.project_id }, show_code: 'BLR',
		review_room: { project_id: 'rr1', folders: { 'refs:characters': 'f-chr', 'refs:locations': 'f-loc', 'refs:props': 'f-prp' }, synced_at: null },
		checked_at: '2026-11-25T00:00:00.000Z', created_at: '2026-11-25T00:00:00.000Z'
	};
	await series.write(record);
	await writeFile(join(root, 'marker'), '');
	return { deps: { store, projectRoot, series, notion, client }, project: (await store.readProject(created.data.project_id))!, series, root };
}

describe('a rename in Notion after the code is set (Drift 06)', () => {
	test('the check shows it as one item, with the name the sheet carries, and writes nothing', async () => {
		const notion = fakeNotion();
		const room = fakeReviewRoom();
		const { deps, project } = await setup(notion.api, room.client);
		const checked = await checkDrift(deps, project);
		if (!checked.ok) throw new Error(checked.message);
		expect(checked.report.items).toEqual([expect.objectContaining({
			type: 'renamed_in_notion', name: 'Lucian Blaise', choices: ['restore_name', 'new_reference'],
			renamed: { page_id: 'rlucian', from: 'Lucian Vale', to: 'Lucian Blaise', sheets: [{ asset_id: 'a-vale', code: 'BLR_REF_CHR_LUCIAN_VALE' }] }
		})]);
		expect(notion.calls).toEqual(['query src-refs']);
		expect(room.calls.filter((call) => call.startsWith('putMetadata'))).toEqual([]);
	});

	test('"put the old name back" writes only the Name in Notion, and nothing in Review Room', async () => {
		const notion = fakeNotion();
		const room = fakeReviewRoom();
		const { deps, project, series } = await setup(notion.api, room.client);
		const answered = await answerRename(deps, project, { page_id: 'rlucian', choice: 'restore_name' });
		expect(answered).toMatchObject({ ok: true, name: 'Lucian Vale', marked: [] });
		expect(notion.updates).toEqual([{ page: 'rlucian', properties: { Name: { title: [{ type: 'text', text: { content: 'Lucian Vale' } }] } } }]);
		expect(notion.calls.filter((call) => !call.startsWith('query'))).toEqual(['update rlucian']);
		expect(room.calls.filter((call) => call.startsWith('putMetadata'))).toEqual([]);
		const record = (await series.read('ser1'))!;
		expect(record.reference_files?.rlucian).toEqual(lucianFile);
		expect(record.references!.items.find((ref) => ref.page_id === 'rlucian')!.name).toBe('Lucian Vale');
	});

	test('another reference of that kind holding the old name now leaves nothing to answer', async () => {
		const notion = fakeNotion({ names: { 'r-other': 'Lucian Vale' } });
		const { deps, project } = await setup(notion.api, fakeReviewRoom().client);
		const answered = await answerRename(deps, project, { page_id: 'rlucian', choice: 'restore_name' });
		// With another page called Lucian Vale the old sheet's code is in use, so it is not a rename at all.
		expect(answered).toMatchObject({ ok: false, status: 409 });
		expect(notion.updates).toEqual([]);
	});

	test('a Notion refusal changes nothing and says why', async () => {
		const notion = fakeNotion({ failUpdate: new Error('Notion is down') });
		const { deps, project, series } = await setup(notion.api, fakeReviewRoom().client);
		const before = await series.read('ser1');
		const answered = await answerRename(deps, project, { page_id: 'rlucian', choice: 'restore_name' });
		expect(answered).toMatchObject({ ok: false, status: 502 });
		if (!answered.ok) expect(answered.message).toContain('Nothing was changed');
		expect(await series.read('ser1')).toEqual(before);
	});

	test('"make it a new reference" leaves Notion alone, marks the old sheet old as its history, and the next send makes the new code', async () => {
		const notion = fakeNotion();
		const room = fakeReviewRoom();
		const { deps, project, series, root } = await setup(notion.api, room.client);
		const answered = await answerRename(deps, project, { page_id: 'rlucian', choice: 'new_reference' });
		expect(answered).toMatchObject({ ok: true, name: 'Lucian Blaise', marked: ['BLR_REF_CHR_LUCIAN_VALE'] });
		expect(notion.calls.filter((call) => !call.startsWith('query'))).toEqual([]);
		expect(room.calls.filter((call) => call.startsWith('putMetadata'))).toEqual(['putMetadata v-a-vale']);
		expect(room.metadata['v-a-vale']).toEqual(markedOld(sentMetadata('Lucian Vale', 'r-lucian'), { page_id: 'rlucian', name: 'Lucian Blaise' }));

		const record = (await series.read('ser1'))!;
		expect(record.reference_files?.rlucian).toBeUndefined();
		expect(record.reference_files?.rmara).toEqual(maraFile);
		expect(record.references!.items.find((ref) => ref.page_id === 'rlucian')!.name).toBe('Lucian Blaise');

		// Nothing is out of step now, and Prep shows Lucian Blaise waiting for its new sheet.
		const again = await checkDrift(deps, project);
		if (!again.ok) throw new Error(again.message);
		expect(again.report.items).toEqual([]);

		// The first send under the new name gets its own code.
		const begun: string[] = [];
		const uploader = {
			changes: async () => ({ cursor: '1', assets: [], versions: [{ versionId: 'v-new', assetId: 'a-new', version: 1, isCurrent: true, processingState: 'ready', mimeType: 'image/png', createdAt: 1 }], removedAssets: [] }),
			beginUpload: async (input: { assetCode: string }) => { begun.push(input.assetCode); return { sessionId: 's', url: 'u', posterUrl: 'p', assetId: 'a-new' }; },
			putSigned: async () => {}, completeUpload: async () => ({ assetId: 'a-new', jobId: 'j' }), putMetadata: async () => {}, setCurrentVersion: async () => {}
		} as unknown as ReviewRoomClient;
		const sent = await uploadReference({ client: uploader, store: series, cacheDir: join(root, 'cache'), sourceDir: join(root, 'sources'), probe: async () => ({ width: 2048, height: 1152 }), poster: async (_input, output) => { await writeFile(output, 'jpg'); } }, 'ser1', { page_id: 'rlucian', file_name: 'Lucian Blaise.png', bytes: new Uint8Array([1]) });
		expect(sent.ok).toBe(true);
		expect(begun).toEqual(['BLR_REF_CHR_LUCIAN_BLAISE']);
	});

	test('when Review Room refuses the mark, the reference keeps its sheet and nothing is old', async () => {
		const notion = fakeNotion();
		const room = fakeReviewRoom({ failWrite: new ReviewRoomError(409, 'Metadata changed since your read') });
		const { deps, project, series } = await setup(notion.api, room.client);
		const answered = await answerRename(deps, project, { page_id: 'rlucian', choice: 'new_reference' });
		expect(answered).toMatchObject({ ok: false, status: 409 });
		expect((await series.read('ser1'))!.reference_files?.rlucian).toEqual(lucianFile);
		expect(notion.updates).toEqual([]);
	});

	test('a reference that is not renamed is refused, so only what the check showed can be answered', async () => {
		const notion = fakeNotion({ names: { 'r-lucian': 'Lucian Vale' } });
		const room = fakeReviewRoom();
		const { deps, project } = await setup(notion.api, room.client);
		for (const choice of ['restore_name', 'new_reference'] as const) {
			expect(await answerRename(deps, project, { page_id: 'rlucian', choice })).toMatchObject({ ok: false, status: 409 });
		}
		expect(notion.updates).toEqual([]);
		expect(room.calls.filter((call) => call.startsWith('putMetadata'))).toEqual([]);
	});
});
