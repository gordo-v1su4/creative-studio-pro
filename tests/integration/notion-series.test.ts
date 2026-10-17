import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { pageIdOf, type NotionApi } from '../../src/lib/server/notion';
import { connectSeries, importEpisode, SeriesStore } from '../../src/lib/server/series';
import type { NotionPage } from '../../src/lib/domain/notion-series';
import { pullTakes, pushTake } from '../../src/lib/server/review-room-takes';
import type { ReviewRoomClient } from '../../src/lib/server/review-room';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const t = (value: string) => [{ plain_text: value }];
const title = (value: string) => ({ type: 'title', title: t(value) });
const rich = (value: string) => ({ type: 'rich_text', rich_text: t(value) });
const num = (value: number) => ({ type: 'number', number: value });
const rel = (...ids: string[]) => ({ type: 'relation', relation: ids.map((id) => ({ id })) });
const schema = (props: Record<string, string>) => Object.fromEntries(Object.entries(props).map(([name, type]) => [name, { type }]));

const ROOT = '3d88a006-7650-81d3-aa63-cb0f9c1a4ca0';
const EP1 = '11111111-0000-0000-0000-000000000001';
const S1 = '22222222-0000-0000-0000-000000000001', S2 = '22222222-0000-0000-0000-000000000002';

