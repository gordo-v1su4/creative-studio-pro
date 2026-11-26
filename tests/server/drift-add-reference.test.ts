import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { SeriesStore, type SeriesRecord } from '../../src/lib/server/series';
import type { NotionApi } from '../../src/lib/server/notion';
import type { NotionPage } from '../../src/lib/domain/notion-series';
import { readPrep, prepView } from '../../src/lib/server/prep';
import { addReference } from '../../src/lib/server/drift';

/**
 * Drift 02 (GitHub #30, V1S-508; ADR 0012): adding a reference in Prep writes its Notion References page first,
 * re-reads the series, then adds the Prep entry linked to that page. Notion is faked; nothing real is touched.
 */

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const check = { ok: true, missing: [], wrongType: [], optionalMissing: [] };
const refPage = (id: string, name: string, kind: string, handles = '', scenes: string[] = []): NotionPage => ({
	id,
	properties: {
		Name: { type: 'title', title: [{ plain_text: name }] },
		Kind: { type: 'select', select: { name: kind } },
		Handles: { type: 'rich_text', rich_text: handles ? [{ plain_text: handles }] : [] },
		Scenes: { type: 'relation', relation: scenes.map((scene) => ({ id: scene })) }
	} as NotionPage['properties']
});

/** A fake Notion that logs every call in order. `pages` is what References holds (and gains on create). */
function fakeNotion(options: { failCreate?: Error; failQuery?: Error } = {}) {
	const calls: string[] = [];
	const creates: Array<[string, Record<string, unknown>]> = [];
	const pages: NotionPage[] = [refPage('r-mara', 'Mara Voss', 'Character', '@Mara', ['s1'])];
	const api = {
		query: async (source: string) => {
			calls.push(`query ${source}`);
			if (options.failQuery) throw options.failQuery;
			return { results: source === 'src-refs' ? pages : [], next_cursor: null, has_more: false };
		},
		createPage: async (source: string, props: Record<string, unknown>) => {
			calls.push(`create ${source}`);
			if (options.failCreate) throw options.failCreate;
			creates.push([source, props]);
			const id = `new-${creates.length}`;
			const p = props as { Name: { title: Array<{ text: { content: string } }> }; Kind: { select: { name: string } } };
			pages.push(refPage(id, p.Name.title[0].text.content, p.Kind.select.name));
			return { id };
		},
		updatePage: async () => { calls.push('update'); },
		trashPage: async () => { calls.push('trash'); }
	} as unknown as NotionApi;
	return { api, calls, creates };
}

async function setup(notion: NotionApi | null) {
	const root = await mkdtemp(join(tmpdir(), 'csp-drift-add-')); roots.push(root);
	const projectRoot = join(root, 'projects');
	const store = new ProjectStore({ root: projectRoot });
	const gateway = new ProjectCommandGateway(store);
	const series = new SeriesStore(join(root, 'series'));
	const created = await gateway.createProject({ command: 'create_project', title: 'Pilot', brief: '', creative_focus: 'full room', created_by: 'test' });
	if (!created.ok) throw new Error(created.error.message);
	const imported = await gateway.importEpisode(created.data.project_id, created.data.version, {
		series: { series_id: 'ser1', episode_page_id: 'ep1', episode_number: 1, season: 1, episode_title: 'Pilot', summary: '', twist: '', cliffhanger: '', imported_at: '2026-11-25T00:00:00.000Z', outline: '',
			scenes: [
				{ page_id: 's1', number: 10, title: 'Dorm', act: 'Act 1', summary: '', story_beats: '', dialogue: '', timecode: '', location: "Mara's dorm room", characters: ['Mara'], group_id: 'g1', reference_ids: [], story_beat_ids: [], seconds: 0, shot_count: 0 },
				{ page_id: 's2', number: 20, title: 'Video store', act: 'Act 1', summary: '', story_beats: '', dialogue: '', timecode: '', location: 'Video Haven', characters: ['Mara'], group_id: 'g1', reference_ids: [], story_beat_ids: [], seconds: 0, shot_count: 0 }
			] },
		groups: [{ group_id: 'g1', name: 'Dorm', created_at: '2026-11-25T00:00:00.000Z' }], cards: [], title: 'Pilot', logline: ''
	});
	if (!imported.ok) throw new Error(imported.error.message);
	const record: SeriesRecord = {
		schema_version: 1, series_id: 'ser1', title: 'Blood Rush', notion_root_id: 'ser1',
		sources: { episodes: 'src-ep', scenes: 'src-sc', shots: 'src-sh' }, checks: { episodes: check, scenes: check, shots: check }, story: null,
		episodes: [{ page_id: 'ep1', number: 1, title: 'Pilot', status: '', act: '', season: 1, summary: '', twist: '', cliffhanger: '', scene_ids: ['s1', 's2'], scene_count: 2 }],
		references: { database: 'db-refs', source: 'src-refs', check, items: [{ page_id: 'r-mara', name: 'Mara Voss', kind: 'Character', role: '', handles: ['@Mara'], file_name: '', name_on_sheet: false, scene_ids: ['s1'] }] },
		runtime_min: 10, episode_projects: { ep1: created.data.project_id }, notion_trash: ['keep-me'],
		checked_at: '2026-11-25T00:00:00.000Z', created_at: '2026-11-25T00:00:00.000Z'
	};
	await series.write(record);
	const project = (await store.readProject(created.data.project_id))!;
	return { deps: { store, projectRoot, series, notion }, project, series };
}

