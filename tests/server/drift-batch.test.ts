import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { SeriesStore, type SeriesRecord } from '../../src/lib/server/series';
import type { NotionApi } from '../../src/lib/server/notion';
import type { NotionPage } from '../../src/lib/domain/notion-series';
import type { ReviewRoomClient } from '../../src/lib/server/review-room';
import { readPrep } from '../../src/lib/server/prep';
import { answerDrift, type BatchEvent, type DriftAnswer } from '../../src/lib/server/drift-batch';

/**
 * Drift 10 (GitHub #38 / V1S-514; spec GitHub #28, stories 38-41): one answer covers several drift items. The first
 * write runs alone and is checked against Notion before the rest go; each write is said as it runs and as it ends; a
 * failure stops the batch, leaves the rest untouched and says why. Notion and Review Room are faked; nothing real is
 * touched.
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

/**
 * A fake Notion that logs every call in order. `failCreateAt` makes the nth create (1-based) time out; `hideNew`
 * makes Notion accept a page but not list it when read back (the check must catch it).
 */
function fakeNotion(options: { failCreateAt?: number; hideNew?: boolean } = {}) {
	const calls: string[] = [];
	const pages: NotionPage[] = [refPage('r-mara', 'Mara Voss', 'Character')];
	let creates = 0;
	const api = {
		query: async (source: string) => { calls.push(`query ${source}`); return { results: source === 'src-refs' ? pages : [], next_cursor: null, has_more: false }; },
		createPage: async (source: string, props: Record<string, unknown>) => {
			creates += 1;
			const p = props as { Name: { title: Array<{ text: { content: string } }> }; Kind: { select: { name: string } } };
			const name = p.Name.title[0].text.content;
			calls.push(`create ${name}`);
			if (options.failCreateAt === creates) throw new Error('Request to Notion API has timed out');
			const id = `new-${creates}`;
			if (!options.hideNew) pages.push(refPage(id, name, p.Kind.select.name));
			return { id };
		},
		updatePage: async () => { calls.push('update'); },
		trashPage: async () => { calls.push('trash'); }
	} as unknown as NotionApi;
	return { api, calls, created: () => calls.filter((call) => call.startsWith('create ')).map((call) => call.slice(7)) };
}

/** A fake Review Room that records any call; adding to Notion must never reach it. */
function fakeReviewRoom() {
	const calls: string[] = [];
	const client = new Proxy({}, { get: (_, name) => async () => { calls.push(String(name)); return {}; } }) as unknown as ReviewRoomClient;
	return { client, calls };
}

async function setup(notion: NotionApi | null) {
	const root = await mkdtemp(join(tmpdir(), 'csp-drift-batch-')); roots.push(root);
	const projectRoot = join(root, 'projects');
	const store = new ProjectStore({ root: projectRoot });
	const gateway = new ProjectCommandGateway(store);
	const series = new SeriesStore(join(root, 'series'));
	const make = async (title: string, seriesId: string, episode: string) => {
		const created = await gateway.createProject({ command: 'create_project', title, brief: '', creative_focus: 'full room', created_by: 'test' });
		if (!created.ok) throw new Error(created.error.message);
		const imported = await gateway.importEpisode(created.data.project_id, created.data.version, {
			series: { series_id: seriesId, episode_page_id: episode, episode_number: 1, season: 1, episode_title: title, summary: '', twist: '', cliffhanger: '', imported_at: '2026-11-25T00:00:00.000Z', outline: '', scenes: [] },
			groups: [], cards: [], title, logline: ''
		});
		if (!imported.ok) throw new Error(imported.error.message);
		return (await store.readProject(created.data.project_id))!;
	};
	const tr110 = await make('TR110', 'ser1', 'ep1');
	const tr130 = await make('TR130', 'ser1', 'ep2');
	const stranger = await make('Elsewhere', 'ser2', 'ep9');
	const record: SeriesRecord = {
		schema_version: 1, series_id: 'ser1', title: 'Blood Rush', notion_root_id: 'ser1',
		sources: { episodes: 'src-ep', scenes: 'src-sc', shots: 'src-sh' }, checks: { episodes: check, scenes: check, shots: check }, story: null,
		episodes: [
			{ page_id: 'ep1', number: 1, title: 'TR110', status: '', act: '', season: 1, summary: '', twist: '', cliffhanger: '', scene_ids: [], scene_count: 0 },
			{ page_id: 'ep2', number: 2, title: 'TR130', status: '', act: '', season: 1, summary: '', twist: '', cliffhanger: '', scene_ids: [], scene_count: 0 }
		],
		references: { database: 'db-refs', source: 'src-refs', check, items: [{ page_id: 'r-mara', name: 'Mara Voss', kind: 'Character', role: '', handles: [], file_name: '', name_on_sheet: false, scene_ids: [] }] },
		runtime_min: 10, episode_projects: { ep1: tr110.project_id, ep2: tr130.project_id }, notion_trash: [],
		checked_at: '2026-11-25T00:00:00.000Z', created_at: '2026-11-25T00:00:00.000Z'
	};
	await series.write(record);
	const review = fakeReviewRoom();
	return { deps: { store, projectRoot, series, notion, client: review.client }, tr110, tr130, stranger, series, review };
}