/** A fake Notion shaped like the Blood Rush series root. */
function fakeNotion(v2 = false): NotionApi & { reads: string[]; writes: Array<{ op: string; id: string; properties: Record<string, unknown> }>; rows: Record<string, NotionPage[]> } {
	const reads: string[] = [];
	const writes: Array<{ op: string; id: string; properties: Record<string, unknown> }> = [];
	const children: Record<string, unknown[]> = {
		[ROOT]: [
			{ id: 'story-page', type: 'child_page', child_page: { title: 'Blood Rush — Season 1 Story (v2)' } },
			{ id: 'db-episodes', type: 'child_database', child_database: { title: 'Episodes' } },
			{ id: 'raw-page', type: 'child_page', child_page: { title: 'Databases (raw)' } }
		],
		'raw-page': [{ id: 'db-scenes', type: 'child_database', child_database: { title: 'Scenes' } }, { id: 'db-shots', type: 'child_database', child_database: { title: 'Shots' } }, ...(v2 ? [{ id: 'db-beats', type: 'child_database', child_database: { title: 'Story Beats' } }] : [])],
		'story-page': [{ id: 'h', type: 'heading_1', heading_1: { rich_text: t('Logline') } }, { id: 'p', type: 'paragraph', paragraph: { rich_text: t('In fall 2001, Kai keeps a hidden crew…') } }]
	};
	const sources: Record<string, { title: string; properties: Record<string, { type: string }> }> = {
		'ds-episodes': { title: 'Episodes', properties: schema({ Title: 'title', 'Episode #': 'number', Summary: 'rich_text', Scenes: 'relation', Status: 'select', Act: 'select' }) },
		'ds-scenes': { title: 'Scenes', properties: schema({ Scene: 'title', 'Scene #': 'number', Episode: 'relation', Summary: 'rich_text', Timecode: 'rich_text', Location: 'rich_text', ...(v2 ? { Section: 'select' } : {}) }) },
		'ds-beats': { title: 'Story Beats', properties: schema({ Beat: 'title', Section: 'select', Order: 'number', Summary: 'rich_text', Scenes: 'relation' }) },
		'ds-shots': { title: 'Shots', properties: schema({ Shot: 'title', Scene: 'relation', Description: 'rich_text', 'Duration (s)': 'number', 'Video Prompt (Seedance 2.5)': 'rich_text', 'Shot #': 'number', 'Dialogue / VO': 'rich_text' }) }
	};
	const rows: Record<string, NotionPage[]> = {
		'ds-episodes': [{ id: EP1, properties: { Title: title('EP01 — The Late Shift'), 'Episode #': num(1), Summary: rich('Kai breaks blood law.'), Scenes: rel(S1, S2), Status: { type: 'select', select: { name: 'Shot List' } } } } as unknown as NotionPage],
		'ds-scenes': [
			{ id: S2, properties: { Scene: title('P02 — Morning Quad'), 'Scene #': num(2), Episode: rel(EP1), Summary: rich('Day quad.'), Timecode: rich('Act 1 · ~1:30'), Location: rich('College quad'), ...(v2 ? { Section: { type: 'select', select: { name: 'Act 2' } } } : {}) } },
			{ id: S1, properties: { Scene: title('P01 — 2:47 AM (Teaser)'), 'Scene #': num(1), Episode: rel(EP1), Summary: rich('The aftermath.'), Timecode: rich('0:00–2:00 (Teaser)'), Location: rich('Video Haven') } }
		] as unknown as NotionPage[],
		'ds-shots': [
			{ id: 'sh-2', properties: { Shot: title('E01 S01 SH02'), 'Shot #': num(2), Scene: rel(S1), Description: rich('Kai drinks the red vial.'), 'Duration (s)': num(5), 'Video Prompt (Seedance 2.5)': rich('Video prompt 2'), 'Dialogue / VO': rich('') } },
			{ id: 'sh-1', properties: { Shot: title('E01 S01 SH01'), 'Shot #': num(1), Scene: rel(S1), Description: rich('Mara on the floor, crying black.'), 'Duration (s)': num(6), 'Video Prompt (Seedance 2.5)': rich('Video prompt 1'), 'Dialogue / VO': rich('"36 hours earlier."') } },
			{ id: 'sh-3', properties: { Shot: title('E01 S02 SH01'), 'Shot #': num(1), Scene: rel(S2), Description: rich('Kai crosses the quad.'), 'Duration (s)': num(4), 'Video Prompt (Seedance 2.5)': rich(''), 'Dialogue / VO': rich('') } }
		] as unknown as NotionPage[],
		'ds-beats': [
			{ id: 'b-2', properties: { Beat: title('Mara wakes crying black'), Section: { type: 'select', select: { name: 'Catalyst' } }, Order: num(4), Summary: rich('The turning went wrong.'), Scenes: rel(S1) } },
			{ id: 'b-1', properties: { Beat: title('Kai keeps the crew hidden'), Section: { type: 'select', select: { name: 'Set-Up' } }, Order: num(3), Summary: rich(''), Scenes: rel(S1, S2) } }
		] as unknown as NotionPage[]
	};
	const page = <T,>(results: T[]) => ({ results, next_cursor: null, has_more: false });
	/** A write payload ({ rich_text: [{ text: { content } }] }…) as the API would read it back. */
	const asRead = (value: Record<string, unknown>) => {
		if ('rich_text' in value) return rich(((value.rich_text as Array<{ text: { content: string } }>)[0]?.text.content) ?? '');
		if ('title' in value) return title(((value.title as Array<{ text: { content: string } }>)[0]?.text.content) ?? '');
		if ('number' in value) return num(value.number as number);
		if ('checkbox' in value) return { type: 'checkbox', checkbox: value.checkbox };
		if ('relation' in value) return rel(...(value.relation as Array<{ id: string }>).map((r) => r.id));
		return value;
	};
	const apply = (target: NotionPage, properties: Record<string, unknown>) => { for (const [name, value] of Object.entries(properties)) target.properties[name] = asRead(value as Record<string, unknown>) as never; };
	let created = 0;
	return {
		reads, writes, rows,
		async updatePage(id, properties) {
			writes.push({ op: 'update', id, properties });
			const target = Object.values(rows).flat().find((row) => row.id.replace(/-/g, '') === id.replace(/-/g, ''));
			if (target) apply(target, properties);
		},
		async createPage(source, properties) {
			const id = `new-shot-${++created}`;
			writes.push({ op: 'create', id: source, properties });
			const row = { id, properties: {} } as NotionPage;
			apply(row, properties);
			(rows[source] ??= []).push(row);
			return { id };
		},
		async children(id) { reads.push(`children ${id}`); return page((children[id] ?? []) as never[]); },
		async database(id) { reads.push(`database ${id}`); return { data_sources: [{ id: id.replace('db-', 'ds-') }] }; },
		async dataSource(id) { reads.push(`source ${id}`); return { id, title: t(sources[id].title), properties: sources[id].properties }; },
		async query(id) { reads.push(`query ${id}`); return page(rows[id] ?? []); }
	};
}

