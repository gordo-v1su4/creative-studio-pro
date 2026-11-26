import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { SeriesStore, type SeriesRecord } from '../../src/lib/server/series';
import type { NotionApi } from '../../src/lib/server/notion';
import type { ChangeFeed, ReviewRoomClient } from '../../src/lib/server/review-room';
import type { NotionPage } from '../../src/lib/domain/notion-series';
import { checkDrift } from '../../src/lib/server/drift';
import { markedOld } from '../../src/lib/domain/drift';

/**
 * Drift 03 (GitHub #32 / V1S-510, ADR 0012): the check reads Notion's References, every series project's Prep and
 * Review Room's reference folders, and writes nothing. Notion and Review Room are faked and log every call.
 */

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const check = { ok: true, missing: [], wrongType: [], optionalMissing: [] };
const refPage = (id: string, name: string, kind: string): NotionPage => ({
	id, properties: { Name: { type: 'title', title: [{ plain_text: name }] }, Kind: { type: 'select', select: { name: kind } } } as NotionPage['properties']
});

function fakeNotion(fail?: Error) {
	const calls: string[] = [];
	const pages = [refPage('r-mara', 'Mara Voss', 'Character'), refPage('r-bryson', 'Bryson Vane', 'Character')];
	const log = (name: string) => async () => { calls.push(name); throw new Error(`${name} must not be called by a check`); };
	const api = {
		query: async (source: string) => { calls.push(`query ${source}`); if (fail) throw fail; return { results: source === 'src-refs' ? pages : [], next_cursor: null, has_more: false }; },
		createPage: log('create'), updatePage: log('update'), trashPage: log('trash')
	} as unknown as NotionApi;
	return { api, calls };
}

const asset = (assetId: string, folderId: string, assetCode: string | null): ChangeFeed['assets'][number] => ({ assetId, folderId, assetCode, title: assetCode ?? 'drop.png', currentVersionId: `v-${assetId}`, misfiled: false, copiedFromAssetId: null, updatedAt: 1 });
function fakeReviewRoom(options: { old?: string[]; failMetadata?: Error } = {}) {
	const calls: string[] = [];
	const feed: ChangeFeed = {
		cursor: '99',
		assets: [
			asset('a-mara', 'f-chr', 'BLR_REF_CHR_MARA_VOSS'), asset('a-bryson', 'f-chr', 'BLR_REF_CHR_BRYSON'),
			asset('a-gone', 'f-prp', 'BLR_REF_PRP_GONE'), asset('a-shot', 'f-scene', 'BLR_101_010_PAR_010')
		],
		versions: [], removedAssets: [{ assetId: 'a-gone', mergedIntoAssetId: null, reason: 'deleted' }]
	};
	const client = new Proxy({}, {
		get: (_, name: string) => name === 'changes'
			? async (projectId: string, since: string) => { calls.push(`changes ${projectId} ${since}`); return feed; }
			// Drift 04: the check reads each reference sheet's current version metadata, to skip the ones marked old.
			: name === 'versionMetadata'
				? async (versionId: string) => {
					calls.push(`versionMetadata ${versionId}`);
					if (options.failMetadata) throw options.failMetadata;
					const metadata = { model: '', prompt: '', sourceLabel: '', referenceImageVersionIds: [] };
					return { metadata: options.old?.includes(versionId) ? markedOld(metadata, null) : metadata, updatedAt: 1 };
				}
				: async () => { calls.push(name); throw new Error(`${name} must not be called by a check`); }
	}) as ReviewRoomClient;
	return { client, calls };
}