const add = (project_id: string, kind: DriftAnswer['kind'], name: string, former_names = [name]): DriftAnswer => ({ key: `${kind}:${name.toLowerCase()}`, choice: 'add_to_notion', kind, name, project_id, former_names });

/** Runs a batch and keeps every event said, in order. */
async function run(deps: Parameters<typeof answerDrift>[0], project: Parameters<typeof answerDrift>[1], answers: DriftAnswer[]) {
	const events: BatchEvent[] = [];
	const result = await answerDrift(deps, project, answers, (event) => events.push(event));
	return { result, events, said: events.map((event) => `${event.state} ${event.text}`) };
}

describe('answering several drift items at once (Drift 10)', () => {
	test('the first write runs alone and is checked in Notion before the rest go, each one said as it runs and ends', async () => {
		const notion = fakeNotion();
		const { deps, tr110, tr130, review } = await setup(notion.api);
		const answers = [add(tr110.project_id, 'location', 'Pool'), add(tr110.project_id, 'location', 'Campus gym', ['Campus Walkway', 'Campus gym']), add(tr130.project_id, 'prop', 'Amber vials')];
		const { result, events, said } = await run(deps, tr110, answers);
		expect(result).toMatchObject({ ok: true, done: answers.map((answer) => answer.key), untouched: [] });
		// Pool is written, then read back on its own, and only then do the other two go.
		const first = notion.calls.indexOf('create Pool');
		const second = notion.calls.indexOf('create Campus gym');
		expect(first).toBeGreaterThanOrEqual(0);
		expect(notion.calls.slice(first + 1, second).filter((call) => call === 'query src-refs').length).toBeGreaterThanOrEqual(2);
		expect(notion.created()).toEqual(['Pool', 'Campus gym', 'Amber vials']);
		expect(said).toEqual([
			'doing Adding Pool to Notion, alone first…',
			"done Pool is in Notion's References now, and in TR110's Prep.",
			'doing Checking Pool in Notion before the other 2…',
			'done Pool is in Notion as a Location, and TR110\'s Prep points at it. Adding the other 2.',
			'doing Adding Campus gym to Notion…',
			"done Campus gym is in Notion's References now, and in TR110's Prep.",
			'doing Adding Amber vials to Notion…',
			"done Amber vials is in Notion's References now, and in TR130's Prep."
		]);
		expect(events.every((event) => event.key)).toBeTrue();
		// Each added to the Prep it was found in, linked to its new page.
		expect((await readPrep(deps.projectRoot, tr110.project_id)).custom_entries).toEqual([
			{ kind: 'location', name: 'Pool', reference_page_id: 'new1' }, { kind: 'location', name: 'Campus gym', reference_page_id: 'new2' }
		]);
		expect((await readPrep(deps.projectRoot, tr130.project_id)).custom_entries).toEqual([{ kind: 'prop', name: 'Amber vials', reference_page_id: 'new3' }]);
		expect(review.calls).toEqual([]);
	});

	test('a first write the check cannot find stops the batch, leaves the rest untouched and says why', async () => {
		const notion = fakeNotion({ hideNew: true });
		const { deps, tr110 } = await setup(notion.api);
		const answers = [add(tr110.project_id, 'location', 'Pool'), add(tr110.project_id, 'location', 'Campus gym'), add(tr110.project_id, 'prop', 'Amber vials')];
		const { result, said } = await run(deps, tr110, answers);
		expect(notion.created()).toEqual(['Pool']);
		expect(result).toMatchObject({ ok: false, done: ['location:pool'], untouched: ['location:campus gym', 'prop:amber vials'] });
		if (!result.ok) expect(result.message).toBe('Stopped after Pool: Notion does not list Pool among the References. The other 2 were not touched.');
		expect(said.at(-1)).toBe('failed Notion does not list Pool among the References. The other 2 were not touched.');
		expect((await readPrep(deps.projectRoot, tr110.project_id)).custom_entries?.map((entry) => entry.name)).toEqual(['Pool']);
	});

	test('a failure part way stops there: what was written stays, the rest are untouched, and it says why', async () => {
		const notion = fakeNotion({ failCreateAt: 2 });
		const { deps, tr110, review } = await setup(notion.api);
		const answers = [add(tr110.project_id, 'location', 'Pool'), add(tr110.project_id, 'location', 'Campus gym'), add(tr110.project_id, 'prop', 'Amber vials'), add(tr110.project_id, 'prop', 'The Rush')];
		const { result, said } = await run(deps, tr110, answers);
		expect(notion.created()).toEqual(['Pool', 'Campus gym']);
		expect(result).toMatchObject({ ok: false, done: ['location:pool'], failed: 'location:campus gym', untouched: ['prop:amber vials', 'prop:the rush'] });
		if (!result.ok) expect(result.message).toBe('Stopped at Campus gym: Notion did not add Campus gym: Request to Notion API has timed out. Nothing was added. The other 2 were not touched.');
		expect(said.at(-1)).toBe('failed Notion did not add Campus gym: Request to Notion API has timed out. Nothing was added. The other 2 were not touched.');
		expect((await readPrep(deps.projectRoot, tr110.project_id)).custom_entries?.map((entry) => entry.name)).toEqual(['Pool']);
		expect(review.calls).toEqual([]);
	});

	test('a first write that fails stops everything', async () => {
		const notion = fakeNotion({ failCreateAt: 1 });
		const { deps, tr110 } = await setup(notion.api);
		const { result } = await run(deps, tr110, [add(tr110.project_id, 'location', 'Pool'), add(tr110.project_id, 'location', 'Campus gym')]);
		expect(result).toMatchObject({ ok: false, done: [], failed: 'location:pool', untouched: ['location:campus gym'] });
		expect(notion.created()).toEqual(['Pool']);
	});

	test('a single answer is written and checked, with nothing after it', async () => {
		const notion = fakeNotion();
		const { deps, tr110 } = await setup(notion.api);
		const { result, said } = await run(deps, tr110, [add(tr110.project_id, 'location', 'Pool')]);
		expect(result).toMatchObject({ ok: true, done: ['location:pool'] });
		expect(said).toEqual(['doing Adding Pool to Notion…', "done Pool is in Notion's References now, and in TR110's Prep.", 'doing Checking Pool in Notion…', "done Pool is in Notion as a Location, and TR110's Prep points at it."]);
	});

	test('refuses before writing anything: a choice not built yet, two answers for one name, a project outside the series, nothing to do', async () => {
		const notion = fakeNotion();
		const { deps, tr110, stranger, review } = await setup(notion.api);
		const refused = [
			[add(tr110.project_id, 'location', 'Pool'), { ...add(tr110.project_id, 'character', 'Bryson'), choice: 'link' as const }],
			[add(tr110.project_id, 'location', 'Pool'), add(tr110.project_id, 'location', 'pool ')],
			[add(tr110.project_id, 'location', 'Pool'), add(stranger.project_id, 'prop', 'Amber vials')],
			[add(tr110.project_id, 'location', '  ')],
			[]
		];
		for (const answers of refused) {
			const { result, events } = await run(deps, tr110, answers);
			expect(result).toMatchObject({ ok: false, done: [] });
			if (!result.ok) expect(result.message).toContain('Nothing was written');
			expect(events).toEqual([]);
		}
		expect(notion.calls.filter((call) => call.startsWith('create'))).toEqual([]);
		expect(review.calls).toEqual([]);
	});
});
