import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { SeriesStore, type SeriesRecord } from '../../src/lib/server/series';
import { checkDrift } from '../../src/lib/server/drift';
import type { NotionApi } from '../../src/lib/server/notion';
import type { NotionPage } from '../../src/lib/domain/notion-series';

/**
 * Drift 08 (GitHub #36 / V1S-512, ADR 0012): the drift check reads each Prep sheet's size, and one under 2048 px is
 * its own item offering only Remake: a small sheet is rendered new in Prep at 2K (GitHub #43 / V1S-521). Remake
 * opens Prep and writes nothing; the check itself only reads.
 */

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const check = { ok: true, missing: [], wrongType: [], optionalMissing: [] };

/** TR110 with two small Prep sheets: Campus gym (in Notion) and Portland rooftops (not yet). */
async function setup() {
	const root = await mkdtemp(join(tmpdir(), 'csp-drift-picture-')); roots.push(root);
	const projectRoot = join(root, 'projects');
	const store = new ProjectStore({ root: projectRoot });
	const gateway = new ProjectCommandGateway(store);
	const series = new SeriesStore(join(root, 'series'));
	const created = await gateway.createProject({ command: 'create_project', title: 'TR110', brief: '', creative_focus: 'full room', created_by: 'test' });
	if (!created.ok) throw new Error(created.error.message);
	const id = created.data.project_id;
	const scene = (n: number, location: string) => ({ page_id: `s-${n}`, number: n, title: 'Scene', act: 'Act 1', summary: '', story_beats: '', dialogue: '', timecode: '', location, characters: [], group_id: 'g1', reference_ids: [], story_beat_ids: [], seconds: 0, shot_count: 0 });
	const imported = await gateway.importEpisode(id, created.data.version, {
		series: { series_id: 'ser1', episode_page_id: 'ep1', episode_number: 1, season: 1, episode_title: 'TR110', summary: '', twist: '', cliffhanger: '', imported_at: '2026-11-25T00:00:00.000Z', outline: '', scenes: [scene(10, 'Campus gym'), scene(20, 'Portland rooftops')] },
		groups: [{ group_id: 'g1', name: 'Scene', created_at: '2026-11-25T00:00:00.000Z' }], cards: [], title: 'TR110', logline: ''
	});
	if (!imported.ok) throw new Error(imported.error.message);
	const made = join(projectRoot, id, 'files', 'prep', 'references');
	await mkdir(made, { recursive: true });
	await writeFile(join(made, 'Campus_gym_sheet.png'), 'small gym');
	await writeFile(join(made, 'Portland_rooftops_sheet.png'), 'small roofs');
	const result = (file: string) => ({ file: `files/prep/references/${file}`, url: `/api/projects/${id}/files/prep/references/${file}`, made_at: '2026-11-20T00:00:00.000Z', outside: false, uploaded: false, note: 'The image is 1678×937; references must be at least 2048 px on the long edge' });
	await writeFile(join(projectRoot, id, 'prep.json'), JSON.stringify({ schema_version: 1, props: [], entries: { 'rgym': { result: result('Campus_gym_sheet.png') }, 'location:Portland rooftops': { result: result('Portland_rooftops_sheet.png') } } }));
	const record: SeriesRecord = {
		schema_version: 1, series_id: 'ser1', title: 'Blood Rush', notion_root_id: 'ser1',
		sources: { episodes: 'src-ep', scenes: 'src-sc', shots: 'src-sh' }, checks: { episodes: check, scenes: check, shots: check }, story: null,
		episodes: [{ page_id: 'ep1', number: 1, title: 'TR110', status: '', act: '', season: 1, summary: '', twist: '', cliffhanger: '', scene_ids: ['s-10', 's-20'], scene_count: 2 }],
		references: { database: 'db-refs', source: 'src-refs', check, items: [{ page_id: 'rgym', name: 'Campus gym', kind: 'Location', role: '', handles: [], file_name: '', name_on_sheet: false, scene_ids: [] }] },
		runtime_min: 10, episode_projects: { ep1: id }, show_code: 'BLR',
		review_room: { project_id: 'rr1', folders: { 'refs:characters': 'f-chr', 'refs:locations': 'f-loc', 'refs:props': 'f-prp' }, synced_at: null },
		checked_at: '2026-11-25T00:00:00.000Z', created_at: '2026-11-25T00:00:00.000Z'
	};
	await series.write(record);
	const sizes: Record<string, { width: number; height: number }> = { 'Campus_gym_sheet.png': { width: 1678, height: 937 }, 'Portland_rooftops_sheet.png': { width: 1344, height: 752 } };
	const probe = async (file: string) => sizes[file.split('/').at(-1)!] ?? { width: 2048, height: 1144 };
	const deps = { store, gateway, projectRoot, series, probe };
	const project = async () => (await store.readProject(id))!;
	return { deps, project, id, projectRoot };
}

describe('the drift check reads each Prep sheet\'s size', () => {
	test('a small sheet not yet in Review Room is a picture item offering only remake; the check still writes nothing', async () => {
		const { deps, project, projectRoot, id } = await setup();
		const page = (pid: string, name: string): NotionPage => ({ id: pid, properties: { Name: { type: 'title', title: [{ plain_text: name }] }, Kind: { type: 'select', select: { name: 'Location' } } } as NotionPage['properties'] });
		const notion = { query: async () => ({ results: [page('rgym', 'Campus gym')], next_cursor: null, has_more: false }) } as unknown as NotionApi;
		const before = await readFile(join(projectRoot, id, 'prep.json'), 'utf8');
		const checked = await checkDrift({ ...deps, notion, client: null }, await project());
		if (!checked.ok) throw new Error(checked.message);
		const pictures = checked.report.items.filter((item) => item.type === 'picture_too_small');
		expect(pictures.map((item) => [item.name, item.picture?.width, item.picture?.height, item.picture?.reference_page_id])).toEqual([['Campus gym', 1678, 937, 'rgym'], ['Portland rooftops', 1344, 752, null]]);
		expect(pictures.map((item) => item.choices)).toEqual([['remake'], ['remake']]);
		expect(await readFile(join(projectRoot, id, 'prep.json'), 'utf8')).toBe(before);
	});

	test('a reference the series already has a Review Room sheet for gives no picture item, even with Review Room not read', async () => {
		const { deps, project } = await setup();
		await deps.series.update('ser1', (record) => ({ ...record, reference_files: { rgym: { asset_id: 'a', version_id: 'v', version: 1, code: 'BLR_REF_LOC_CAMPUS_GYM', file_name: 'Campus_gym_sheet.png', mime_type: 'image/png', width: 2048, height: 1144, uploaded_at: '2026-11-01T00:00:00.000Z' } } }));
		const page = (pid: string, name: string): NotionPage => ({ id: pid, properties: { Name: { type: 'title', title: [{ plain_text: name }] }, Kind: { type: 'select', select: { name: 'Location' } } } as NotionPage['properties'] });
		const notion = { query: async () => ({ results: [page('rgym', 'Campus gym')], next_cursor: null, has_more: false }) } as unknown as NotionApi;
		const checked = await checkDrift({ ...deps, notion, client: null }, await project());
		if (!checked.ok) throw new Error(checked.message);
		expect(checked.report.items.filter((item) => item.type === 'picture_too_small').map((item) => item.name)).toEqual(['Portland rooftops']);
	});
});