describe('Notion series: connect, check, import an episode', () => {
	test('connect finds the story and three databases under the root, checks them, lists the episodes', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-ns-')); roots.push(root);
		const store = new SeriesStore(join(root, 'series'));
		const api = fakeNotion();
		expect(pageIdOf(`https://app.notion.com/p/${ROOT.replace(/-/g, '')}?pvs=204`)).toBe(ROOT.replace(/-/g, ''));
		const record = await connectSeries(api, store, ROOT, 'Bloodrush Series Shot List');
		expect(record.title).toBe('Bloodrush Series Shot List');
		expect(record.sources).toEqual({ episodes: 'ds-episodes', scenes: 'ds-scenes', shots: 'ds-shots' });
		expect(record.checks.episodes.ok && record.checks.scenes.ok && record.checks.shots.ok).toBeTrue();
		expect(record.story?.text).toContain('# Logline');
		expect(record.episodes).toHaveLength(1);
		expect(record.episodes[0]).toMatchObject({ number: 1, title: 'EP01 — The Late Shift', scene_count: 2 });
		expect(record.runtime_min).toBe(10);
		// Only pages under the root were read.
		expect([...new Set(api.reads.filter((r) => r.startsWith('children')).map((r) => r.split(' ')[1]))].sort()).toEqual([ROOT, 'raw-page', 'story-page'].sort());
	});

	test('import makes a project: a group per scene in act order, a beat per shot with its prompts and details', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-ni-')); roots.push(root);
		const gateway = new ProjectCommandGateway(new ProjectStore({ root: join(root, 'projects') }));
		const store = new SeriesStore(join(root, 'series'));
		const api = fakeNotion();
		const record = await connectSeries(api, store, ROOT, 'Blood Rush');
		const { project, record: after } = await importEpisode(api, store, gateway, record, EP1.replace(/-/g, ''));
		expect(project.title).toBe('Blood Rush · EP01 — The Late Shift');
		expect(project.production.groups?.map((g) => g.name)).toEqual(['Teaser · P01 — 2:47 AM (Teaser)', 'Act 1 · P02 — Morning Quad']);
		expect(project.production.cards.map((c) => c.title)).toEqual(['E01 S01 SH01', 'E01 S01 SH02', 'E01 S02 SH01']);
		const first = project.production.cards[0];
		expect(first).toMatchObject({ beat: 'Mara on the floor, crying black.', video_prompt: 'Video prompt 1', duration_ms: 6000, group_id: project.production.groups![0].group_id });
		expect(first.source?.dialogue).toBe('"36 hours earlier."');
		expect(project.production.cards[2].video_prompt).toBe('None yet (from Notion).');
		expect(project.series).toMatchObject({ episode_number: 1, episode_title: 'EP01 — The Late Shift' });
		expect(project.series?.scenes.map((s) => [s.act, s.seconds, s.shot_count])).toEqual([['Teaser', 11, 2], ['Act 1', 4, 1]]);
		expect(after.episode_projects[EP1.replace(/-/g, '')]).toBe(project.project_id);
		// A board that already has beats never takes an import.
		const again = await gateway.importEpisode(project.project_id, project.version, { series: project.series!, groups: [], cards: project.production.cards, title: 'x', logline: '' });
		expect(again.ok).toBeFalse();
	});

	test('shot codes: a show code at connect, scene codes and shot numbers at import, edits refused once locked', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-ni-')); roots.push(root);
		const gateway = new ProjectCommandGateway(new ProjectStore({ root: join(root, 'projects') }));
		const store = new SeriesStore(join(root, 'series'));
		const api = fakeNotion();
		const record = await connectSeries(api, store, ROOT, 'Blood Rush');
		expect(record.show_code).toBe('BLR');
		expect(record.codes_locked_at).toBeNull();
		const { project } = await importEpisode(api, store, gateway, record, EP1.replace(/-/g, ''));
		const codes = project.series!.scenes.map((scene) => scene.code);
		expect(codes.every((code) => /^[A-Z]{3}$/.test(code ?? ''))).toBeTrue();
		expect(new Set(codes).size).toBe(codes.length);
		expect(project.production.cards.map((card) => card.shot_number)).toEqual([10, 20, 10]);

		// Re-checking keeps the show code; editing a scene code works until the codes lock.
		expect((await connectSeries(api, store, ROOT, 'Blood Rush')).show_code).toBe('BLR');
		const group = project.series!.scenes[1].group_id;
		const edited = await gateway.setShotCodes(project.project_id, project.version, { scene_codes: { [group]: 'QUD' }, locked: false });
		expect(edited.ok && edited.data.series!.scenes[1].code).toBe('QUD');
		if (!edited.ok) return;
		const clash = await gateway.setShotCodes(project.project_id, edited.data.version, { scene_codes: { [project.series!.scenes[0].group_id]: 'QUD' }, locked: false });
		expect(clash.ok).toBeFalse();
		const refused = await gateway.setShotCodes(project.project_id, edited.data.version, { scene_codes: { [group]: 'QAD' }, locked: true });
		expect(refused.ok).toBeFalse();
		// Numbers never change on a later save.
		const again = await gateway.setShotCodes(project.project_id, edited.data.version, { locked: true });
		expect(again.ok && again.data.production.cards.map((card) => card.shot_number)).toEqual([10, 20, 10]);
	});

	test('target length: an episode sets its own minutes, or goes back to the series format', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-ni-')); roots.push(root);
		const gateway = new ProjectCommandGateway(new ProjectStore({ root: join(root, 'projects') }));
		const store = new SeriesStore(join(root, 'series'));
		const api = fakeNotion();
		const { project } = await importEpisode(api, store, gateway, await connectSeries(api, store, ROOT, 'Blood Rush'), EP1.replace(/-/g, ''));
		expect(project.series?.target_min ?? null).toBeNull();
		const set = await gateway.setTargetLength(project.project_id, project.version, 10);
		expect(set.ok && set.data.series?.target_min).toBe(10);
		if (!set.ok) return;
		expect((await gateway.setTargetLength(project.project_id, set.data.version, 0)).ok).toBeFalse();
		const cleared = await gateway.setTargetLength(project.project_id, set.data.version, null);
		expect(cleared.ok && cleared.data.series?.target_min).toBeNull();
	});

	test('template v2: story beats in Save the Cat order, scene sections, scenes linked to their story beats', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-ni-')); roots.push(root);
		const gateway = new ProjectCommandGateway(new ProjectStore({ root: join(root, 'projects') }));
		const store = new SeriesStore(join(root, 'series'));
		const api = fakeNotion(true);
		const record = await connectSeries(api, store, ROOT, 'Blood Rush');
		expect(record.story_beats?.check?.ok).toBeTrue();
		expect(record.story_beats?.beats.map((beat) => [beat.title, beat.section])).toEqual([['Kai keeps the crew hidden', 'Set-Up'], ['Mara wakes crying black', 'Catalyst']]);
		const { project } = await importEpisode(api, store, gateway, record, EP1.replace(/-/g, ''));
		const [teaser, quad] = project.series!.scenes;
		expect(quad.act).toBe('Act 2');
		expect(teaser.story_beat_ids).toEqual(['b1', 'b2']);
		expect(quad.story_beat_ids).toEqual(['b1']);
	});

	test('pushTake: a series take goes to its scene folder by shot code, is marked stored and locks the codes', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-ni-')); roots.push(root);
		const store = new ProjectStore({ root: join(root, 'projects') });
		const gateway = new ProjectCommandGateway(store);
		const series = new SeriesStore(join(root, 'series'));
		const api = fakeNotion();
		const { project, record } = await importEpisode(api, series, gateway, await connectSeries(api, series, ROOT, 'Blood Rush'), EP1.replace(/-/g, ''));
		const card = project.production.cards[0];
		const scene = project.series!.scenes.find((s) => s.group_id === card.group_id)!;
		await series.write({ ...record, review_room: { project_id: 'rr-p1', folders: { [`scene:${scene.page_id}`]: 'f-scene' }, synced_at: null } });
		await mkdir(join(root, 'projects', project.project_id, 'files', 'board'), { recursive: true });
		await writeFile(join(root, 'projects', project.project_id, 'files', 'board', 'still.png'), new Uint8Array([1, 2, 3]));
		const saved = await gateway.saveProduction({ command: 'save_production', project_id: project.project_id, expected_version: project.version,
			production: { ...project.production, assets: [{ asset_id: 'still', card_id: card.card_id, kind: 'image', name: 'still.png', mime_type: 'image/png', url: `/api/projects/${project.project_id}/files/board/still.png`, width: 2048, height: 1152, created_at: '2026-10-17T00:00:00.000Z' }] } });
		if (!saved.ok) throw new Error(saved.error.message);
		const uploads: Array<Record<string, unknown>> = [];
		const client = {
			changes: async () => ({ cursor: '1', assets: [], versions: [{ versionId: 'v1', assetId: 'a1', version: 1, isCurrent: false, processingState: 'ready', mimeType: 'image/png', createdAt: 1 }], removedAssets: [] }),
			beginUpload: async (input: Record<string, unknown>) => { uploads.push(input); return { sessionId: 's', url: 'u', posterUrl: 'p' }; },
			putSigned: async () => {}, completeUpload: async () => ({ assetId: 'a1' }), putMetadata: async () => {}, setCurrentVersion: async () => {}
		} as unknown as ReviewRoomClient;
		const pushed = await pushTake({ store, gateway, series, projectRoot: join(root, 'projects'), client, probe: async () => ({ width: 2048, height: 1152 }), poster: async (_input, output) => { await writeFile(output, new Uint8Array([9])); } }, project.project_id, 'still');
		if (!pushed.ok) throw new Error(pushed.message);
		expect(pushed.code).toBe(`BLR_EP101_${scene.code}_0010`);
		expect(uploads[0]).toMatchObject({ projectId: 'rr-p1', folderId: 'f-scene', assetCode: pushed.code, keepCurrentVersion: false });
		expect(pushed.project.production.assets[0].review_room).toEqual({ asset_id: 'a1', version_id: 'v1', version: 1, code: pushed.code });
		expect((await series.read(record.series_id))?.codes_locked_at).toBeTruthy();
	});

	test('pullTakes: a version dropped in Review Room becomes a take and, as current version, the pick; misfiled drops are reported', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-ni-')); roots.push(root);
		const store = new ProjectStore({ root: join(root, 'projects') });
		const gateway = new ProjectCommandGateway(store);
		const series = new SeriesStore(join(root, 'series'));
		const api = fakeNotion();
		const { project, record } = await importEpisode(api, series, gateway, await connectSeries(api, series, ROOT, 'Blood Rush'), EP1.replace(/-/g, ''));
		const card = project.production.cards[0];
		const scene = project.series!.scenes.find((s) => s.group_id === card.group_id)!;
		await series.write({ ...record, review_room: { project_id: 'rr-p1', folders: { [`scene:${scene.page_id}`]: 'f-scene' }, synced_at: null } });
		const code = `BLR_EP101_${scene.code}_0010`;
		const feed = {
			cursor: '42',
			assets: [
				{ assetId: 'a1', folderId: 'f-scene', assetCode: code, title: code, currentVersionId: 'v2', misfiled: false, copiedFromAssetId: null, updatedAt: 1 },
				{ assetId: 'a2', folderId: 'f-scene', assetCode: null, title: 'random-drop.mp4', currentVersionId: 'v9', misfiled: true, copiedFromAssetId: null, updatedAt: 1 }
			],
			versions: [{ versionId: 'v2', assetId: 'a1', version: 2, isCurrent: true, processingState: 'ready', mimeType: 'video/mp4', createdAt: 1_700_000_000_000 }],
			removedAssets: []
		};
		const cursors: string[] = [];
		const client = {
			changes: async (_project: string, since: string) => { cursors.push(String(since)); return feed; },
			versionMedia: async () => ({ original: { url: 'https://storage.test/v2.mp4', mimeType: 'video/mp4', sizeBytes: 3, expiresAt: 0 }, poster: null }),
			download: async () => new Uint8Array([0, 0, 0, 24])
		} as unknown as ReviewRoomClient;
		const deps = { store, gateway, series, projectRoot: join(root, 'projects'), client, probe: async () => ({}), poster: async () => {} };
		const pulled = await pullTakes(deps, project.project_id);
		if (!pulled.ok) throw new Error(pulled.message);
		expect(pulled.added).toBe(1);
		expect(pulled.misfiled).toEqual([{ scene: scene.title, title: 'random-drop.mp4' }]);
		const take = pulled.project.production.assets.find((asset) => asset.review_room?.version_id === 'v2')!;
		expect(take).toMatchObject({ card_id: card.card_id, kind: 'video', name: `${code}_v002.mp4` });
		expect(pulled.project.production.cards[0].pick_take_id).toBe(take.asset_id);
		expect((await series.read(record.series_id))?.review_room?.cursor).toBe('42');
		const again = await pullTakes(deps, project.project_id);
		expect(again.ok && again.added).toBe(0);
		expect(cursors).toEqual(['0', '42']);
	});

	test('template v1 (no Story Beats database) still imports', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-ni-')); roots.push(root);
		const store = new SeriesStore(join(root, 'series'));
		const record = await connectSeries(fakeNotion(), store, ROOT, 'Blood Rush');
		expect(record.story_beats).toEqual({ database: null, check: null, beats: [] });
	});
});
describe('Notion template v3 (V1S-323)', () => {
	test('a scene reads its Action, falling back to the v2 "Story Beats" field', async () => {
		const { toScene } = await import('../../src/lib/domain/notion-series');
		const scene = (props: Record<string, unknown>) => toScene({ id: S1, properties: { Scene: title('Morning Quad'), 'Scene #': num(20), ...props } } as NotionPage);
		expect(scene({ Action: rich('Kai signs nothing.') }).story_beats).toBe('Kai signs nothing.');
		expect(scene({ 'Story Beats': rich('Old field.') }).story_beats).toBe('Old field.');
		expect(scene({ Action: rich('New.'), 'Story Beats': rich('Old.') }).story_beats).toBe('New.');
	});

	test('the template check accepts the v3 fields and still passes without them', async () => {
		const { checkDatabase } = await import('../../src/lib/domain/notion-series');
		const v2 = schema({ Scene: 'title', 'Scene #': 'number', Episode: 'relation', Summary: 'rich_text', 'Story Beats': 'rich_text' });
		const v3 = schema({ Scene: 'title', 'Scene #': 'number', Episode: 'relation', Summary: 'rich_text', Action: 'rich_text', Dialogue: 'rich_text', References: 'relation', 'Scene code': 'rich_text', Locked: 'checkbox' });
		expect(checkDatabase('scenes', v2).ok).toBe(true);
		const check = checkDatabase('scenes', v3);
		expect(check.ok).toBe(true);
		expect(check.wrongType).toEqual([]);
	});
});

