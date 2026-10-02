import { Client } from '@notionhq/client';
import {
	bareId, checkDatabase, layoutEpisode, toEpisode, toScene, toShot,
	type DatabaseKey, type EpisodeLayout, type NotionPage, type NotionSchema, type SeriesEpisode, type TemplateCheck
} from '$lib/domain/notion-series';

/**
 * Reads a series from Notion through the official API. The integration (NOTION_TOKEN) only sees pages the
 * operator connected to it; the operator connects one page, the series root, so this reader can never see
 * anything else. It walks from that root only: the Story page and the Episodes, Scenes and Shots databases.
 * Read-only: nothing here writes to Notion.
 */

type RichText = Array<{ plain_text?: string }>;
interface Block { id: string; type: string; has_children?: boolean; child_page?: { title: string }; child_database?: { title: string }; [key: string]: unknown }
interface Paged<T> { results: T[]; next_cursor: string | null; has_more: boolean }

/** The few Notion calls this reader needs (a seam, so it can be tested without a token). */
export interface NotionApi {
	children(blockId: string, cursor?: string): Promise<Paged<Block>>;
	database(databaseId: string): Promise<{ data_sources?: Array<{ id: string; name?: string }> }>;
	dataSource(dataSourceId: string): Promise<{ id: string; title?: RichText; properties: Record<string, { type: string }> }>;
	query(dataSourceId: string, cursor?: string): Promise<Paged<NotionPage>>;
}

export function createNotionApi(token: string): NotionApi {
	const client = new Client({ auth: token });
	return {
		children: async (blockId, cursor) => (await client.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 })) as unknown as Paged<Block>,
		database: async (databaseId) => (await client.databases.retrieve({ database_id: databaseId })) as unknown as { data_sources?: Array<{ id: string; name?: string }> },
		dataSource: async (dataSourceId) => (await client.dataSources.retrieve({ data_source_id: dataSourceId })) as unknown as { id: string; title?: RichText; properties: Record<string, { type: string }> },
		query: async (dataSourceId, cursor) => (await client.dataSources.query({ data_source_id: dataSourceId, start_cursor: cursor, page_size: 100 })) as unknown as Paged<NotionPage>
	};
}

/** A page's own title (the series root's name), or null when it has none the API shows. */
export async function pageTitle(token: string, pageId: string): Promise<string | null> {
	const page = (await new Client({ auth: token }).pages.retrieve({ page_id: pageId })) as unknown as { properties?: Record<string, { type: string; title?: RichText }> };
	const prop = Object.values(page.properties ?? {}).find((candidate) => candidate.type === 'title');
	return prop?.title ? plain(prop.title).trim() || null : null;
}

/** The 32-hex page id inside a Notion URL or id. */
export function pageIdOf(urlOrId: string): string | null {
	const match = urlOrId.replace(/-/g, '').match(/[0-9a-f]{32}(?![0-9a-f])/i);
	return match ? match[0].toLowerCase() : null;
}

async function all<T>(fetchPage: (cursor?: string) => Promise<Paged<T>>): Promise<T[]> {
	const out: T[] = [];
	let cursor: string | undefined;
	for (let guard = 0; guard < 100; guard++) {
		const page = await fetchPage(cursor);
		out.push(...page.results);
		if (!page.has_more || !page.next_cursor) break;
		cursor = page.next_cursor;
	}
	return out;
}