async function importInto(gateway: ProjectCommandGateway, title: string, episode: string, location: string) {
	const created = await gateway.createProject({ command: 'create_project', title, brief: '', creative_focus: 'full room', created_by: 'test' });
	if (!created.ok) throw new Error(created.error.message);
	const imported = await gateway.importEpisode(created.data.project_id, created.data.version, {
		series: { series_id: 'ser1', episode_page_id: episode, episode_number: 1, season: 1, episode_title: title, summary: '', twist: '', cliffhanger: '', imported_at: '2026-11-25T00:00:00.000Z', outline: '',
			scenes: [{ page_id: `s-${episode}`, number: 10, title: 'Scene', act: 'Act 1', summary: '', story_beats: '', dialogue: '', timecode: '', location, characters: ['Mara'], group_id: 'g1', reference_ids: [], story_beat_ids: [], seconds: 0, shot_count: 0 }] },
		groups: [{ group_id: 'g1', name: 'Scene', created_at: '2026-11-25T00:00:00.000Z' }], cards: [], title, logline: ''
	});
	if (!imported.ok) throw new Error(imported.error.message);
	return created.data.project_id;
}

async function setup(notion: NotionApi | null, client: ReviewRoomClient | null) {
	const root = await mkdtemp(join(tmpdir(), 'csp-drift-check-')); roots.push(root);
	const projectRoot = join(root, 'projects');
	const store = new ProjectStore({ root: projectRoot });
	const gateway = new ProjectCommandGateway(store);
	const series = new SeriesStore(join(root, 'series'));
	const pilot = await importInto(gateway, 'TR110', 'ep1', 'Video Haven');
	const other = await importInto(gateway, 'TR130', 'ep2', 'Video Haven');
	await importInto(gateway, 'Elsewhere', 'ep9', 'Pool');
	// The third project belongs to another series: its Prep is not this series' drift.
	const elsewhere = (await store.listProjects()).find((summary) => summary.title === 'Elsewhere')!;
	const raw = (await store.readProject(elsewhere.project_id))!;
	await store.updateProject(raw.project_id, raw.version, (project) => ({ ...project, series: { ...project.series!, series_id: 'ser2' } }));
	await writeFile(join(projectRoot, pilot, 'prep.json'), JSON.stringify({ schema_version: 1, props: [], entries: { 'location:Mara’s dorm room': { prompt: 'p' }, "location:Mara's dorm room": { prompt: 'p' } } }));
	await writeFile(join(projectRoot, other, 'prep.json'), JSON.stringify({ schema_version: 1, props: ['The Rush'], entries: {} }));
	const record: SeriesRecord = {
		schema_version: 1, series_id: 'ser1', title: 'Blood Rush', notion_root_id: 'ser1',
		sources: { episodes: 'src-ep', scenes: 'src-sc', shots: 'src-sh' }, checks: { episodes: check, scenes: check, shots: check }, story: null,
		episodes: [{ page_id: 'ep1', number: 1, title: 'TR110', status: '', act: '', season: 1, summary: '', twist: '', cliffhanger: '', scene_ids: ['s-ep1'], scene_count: 1 }],
		references: { database: 'db-refs', source: 'src-refs', check, items: [{ page_id: 'r-mara', name: 'Mara Voss', kind: 'Character', role: '', handles: [], file_name: '', name_on_sheet: false, scene_ids: [] }] },
		runtime_min: 10, episode_projects: { ep1: pilot, ep2: other }, show_code: 'BLR',
		review_room: { project_id: 'rr1', folders: { 'refs:characters': 'f-chr', 'refs:locations': 'f-loc', 'refs:props': 'f-prp', 'scene:s-ep1': 'f-scene' }, synced_at: null },
		checked_at: '2026-11-25T00:00:00.000Z', created_at: '2026-11-25T00:00:00.000Z'
	};
	await series.write(record);
	return { deps: { store, projectRoot, series, notion, client }, project: (await store.readProject(pilot))!, root };
}

/** Every file under the test root with its contents: a check must leave them all as they were. */
async function snapshot(root: string): Promise<Record<string, string>> {
	const files: Record<string, string> = {};
	for (const name of await readdir(root, { recursive: true, withFileTypes: true })) {
		if (name.isFile()) files[join(name.parentPath, name.name)] = await readFile(join(name.parentPath, name.name), 'utf8');
	}
	return files;
}