describe('Notion sync (V1S-325)', () => {
	const setup = async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-sync-')); roots.push(root);
		const projects = new ProjectStore({ root: join(root, 'projects') });
		const gateway = new ProjectCommandGateway(projects);
		const store = new SeriesStore(join(root, 'series'));
		const api = fakeNotion();
		// Template v3 fields on the fake: a seeded scene code, an outline and a scene's dialogue.
		const s2 = api.rows['ds-scenes'].find((row) => row.id === S2)!;
		s2.properties['Scene code'] = rich('QUD') as never;
		s2.properties.Dialogue = rich('KAI (to the crew): "Smile."') as never;
		api.rows['ds-episodes'][0].properties['Episode outline'] = rich('Teaser: 2:47 AM. Act 1: the quad.') as never;
		const record = await connectSeries(api, store, ROOT, 'Blood Rush');
		const { project, record: after } = await importEpisode(api, store, gateway, record, EP1.replace(/-/g, ''));
		const { syncSeriesToNotion } = await import('../../src/lib/server/notion-sync');
		const sync = async () => syncSeriesToNotion(api, (await store.read(after.series_id))!, (id) => projects.readProject(id), gateway);
		return { api, gateway, projects, store, project, sync };
	};

	test('import reads the v3 fields and keeps a scene code already in Notion', async () => {
		const { project } = await setup();
		const quad = project.series!.scenes.find((scene) => scene.page_id === S2.replace(/-/g, ''))!;
		expect(quad.code).toBe('QUD');
		expect(quad.dialogue).toBe('KAI (to the crew): "Smile."');
		expect(project.series!.outline).toBe('Teaser: 2:47 AM. Act 1: the quad.');
	});

	test('sync writes the codes, restores a code typed over in Notion, and is quiet when nothing changed', async () => {
		const { api, project, sync } = await setup();
		const first = await sync();
		// The quad scene already shows QUD in Notion, so only the teaser's scene code is written.
		expect(first).toMatchObject({ episodes: 1, scenes: 1, shots_updated: 3, shots_created: 0 });
		const episode = api.rows['ds-episodes'][0].properties;
		expect([episode['Show code'], episode['Episode code']]).toEqual([rich('BLR'), rich('EP101')]);
		const teaserCode = project.series!.scenes.find((scene) => scene.page_id === S1.replace(/-/g, ''))!.code;
		const shot1 = api.rows['ds-shots'].find((row) => row.id === 'sh-1')!.properties;
		expect(shot1['Shot code']).toEqual(rich(`BLR_EP101_${teaserCode}_0010`));
		expect(shot1['Shot #']).toEqual(num(10));

		// Someone types over a code in Notion: the next sync puts it back, and touches nothing else.
		shot1['Shot code'] = rich('WRONG') as never;
		api.writes.length = 0;
		const second = await sync();
		expect(second).toMatchObject({ episodes: 0, scenes: 0, shots_updated: 1, shots_created: 0 });
		expect(shot1['Shot code'] as unknown).toEqual(rich(`BLR_EP101_${teaserCode}_0010`));
		expect(api.writes).toHaveLength(1);
		api.writes.length = 0;
		expect(await sync()).toMatchObject({ episodes: 0, scenes: 0, shots_updated: 0, pulled: 0 });
		expect(api.writes).toHaveLength(0);
	});

	test('plain fields: an edit in Notion comes onto the board; an edit on the board goes to Notion', async () => {
		const { api, projects, project, sync } = await setup();
		await sync();
		const shot1 = api.rows['ds-shots'].find((row) => row.id === 'sh-1')!.properties;
		shot1.Description = rich('Mara on the floor, black tears, eyes open.') as never;
		const pulled = await sync();
		expect(pulled.pulled).toBe(1);
		const card = (await projects.readProject(project.project_id))!.production.cards.find((c) => c.source?.notion_page_id === 'sh1')!;
		expect(card.beat).toBe('Mara on the floor, black tears, eyes open.');

		// The board changes the dialogue line; Notion has not changed since the last sync, so the board wins.
		const current = (await projects.readProject(project.project_id))!;
		const edited = current.production.cards.map((c) => (c.card_id === card.card_id ? { ...c, source: { ...c.source!, dialogue: '"Thirty-six hours earlier."' } } : c));
		const saved = await new ProjectCommandGateway(projects).saveProduction({ command: 'save_production', project_id: current.project_id, expected_version: current.version, production: { ...current.production, cards: edited } });
		expect(saved.ok).toBeTrue();
		await sync();
		expect(shot1['Dialogue / VO']).toEqual(rich('"Thirty-six hours earlier."'));
	});

	test('a shot that exists only on the board is created in Notion and linked', async () => {
		const { api, projects, project, sync, gateway } = await setup();
		const group = project.series!.scenes[1].group_id;
		const fitted = { card_id: 'fit-card-0001', order: 0, title: 'Quad reaction', beat: 'Malik glances back.', purpose: 'Coverage.', duration_ms: 4000, image_prompt: 'x', video_prompt: 'y', status: 'draft' as const, group_id: group, fit: { target_min: 10, at: '2026-10-17T00:00:00.000Z', lint: { rounds: 0, fixed: 0, remaining: 0 }, dialogue: 'MALIK: "Later."' } };
		const fit = await gateway.fitScene(project.project_id, project.version, group, [fitted]);
		expect(fit.ok).toBeTrue();
		const report = await sync();
		expect(report.shots_created).toBe(1);
		const created = api.rows['ds-shots'].find((row) => row.id === 'new-shot-1')!.properties;
		expect(created.Description).toEqual(rich('Malik glances back.'));
		expect(created['Dialogue / VO']).toEqual(rich('MALIK: "Later."'));
		expect(created['Shot code']).toEqual(rich('BLR_EP101_QUD_0020'));
		const card = (await projects.readProject(project.project_id))!.production.cards.find((c) => c.card_id === 'fit-card-0001')!;
		expect(card.source?.notion_page_id).toBe('newshot1');
		expect(card.fit?.dialogue).toBe('MALIK: "Later."');
		expect((await sync()).shots_created).toBe(0);
	});

	test('scene code suggestions skip fragments like "AM" in time titles', async () => {
		const { suggestCode } = await import('../../src/lib/domain/shot-codes');
		expect(suggestCode('2:47 AM (From Inside)')).not.toBe('AFI');
		expect(suggestCode('2:47 AM (From Inside)')).toMatch(/^F/);
		expect(suggestCode('Morning Quad')).toBe('MRQ');
	});
});