const plain = (rich: RichText | undefined) => (rich ?? []).map((part) => part.plain_text ?? '').join('');
const TEXT_BLOCKS = ['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'quote', 'callout', 'toggle', 'to_do'];

/** A page's text, headings marked, tables as pipe rows (two levels of nesting). */
export async function pageText(api: NotionApi, pageId: string, depth = 0): Promise<string> {
	const lines: string[] = [];
	for (const block of await all((cursor) => api.children(pageId, cursor))) {
		const body = block[block.type] as { rich_text?: RichText; cells?: RichText[] } | undefined;
		if (TEXT_BLOCKS.includes(block.type)) {
			const text = plain(body?.rich_text);
			const prefix = block.type.startsWith('heading_') ? `${'#'.repeat(Number(block.type.slice(-1)))} ` : block.type.endsWith('list_item') ? '- ' : block.type === 'quote' ? '> ' : '';
			if (text) lines.push(prefix + text);
		} else if (block.type === 'table_row') lines.push(`| ${(body?.cells ?? []).map((cell) => plain(cell)).join(' | ')} |`);
		else if (block.type === 'divider') lines.push('---');
		if (block.has_children && depth < 2 && block.type !== 'child_page' && block.type !== 'child_database') {
			const inner = await pageText(api, block.id, depth + 1);
			if (inner) lines.push(inner);
		}
	}
	return lines.join('\n');
}

export interface SeriesSources { episodes: string | null; scenes: string | null; shots: string | null }
export interface SeriesRead {
	root_id: string;
	story: { page_id: string; title: string; text: string } | null;
	sources: SeriesSources;
	checks: Record<DatabaseKey, TemplateCheck>;
	episodes: Array<SeriesEpisode & { scene_count: number }>;
}

/** Child pages and databases under the root, two page levels deep (a "Databases (raw)" page is followed). */
async function walk(api: NotionApi, rootId: string, depth = 0): Promise<{ pages: Array<{ id: string; title: string }>; databases: string[] }> {
	const pages: Array<{ id: string; title: string }> = [];
	const databases: string[] = [];
	for (const block of await all((cursor) => api.children(rootId, cursor))) {
		if (block.type === 'child_database') databases.push(block.id);
		else if (block.type === 'child_page') {
			pages.push({ id: block.id, title: block.child_page?.title ?? '' });
			if (depth < 1) { const inner = await walk(api, block.id, depth + 1); pages.push(...inner.pages); databases.push(...inner.databases); }
		}
	}
	return { pages, databases };
}

const KEY_BY_TITLE: Array<[RegExp, DatabaseKey]> = [[/^episodes?$/i, 'episodes'], [/^scenes?$/i, 'scenes'], [/^shots?$/i, 'shots']];

/** Find and check the series under a root page, and list its episodes. */
export async function readSeries(api: NotionApi, rootId: string): Promise<SeriesRead> {
	const { pages, databases } = await walk(api, rootId);
	const sources: SeriesSources = { episodes: null, scenes: null, shots: null };
	const schemas: Record<DatabaseKey, NotionSchema | null> = { episodes: null, scenes: null, shots: null };
	for (const databaseId of databases) {
		const database = await api.database(databaseId);
		for (const ref of database.data_sources ?? []) {
			const source = await api.dataSource(ref.id);
			const name = (plain(source.title) || ref.name || '').trim();
			const key = KEY_BY_TITLE.find(([pattern]) => pattern.test(name))?.[1];
			if (key && !sources[key]) { sources[key] = source.id; schemas[key] = source.properties; }
		}
	}
	const checks = { episodes: checkDatabase('episodes', schemas.episodes), scenes: checkDatabase('scenes', schemas.scenes), shots: checkDatabase('shots', schemas.shots) };
	// "Story" as a word: the season story, never a "Storyboard" page.
	const storyPage = pages.find((page) => /\bstory\b/i.test(page.title)) ?? null;
	const story = storyPage ? { page_id: bareId(storyPage.id), title: storyPage.title, text: await pageText(api, storyPage.id) } : null;
	const episodes = sources.episodes && checks.episodes.ok
		? (await all((cursor) => api.query(sources.episodes!, cursor))).map(toEpisode).map((episode) => ({ ...episode, scene_count: episode.scene_ids.length })).sort((a, b) => a.number - b.number)
		: [];
	return { root_id: bareId(rootId), story, sources, checks, episodes };
}

/** One episode with its scenes and shots, laid out (needs all three databases to pass the template). */
export async function readEpisode(api: NotionApi, sources: SeriesSources, episodePageId: string): Promise<EpisodeLayout> {
	if (!sources.episodes || !sources.scenes || !sources.shots) throw new Error('The series is missing one of its databases (Episodes, Scenes, Shots)');
	const episodes = (await all((cursor) => api.query(sources.episodes!, cursor))).map(toEpisode);
	const episode = episodes.find((candidate) => candidate.page_id === bareId(episodePageId));
	if (!episode) throw new Error('That episode is not in the series');
	const scenes = (await all((cursor) => api.query(sources.scenes!, cursor))).map(toScene);
	const shots = (await all((cursor) => api.query(sources.shots!, cursor))).map(toShot);
	return layoutEpisode(episode, scenes, shots);
}