describe('adding a reference writes Notion first (Drift 02)', () => {
	test('writes the References page, re-reads the series, then adds the Prep entry with the new page id', async () => {
		const fake = fakeNotion();
		const { deps, project, series } = await setup(fake.api);
		const added = await addReference(deps, project, { kind: 'location', name: 'Campus gym' });
		if (!added.ok) throw new Error(added.message);
		expect(added.page_id).toBe('new1');
		// Read References (for the duplicate check), create, read again: Notion first, nothing else written there.
		expect(fake.calls).toEqual(['query src-refs', 'create src-refs', 'query src-refs']);
		const record = (await series.read('ser1'))!;
		expect(record.references!.items.find((item) => item.page_id === 'new1')).toMatchObject({ name: 'Campus gym', kind: 'Location' });
		expect(record.notion_trash).toEqual(['keep-me']);
		const prep = await readPrep(deps.projectRoot, project.project_id);
		expect(prep.custom_entries).toEqual([{ kind: 'location', name: 'Campus gym', reference_page_id: 'new1' }]);
		const view = await prepView(deps, project);
		if (!view.ok) throw new Error(view.message);
		expect(view.items.find((item) => item.entry.name === 'Campus gym')!.entry).toMatchObject({ key: 'new1', reference_page_id: 'new1' });
	});

	test('writes only Name, Kind and Handles; the scene link when added from a scene', async () => {
		const fake = fakeNotion();
		const { deps, project } = await setup(fake.api);
		const plain = await addReference(deps, project, { kind: 'prop', name: 'Red vial' });
		expect(plain.ok).toBeTrue();
		expect(fake.creates[0]).toEqual(['src-refs', {
			Name: { title: [{ type: 'text', text: { content: 'Red vial' } }] },
			Kind: { select: { name: 'Prop' } }
		}]);
		const found = await addReference(deps, project, { kind: 'location', name: 'Video Haven', handle: 'Haven', scene_ids: ['s2'] });
		if (!found.ok) throw new Error(found.message);
		expect(fake.creates[1]).toEqual(['src-refs', {
			Name: { title: [{ type: 'text', text: { content: 'Video Haven' } }] },
			Kind: { select: { name: 'Location' } },
			Handles: { rich_text: [{ type: 'text', text: { content: '@Haven' } }] },
			Scenes: { relation: [{ id: 's2' }] }
		}]);
		const view = await prepView(deps, project);
		if (!view.ok) throw new Error(view.message);
		const haven = view.items.filter((item) => item.entry.name === 'Video Haven');
		expect(haven).toHaveLength(1);
		expect(haven[0].entry).toMatchObject({ key: found.page_id, reference_page_id: found.page_id });
	});

	test('a found-in-the-story entry keeps its Prep work under the new page id', async () => {
		const fake = fakeNotion();
		const { deps, project } = await setup(fake.api);
		const { writeFile } = await import('node:fs/promises');
		await writeFile(join(deps.projectRoot, project.project_id, 'prep.json'), JSON.stringify({ schema_version: 1, props: [], entries: { "location:Video Haven's": { prompt: 'kept prompt' } } }));
		const added = await addReference(deps, project, { kind: 'location', name: 'Video Havens', scene_ids: ['s2'] });
		if (!added.ok) throw new Error(added.message);
		const prep = await readPrep(deps.projectRoot, project.project_id);
		expect(prep.entries[added.page_id].prompt).toBe('kept prompt');
		expect(prep.entries["location:Video Haven's"]).toBeUndefined();
	});

	test('a Notion failure adds nothing anywhere and says why', async () => {
		for (const failure of [{ failCreate: new Error('Request to Notion API has timed out') }, { failQuery: new Error('Could not find database') }]) {
			const fake = fakeNotion(failure);
			const { deps, project, series } = await setup(fake.api);
			const before = await series.read('ser1');
			const added = await addReference(deps, project, { kind: 'character', name: 'Bryson Vane' });
			expect(added).toMatchObject({ ok: false, status: 502 });
			if (!added.ok) expect(added.message).toContain('Nothing was added');
			expect(await series.read('ser1')).toEqual(before);
			expect((await readPrep(deps.projectRoot, project.project_id)).custom_entries ?? []).toEqual([]);
			expect(fake.creates).toEqual([]);
		}
	});

	test('refuses a name already used by a reference of the same kind, and a handle already taken', async () => {
		const fake = fakeNotion();
		const { deps, project } = await setup(fake.api);
		expect(await addReference(deps, project, { kind: 'character', name: 'mara  voss' })).toMatchObject({ ok: false, status: 409 });
		expect(await addReference(deps, project, { kind: 'character', name: 'Kai Santana', handle: '@mara' })).toMatchObject({ ok: false, status: 409 });
		expect(fake.creates).toEqual([]);
		// The same name as another kind is a different reference.
		expect((await addReference(deps, project, { kind: 'prop', name: 'Mara Voss' })).ok).toBeTrue();
	});

	test('refuses without Notion, without a References database, or with a scene outside the series', async () => {
		const none = await setup(null);
		expect(await addReference(none.deps, none.project, { kind: 'prop', name: 'Red vial' })).toMatchObject({ ok: false, status: 503 });
		const fake = fakeNotion();
		const { deps, project, series } = await setup(fake.api);
		expect(await addReference(deps, project, { kind: 'prop', name: 'Red vial', scene_ids: ['elsewhere'] })).toMatchObject({ ok: false, status: 400 });
		expect(await addReference(deps, project, { kind: 'prop', name: 'Red vial', handle: '@ bad' })).toMatchObject({ ok: false, status: 400 });
		expect(await addReference(deps, project, { kind: 'prop', name: 'Red vial', handle: '@Image_1' })).toMatchObject({ ok: false, status: 400 });
		await series.update('ser1', (record) => ({ ...record, references: { ...record.references!, check: { ...check, optionalMissing: ['Handles', 'Scenes'] } } }));
		expect(await addReference(deps, project, { kind: 'prop', name: 'Red vial', handle: '@Vial' })).toMatchObject({ ok: false, status: 409 });
		expect(await addReference(deps, project, { kind: 'prop', name: 'Red vial', scene_ids: ['s1'] })).toMatchObject({ ok: false, status: 409 });
		await series.update('ser1', (record) => ({ ...record, references: undefined }));
		expect(await addReference(deps, project, { kind: 'prop', name: 'Red vial' })).toMatchObject({ ok: false, status: 409 });
		expect(fake.calls).toEqual([]);
	});
});

describe('adding a drift item under a settled name (Drift 03)', () => {
	test('its Prep work and its earlier spelling move to the new page when the name was changed', async () => {
		const fake = fakeNotion();
		const { deps, project } = await setup(fake.api);
		const { writeFile } = await import('node:fs/promises');
		await writeFile(join(deps.projectRoot, project.project_id, 'prep.json'), JSON.stringify({ schema_version: 1, props: [], custom_entries: [{ kind: 'location', name: 'Kai rooftop run - sunset' }], entries: { 'location:Kai rooftop run - sunset': { prompt: 'kept prompt' } } }));
		const added = await addReference(deps, project, { kind: 'location', name: 'Rooftop at sunset', former_names: ['Kai rooftop run - sunset'] });
		if (!added.ok) throw new Error(added.message);
		const prep = await readPrep(deps.projectRoot, project.project_id);
		expect(prep.entries[added.page_id].prompt).toBe('kept prompt');
		expect(prep.entries['location:Kai rooftop run - sunset']).toBeUndefined();
		expect(prep.custom_entries).toEqual([{ kind: 'location', name: 'Rooftop at sunset', reference_page_id: added.page_id }]);
	});
});
