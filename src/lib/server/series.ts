import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { uuid7ish } from '$lib/domain/ids';
import { episodeToBoard, type EpisodeLayout } from '$lib/domain/notion-series';
import type { Project } from '$lib/domain/schemas';
import type { ProjectCommandGateway } from '$lib/application/gateway';
import { readEpisode, readSeries, type NotionApi } from '$lib/server/notion';

/**
 * A series connected from Notion: its root page, the databases found under it, the template check, the
 * season story and the episode list (a cache of Notion, refreshed on demand), the episode length to plan
 * for, and which project each imported episode became. Stored beside the projects, never inside one.
 */
const checkSchema = z.object({ ok: z.boolean(), missing: z.array(z.string()), wrongType: z.array(z.string()), optionalMissing: z.array(z.string()) });
export const seriesRecordSchema = z.object({
	schema_version: z.literal(1),
	series_id: z.string().min(1).max(64),
	title: z.string().min(1).max(300),
	notion_root_id: z.string().min(1).max(64),
	sources: z.object({ episodes: z.string().nullable(), scenes: z.string().nullable(), shots: z.string().nullable() }),
	/** The databases behind the sources (page ids, for links into Notion); absent on records read before 2026-10-05. */
	databases: z.object({ episodes: z.string().nullable(), scenes: z.string().nullable(), shots: z.string().nullable() }).optional(),
	checks: z.object({ episodes: checkSchema, scenes: checkSchema, shots: checkSchema }),
	story: z.object({ page_id: z.string(), title: z.string(), text: z.string() }).nullable(),
	episodes: z.array(z.object({
		page_id: z.string(), number: z.number(), title: z.string(), status: z.string(), act: z.string(), season: z.number().nullable(),
		summary: z.string(), twist: z.string(), cliffhanger: z.string(), scene_ids: z.array(z.string()), scene_count: z.number()
	})),
	/** The episode length to plan for: 10, 15 or 30 minutes. */
	runtime_min: z.number().int().positive().max(120),
	/** Notion episode page id → the project it was imported as. */
	episode_projects: z.record(z.string(), z.string()),
	checked_at: z.string(),
	created_at: z.string()
});
export type SeriesRecord = z.infer<typeof seriesRecordSchema>;

export class SeriesStore {
	constructor(private readonly folder: string) {}
	static beside(projectRoot: string) { return new SeriesStore(join(dirname(projectRoot), 'series')); }
	private path(id: string) { return join(this.folder, `${id.replace(/[^a-z0-9-]/gi, '')}.json`); }
	async list(): Promise<SeriesRecord[]> {
		let names: string[] = [];
		try { names = await readdir(this.folder); } catch { return []; }
		const records = await Promise.all(names.filter((name) => name.endsWith('.json')).map((name) => this.read(name.slice(0, -5))));
		return records.filter((record): record is SeriesRecord => record !== null).sort((a, b) => a.title.localeCompare(b.title));
	}
	async read(id: string): Promise<SeriesRecord | null> {
		try { return seriesRecordSchema.parse(JSON.parse(await readFile(this.path(id), 'utf8'))); } catch { return null; }
	}
	async write(record: SeriesRecord): Promise<SeriesRecord> {
		const valid = seriesRecordSchema.parse(record);
		await mkdir(this.folder, { recursive: true });
		const target = this.path(valid.series_id);
		await writeFile(`${target}.tmp`, JSON.stringify(valid, null, '\t'));
		await rename(`${target}.tmp`, target);
		return valid;
	}
}

/** The series title: the root page's title, else the story page's, else a plain fallback. */
const titleFrom = (rootTitle: string | null, story: SeriesRecord['story']) => rootTitle?.trim() || story?.title.replace(/\s*[—-].*$/, '').trim() || 'Notion series';

/** Connect (or re-check) a series from its Notion root page. */
export async function connectSeries(api: NotionApi, store: SeriesStore, rootId: string, rootTitle: string | null): Promise<SeriesRecord> {
	const read = await readSeries(api, rootId);
	const existing = await store.read(read.root_id);
	const now = new Date().toISOString();
	return store.write({
		schema_version: 1, series_id: read.root_id, title: titleFrom(rootTitle, read.story), notion_root_id: read.root_id,
		sources: read.sources, databases: read.databases, checks: read.checks, story: read.story,
		episodes: read.episodes.map(({ scene_count, ...episode }) => ({ ...episode, scene_count })),
		runtime_min: existing?.runtime_min ?? 10, episode_projects: existing?.episode_projects ?? {},
		checked_at: now, created_at: existing?.created_at ?? now
	});
}

export interface ImportResult { project: Project; layout: EpisodeLayout; record: SeriesRecord }

/** Import one episode as a new project: a board group per scene, a beat per shot, and the scene outline. */
export async function importEpisode(api: NotionApi, store: SeriesStore, gateway: ProjectCommandGateway, record: SeriesRecord, episodePageId: string): Promise<ImportResult> {
	if (!record.checks.episodes.ok || !record.checks.scenes.ok || !record.checks.shots.ok) throw new Error('The series does not match the template yet; fix what the check lists, then re-check');
	const layout = await readEpisode(api, record.sources, episodePageId);
	const { episode } = layout;
	const created = await gateway.createProject({ command: 'create_project', title: `${record.title} · ${episode.title}`.slice(0, 200), brief: episode.summary.slice(0, 5000), creative_focus: 'full room', created_by: 'notion-import' });
	if (!created.ok) throw new Error(created.error.message);
	const now = new Date().toISOString();
	const board = episodeToBoard(layout, uuid7ish, now);
	const imported = await gateway.importEpisode(created.data.project_id, created.data.version, {
		series: {
			series_id: record.series_id, episode_page_id: episode.page_id, episode_number: episode.number, episode_title: episode.title.slice(0, 300),
			summary: episode.summary.slice(0, 8000), twist: episode.twist.slice(0, 4000), cliffhanger: episode.cliffhanger.slice(0, 4000), imported_at: now,
			scenes: board.outline.map((scene) => ({ ...scene, title: scene.title.slice(0, 300), summary: scene.summary.slice(0, 8000), story_beats: scene.story_beats.slice(0, 8000), timecode: scene.timecode.slice(0, 200), location: scene.location.slice(0, 400) }))
		},
		groups: board.groups, cards: board.cards, title: episode.title.slice(0, 200), logline: episode.summary.slice(0, 2000)
	});
	if (!imported.ok) throw new Error(imported.error.message);
	const saved = await store.write({ ...record, episode_projects: { ...record.episode_projects, [episode.page_id]: imported.data.project_id } });
	return { project: imported.data, layout, record: saved };
}
