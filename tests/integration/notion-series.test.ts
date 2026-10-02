import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { pageIdOf, type NotionApi } from '../../src/lib/server/notion';
import { connectSeries, importEpisode, SeriesStore } from '../../src/lib/server/series';
import type { NotionPage } from '../../src/lib/domain/notion-series';

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
function fakeNotion(): NotionApi & { reads: string[] } {
	const reads: string[] = [];
	const children: Record<string, unknown[]> = {
		[ROOT]: [
			{ id: 'story-page', type: 'child_page', child_page: { title: 'Blood Rush — Season 1 Story (v2)' } },
			{ id: 'db-episodes', type: 'child_database', child_database: { title: 'Episodes' } },
			{ id: 'raw-page', type: 'child_page', child_page: { title: 'Databases (raw)' } }
		],
		'raw-page': [{ id: 'db-scenes', type: 'child_database', child_database: { title: 'Scenes' } }, { id: 'db-shots', type: 'child_database', child_database: { title: 'Shots' } }],
		'story-page': [{ id: 'h', type: 'heading_1', heading_1: { rich_text: t('Logline') } }, { id: 'p', type: 'paragraph', paragraph: { rich_text: t('In fall 2001, Kai keeps a hidden crew…') } }]
	};
	const sources: Record<string, { title: string; properties: Record<string, { type: string }> }> = {
		'ds-episodes': { title: 'Episodes', properties: schema({ Title: 'title', 'Episode #': 'number', Summary: 'rich_text', Scenes: 'relation', Status: 'select', Act: 'select' }) },
		'ds-scenes': { title: 'Scenes', properties: schema({ Scene: 'title', 'Scene #': 'number', Episode: 'relation', Summary: 'rich_text', Timecode: 'rich_text', Location: 'rich_text' }) },
		'ds-shots': { title: 'Shots', properties: schema({ Shot: 'title', Scene: 'relation', Description: 'rich_text', 'Duration (s)': 'number', 'Video Prompt (Seedance 2.5)': 'rich_text', 'Shot #': 'number', 'Dialogue / VO': 'rich_text' }) }
	};
	const rows: Record<string, NotionPage[]> = {
		'ds-episodes': [{ id: EP1, properties: { Title: title('EP01 — The Late Shift'), 'Episode #': num(1), Summary: rich('Kai breaks blood law.'), Scenes: rel(S1, S2), Status: { type: 'select', select: { name: 'Shot List' } } } } as unknown as NotionPage],
		'ds-scenes': [
			{ id: S2, properties: { Scene: title('P02 — Morning Quad'), 'Scene #': num(2), Episode: rel(EP1), Summary: rich('Day quad.'), Timecode: rich('Act 1 · ~1:30'), Location: rich('College quad') } },
			{ id: S1, properties: { Scene: title('P01 — 2:47 AM (Teaser)'), 'Scene #': num(1), Episode: rel(EP1), Summary: rich('The aftermath.'), Timecode: rich('0:00–2:00 (Teaser)'), Location: rich('Video Haven') } }
		] as unknown as NotionPage[],
		'ds-shots': [
			{ id: 'sh-2', properties: { Shot: title('E01 S01 SH02'), 'Shot #': num(2), Scene: rel(S1), Description: rich('Kai drinks the red vial.'), 'Duration (s)': num(5), 'Video Prompt (Seedance 2.5)': rich('Video prompt 2'), 'Dialogue / VO': rich('') } },
			{ id: 'sh-1', properties: { Shot: title('E01 S01 SH01'), 'Shot #': num(1), Scene: rel(S1), Description: rich('Mara on the floor, crying black.'), 'Duration (s)': num(6), 'Video Prompt (Seedance 2.5)': rich('Video prompt 1'), 'Dialogue / VO': rich('"36 hours earlier."') } },
			{ id: 'sh-3', properties: { Shot: title('E01 S02 SH01'), 'Shot #': num(1), Scene: rel(S2), Description: rich('Kai crosses the quad.'), 'Duration (s)': num(4), 'Video Prompt (Seedance 2.5)': rich(''), 'Dialogue / VO': rich('') } }
		] as unknown as NotionPage[]
	};
	const page = <T,>(results: T[]) => ({ results, next_cursor: null, has_more: false });
	return {
		reads,
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
});
