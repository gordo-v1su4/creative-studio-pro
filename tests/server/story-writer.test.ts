import { describe, expect, test } from 'bun:test';
import { createStoryWriter, richText } from '../../src/lib/server/story-writer';
import type { NotionApi } from '../../src/lib/server/notion';
import type { SeriesRecord } from '../../src/lib/server/series';

const check = { ok: true, missing: [], wrongType: [], optionalMissing: [] };
const record: SeriesRecord = {
	schema_version: 1, series_id: 'root', title: 'Blood Rush', notion_root_id: 'root',
	sources: { episodes: 'src-ep', scenes: 'src-sc', shots: 'src-sh' }, checks: { episodes: check, scenes: check, shots: check }, story: null,
	episodes: [
		{ page_id: 'ep1', number: 101, title: 'Pilot', status: '', act: '', season: 1, summary: '', twist: '', cliffhanger: '', scene_ids: ['sc1'], scene_count: 1 },
		{ page_id: 'ep2', number: 102, title: 'Two', status: '', act: '', season: 1, summary: '', twist: '', cliffhanger: '', scene_ids: ['sc9'], scene_count: 1 }
	],
	story_beats: { database: 'db-beats', check, beats: [{ page_id: 'b1', title: 'Catalyst moment', section: 'Catalyst', order: 4, summary: '', episode_ids: ['ep1'], scene_ids: ['sc0'] }] },
	references: { database: 'db-refs', source: 'src-refs', check, items: [{ page_id: 'r1', name: 'Kai "Hoodie" Santana', kind: 'Character', role: '', handles: ['@Kai'], file_name: '', name_on_sheet: true, scene_ids: [] }] },
	runtime_min: 10, episode_projects: {}, checked_at: '2026-10-17T00:00:00Z', created_at: '2026-10-17T00:00:00Z'
};

function fakeNotion(sceneNumber: 'rich_text' | 'number' = 'rich_text') {
	const updates: Array<[string, Record<string, unknown>]> = [];
	const creates: Array<[string, Record<string, unknown>]> = [];
	let n = 0;
	const api = {
		database: async () => ({ data_sources: [{ id: 'src-beats' }] }),
		dataSource: async () => ({ id: 'src-sc', properties: { 'Scene #': { type: sceneNumber } } }),
		updatePage: async (id: string, props: Record<string, unknown>) => { updates.push([id, props]); },
		createPage: async (source: string, props: Record<string, unknown>) => { creates.push([source, props]); return { id: `new-${++n}` }; }
	} as unknown as NotionApi;
	return { api, updates, creates };
}

const scene = { episode_page_id: 'ep1', title: 'Morning Quad', number: 20, section: 'Act 1', summary: 'Kai meets Mara.', action: '1. Kai crosses the quad.', dialogue: 'MARA (sharp): "You dropped this."\nKAI: "Keep it."' };

describe('story writer (Agent panel → Notion)', () => {
	test('creates a scene in this episode: padded Scene #, Action, Dialogue, links; the story beat gains the scene', async () => {
		const fake = fakeNotion();
		const writer = createStoryWriter({ api: fake.api, record, episodePageId: 'ep1' });
		const out = await writer.writeScene({ ...scene, story_beat_page_ids: ['b1'], reference_page_ids: ['r1'] });
		expect(out).toMatchObject({ ok: true, action: 'created', kind: 'scene', page_id: 'new1', url: 'https://www.notion.so/new1' });
		const [source, props] = fake.creates[0];
		expect(source).toBe('src-sc');
		expect(props['Scene #']).toEqual(richText('020'));
		expect(props.Action).toEqual(richText('1. Kai crosses the quad.'));
		expect(props.References).toEqual({ relation: [{ id: 'r1' }] });
		expect(Object.keys(props).some((key) => /code|Locked/.test(key))).toBeFalse();
		expect(fake.updates).toEqual([['b1', { Scenes: { relation: [{ id: 'sc0' }, { id: 'new1' }] } }]]);
	});

	test('refuses coded titles, numbers off the tens, bad dialogue, other episodes, and pages outside the series', async () => {
		const fake = fakeNotion();
		const writer = createStoryWriter({ api: fake.api, record, episodePageId: 'ep1' });
		expect(await writer.writeScene({ ...scene, title: 'P02 — Morning Quad' })).toMatchObject({ ok: false });
		expect(await writer.writeScene({ ...scene, title: '020 QUD — Morning Quad' })).toMatchObject({ ok: false });
		expect(await writer.writeScene({ ...scene, number: 25 })).toMatchObject({ ok: false, error: 'Scene # goes in tens: 10, 20, 30…' });
		expect(await writer.writeScene({ ...scene, dialogue: 'Kai says keep it' })).toMatchObject({ ok: false });
		expect(await writer.writeScene({ ...scene, episode_page_id: 'ep2' })).toMatchObject({ ok: false });
		expect(await writer.writeScene({ ...scene, page_id: 'sc9' })).toMatchObject({ ok: false, error: 'That scene is not in this episode' });
		expect(await writer.writeScene({ ...scene, reference_page_ids: ['elsewhere'] })).toMatchObject({ ok: false });
		expect(await writer.writeStoryBeat({ title: 'X', section: 'Act 1', summary: '' })).toMatchObject({ ok: false });
		expect(await writer.writeEpisodeOutline({ episode_page_id: 'nope', outline: 'x' })).toMatchObject({ ok: false });
		expect(fake.creates).toEqual([]);
		expect(fake.updates).toEqual([]);
	});

	test('updates a scene in place; a number field gets a plain number', async () => {
		const fake = fakeNotion('number');
		const writer = createStoryWriter({ api: fake.api, record, episodePageId: 'ep1' });
		expect(await writer.writeScene({ ...scene, page_id: 'sc1', dialogue: '' })).toMatchObject({ ok: true, action: 'updated', page_id: 'sc1' });
		expect(fake.updates[0][1]['Scene #']).toEqual({ number: 20 });
	});

	test('story beats for the season and outlines for any episode', async () => {
		const fake = fakeNotion();
		const writer = createStoryWriter({ api: fake.api, record, episodePageId: 'ep1' });
		const beat = await writer.writeStoryBeat({ title: 'Bryce arrives', section: 'B Story', order: 7, summary: 'Bryce walks into Video Haven.', episode_page_id: 'ep2' });
		expect(beat).toMatchObject({ ok: true, action: 'created', kind: 'story beat' });
		expect(fake.creates[0][0]).toBe('src-beats');
		const outline = await writer.writeEpisodeOutline({ episode_page_id: 'ep2', outline: 'Act 1: Bryce arrives.', cliffhanger: 'Bryce smiles.' });
		expect(outline).toMatchObject({ ok: true, kind: 'episode', title: 'Two' });
		expect(fake.updates.at(-1)![1]).toEqual({ 'Episode outline': richText('Act 1: Bryce arrives.'), Cliffhanger: richText('Bryce smiles.') });
		// A beat created in this chat can be linked from a scene right away.
		expect(await writer.writeScene({ ...scene, story_beat_page_ids: [(beat as { page_id: string }).page_id] })).toMatchObject({ ok: true });
	});

	test('long text is split into 2000-character pieces', () => {
		expect(richText('x'.repeat(4500)).rich_text.map((piece) => piece.text.content.length)).toEqual([2000, 2000, 500]);
	});
});