describe('the drift check (Drift 03)', () => {
	test('reads Notion, every series project\'s Prep and the reference folders, and writes nothing', async () => {
		const notion = fakeNotion();
		const room = fakeReviewRoom();
		const { deps, project, root } = await setup(notion.api, room.client);
		const before = await snapshot(root);
		const checked = await checkDrift(deps, project);
		if (!checked.ok) throw new Error(checked.message);
		expect(notion.calls).toEqual(['query src-refs']);
		expect(room.calls).toEqual(['changes rr1 0', 'versionMetadata v-a-mara', 'versionMetadata v-a-bryson']);
		expect(await snapshot(root)).toEqual(before);

		const { report } = checked;
		expect(report.read).toEqual({ notion: 2, projects: [{ project_id: project.project_id, title: 'TR110' }, expect.objectContaining({ title: 'TR130' })], sheets: 2, skipped: [] });
		const byName = Object.fromEntries(report.items.map((item) => [item.name, item]));
		// Bryson's sheet against Bryson Vane in Notion; Bryson Vane's own missing sheet is not drift.
		expect(byName.Bryson).toMatchObject({ type: 'only_in_review_room', link_to: { page_id: 'rbryson', name: 'Bryson Vane' }, choices: ['link', 'mark_old'] });
		// Found in both projects' Prep (named by their scenes), one item.
		expect(byName['Video Haven'].found.prep.map((found) => found.project_title)).toEqual(['TR110', 'TR130']);
		// Two spellings kept in TR110's Prep file are one item.
		expect(byName["Mara's dorm room"].spellings).toEqual(['Mara’s dorm room', "Mara's dorm room"]);
		expect(byName['The Rush']).toMatchObject({ kind: 'prop', found: { prep: [expect.objectContaining({ project_title: 'TR130' })] } });
		// A removed asset, a shot in a scene folder and the other series' Prep are not part of it.
		expect(report.items.map((item) => item.name).toSorted()).toEqual(['Bryson', "Mara's dorm room", 'The Rush', 'Video Haven']);
	});

	test('skips a sheet marked old in Review Room, so settled drift never comes back (Drift 04)', async () => {
		const { deps, project } = await setup(fakeNotion().api, fakeReviewRoom({ old: ['v-a-bryson'] }).client);
		const checked = await checkDrift(deps, project);
		if (!checked.ok) throw new Error(checked.message);
		expect(checked.report.items.map((item) => item.name)).not.toContain('Bryson');
		expect(checked.report.read.sheets).toBe(2);
	});

	test('says why when a sheet\'s metadata cannot be read, and writes nothing (Drift 04)', async () => {
		const { deps, project, root } = await setup(fakeNotion().api, fakeReviewRoom({ failMetadata: new Error('Version unavailable') }).client);
		const before = await snapshot(root);
		const checked = await checkDrift(deps, project);
		expect(checked).toMatchObject({ ok: false, status: 502 });
		if (!checked.ok) expect(checked.message).toContain('Version unavailable');
		expect(await snapshot(root)).toEqual(before);
	});

	test('without Review Room configured it compares Notion and Prep and says the sheets were not read', async () => {
		const { deps, project } = await setup(fakeNotion().api, null);
		const checked = await checkDrift(deps, project);
		if (!checked.ok) throw new Error(checked.message);
		expect(checked.report.read.sheets).toBeNull();
		expect(checked.report.items.some((item) => item.found.review_room)).toBeFalse();
	});

	test('says why when Notion is missing or cannot be read, and writes nothing', async () => {
		const none = await setup(null, fakeReviewRoom().client);
		expect(await checkDrift(none.deps, none.project)).toMatchObject({ ok: false, status: 503 });
		const notion = fakeNotion(new Error('Request to Notion API has timed out'));
		const room = fakeReviewRoom();
		const { deps, project, root } = await setup(notion.api, room.client);
		const before = await snapshot(root);
		const checked = await checkDrift(deps, project);
		expect(checked).toMatchObject({ ok: false, status: 502 });
		if (!checked.ok) expect(checked.message).toContain('timed out');
		expect(room.calls).toEqual([]);
		expect(await snapshot(root)).toEqual(before);
	});
});
