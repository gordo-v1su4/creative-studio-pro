import { bareId } from '$lib/domain/notion-series';
import { dialogueLines } from '$lib/domain/scene-check';
import { SAVE_THE_CAT, TV_EPISODE } from '$lib/domain/structures';
import type { NotionApi } from './notion';
import type { SeriesRecord } from './series';

/**
 * The Agent panel's Notion writes (V1S-324): season story beats, episode outlines and scenes (Action,
 * Dialogue, links), limited to the connected series' pages. Deterministic and checked here, not trusted to
 * the model: it never writes codes, Scene # comes in tens, titles are names only, Dialogue must be
 * `SPEAKER (delivery): "line"`. Scenes only for the episode being made (the project's episode).
 */

export interface StoryWriterScope {
	api: NotionApi;
	record: SeriesRecord;
	/** The project's episode: the only one whose scenes may be written. */
	episodePageId: string | null;
}

export interface WriteResult { ok: true; action: 'created' | 'updated'; kind: 'story beat' | 'episode' | 'scene'; title: string; page_id: string; url: string }
export interface WriteRefusal { ok: false; error: string }

export const notionUrl = (pageId: string) => `https://www.notion.so/${bareId(pageId)}`;

/** Notion caps one rich-text piece at 2000 characters; longer text goes in several pieces. */
export function richText(value: string) {
	const pieces: string[] = [];
	for (let at = 0; at < value.length && pieces.length < 50; at += 2000) pieces.push(value.slice(at, at + 2000));
	return { rich_text: pieces.map((content) => ({ type: 'text', text: { content } })) };
}
const titleProp = (value: string) => ({ title: [{ type: 'text', text: { content: value.slice(0, 2000) } }] });
const relation = (ids: string[]) => ({ relation: [...new Set(ids)].map((id) => ({ id })) });
const select = (name: string) => ({ select: name ? { name } : null });

/** A code or an old-convention prefix in a title ("P01 — …", "010 PAR — …", "BLR_EP101_…"): titles are names only. */
const CODED_TITLE = /^\s*(?:P\d+\s*[—–-]|\d{2,3}\s+[A-Z]{3}\s*[—–-]|[A-Z]{3}_EP\d)/;

export function createStoryWriter(scope: StoryWriterScope) {
	const { api, record } = scope;
	// Pages created in this chat count as the series' own (the record is refreshed on the next Sync).
	const createdScenes = new Map<string, string>();
	const createdBeats = new Set<string>();
	const beatScenes = new Map((record.story_beats?.beats ?? []).map((beat) => [beat.page_id, [...beat.scene_ids]]));
	let storyBeatsSource: string | null | undefined;
	let sceneNumberIsText: boolean | undefined;

	const episode = (id: string) => record.episodes.find((entry) => entry.page_id === bareId(id)) ?? null;
	const sceneEpisode = (id: string) => createdScenes.get(bareId(id)) ?? record.episodes.find((entry) => entry.scene_ids.includes(bareId(id)))?.page_id ?? null;
	const isBeat = (id: string) => createdBeats.has(bareId(id)) || beatScenes.has(bareId(id));
	const isReference = (id: string) => (record.references?.items ?? []).some((ref) => ref.page_id === bareId(id));

	async function beatsSource(): Promise<string | null> {
		if (storyBeatsSource !== undefined) return storyBeatsSource;
		const database = record.story_beats?.database;
		storyBeatsSource = database ? ((await api.database(database)).data_sources?.[0]?.id ?? null) : null;
		return storyBeatsSource;
	}

	function checkTitle(title: string): string | null {
		if (!title.trim()) return 'The title is empty';
		if (CODED_TITLE.test(title)) return `Titles are names only ("Morning Quad"); the app writes codes. Drop the prefix from "${title}"`;
		return null;
	}

	async function linkBeatToScene(beatId: string, sceneId: string) {
		const scenes = beatScenes.get(beatId) ?? [];
		if (scenes.includes(sceneId)) return;
		scenes.push(sceneId);
		beatScenes.set(beatId, scenes);
		await api.updatePage(beatId, { Scenes: relation(scenes) });
	}

	return {
		async writeStoryBeat(input: { page_id?: string; title: string; section: string; order?: number; summary: string; episode_page_id?: string }): Promise<WriteResult | WriteRefusal> {
			const bad = checkTitle(input.title);
			if (bad) return { ok: false, error: bad };
			if (!SAVE_THE_CAT.sections.includes(input.section)) return { ok: false, error: `Section must be a Save the Cat section: ${SAVE_THE_CAT.sections.join(', ')}` };
			if (input.episode_page_id && !episode(input.episode_page_id)) return { ok: false, error: 'That episode is not in this series' };
			const props: Record<string, unknown> = {
				Beat: titleProp(input.title.trim()), Section: select(input.section), Summary: richText(input.summary.trim()),
				...(input.order !== undefined ? { Order: { number: input.order } } : {}),
				...(input.episode_page_id ? { Episode: relation([bareId(input.episode_page_id)]) } : {})
			};
			if (input.page_id) {
				if (!isBeat(input.page_id)) return { ok: false, error: 'That story beat is not in this series' };
				await api.updatePage(bareId(input.page_id), props);
				return { ok: true, action: 'updated', kind: 'story beat', title: input.title.trim(), page_id: bareId(input.page_id), url: notionUrl(input.page_id) };
			}
			const source = await beatsSource();
			if (!source) return { ok: false, error: 'This series has no Story Beats database (template v2+)' };
			const { id } = await api.createPage(source, props);
			createdBeats.add(bareId(id));
			beatScenes.set(bareId(id), []);
			return { ok: true, action: 'created', kind: 'story beat', title: input.title.trim(), page_id: bareId(id), url: notionUrl(id) };
		},

		async writeEpisodeOutline(input: { episode_page_id: string; outline: string; summary?: string; twist?: string; cliffhanger?: string }): Promise<WriteResult | WriteRefusal> {
			const found = episode(input.episode_page_id);
			if (!found) return { ok: false, error: 'That episode is not in this series' };
			if (!input.outline.trim()) return { ok: false, error: 'The outline is empty' };
			await api.updatePage(found.page_id, {
				'Episode outline': richText(input.outline.trim()),
				...(input.summary !== undefined ? { Summary: richText(input.summary.trim()) } : {}),
				...(input.twist !== undefined ? { 'Mid-Episode Twist': richText(input.twist.trim()) } : {}),
				...(input.cliffhanger !== undefined ? { Cliffhanger: richText(input.cliffhanger.trim()) } : {})
			});
			return { ok: true, action: 'updated', kind: 'episode', title: found.title, page_id: found.page_id, url: notionUrl(found.page_id) };
		},

		async writeScene(input: {
			page_id?: string; episode_page_id: string; title: string; number: number; section: string; summary: string;
			action: string; dialogue: string; location?: string; characters?: string[];
			story_beat_page_ids?: string[]; reference_page_ids?: string[];
		}): Promise<WriteResult | WriteRefusal> {
			const bad = checkTitle(input.title);
			if (bad) return { ok: false, error: bad };
			const ep = episode(input.episode_page_id);
			if (!ep) return { ok: false, error: 'That episode is not in this series' };
			if (scope.episodePageId && ep.page_id !== bareId(scope.episodePageId)) return { ok: false, error: 'Scenes are written only for the episode being made (this project\'s episode); give other episodes an outline instead' };
			if (!Number.isInteger(input.number) || input.number <= 0 || input.number % 10 !== 0 || input.number > 990) return { ok: false, error: 'Scene # goes in tens: 10, 20, 30…' };
			if (!TV_EPISODE.sections.includes(input.section)) return { ok: false, error: `Section must be one of: ${TV_EPISODE.sections.join(', ')}` };
			const rows = input.dialogue.split('\n').map((row) => row.trim()).filter(Boolean);
			const parsed = dialogueLines(input.dialogue);
			if (parsed.length !== rows.length) return { ok: false, error: 'Every Dialogue line must read SPEAKER (delivery): "line" — one line each, the words in quotes' };
			const beats = (input.story_beat_page_ids ?? []).map(bareId);
			if (beats.some((id) => !isBeat(id))) return { ok: false, error: 'A linked story beat is not in this series' };
			const refs = (input.reference_page_ids ?? []).map(bareId);
			if (refs.some((id) => !isReference(id))) return { ok: false, error: 'A linked reference is not in this series\' References' };
			if (input.page_id && sceneEpisode(input.page_id) !== ep.page_id) return { ok: false, error: 'That scene is not in this episode' };

			if (sceneNumberIsText === undefined) sceneNumberIsText = record.sources.scenes ? (await api.dataSource(record.sources.scenes)).properties['Scene #']?.type === 'rich_text' : false;
			const props: Record<string, unknown> = {
				Scene: titleProp(input.title.trim()),
				'Scene #': sceneNumberIsText ? richText(String(input.number).padStart(3, '0')) : { number: input.number },
				Episode: relation([ep.page_id]), Section: select(input.section), Summary: richText(input.summary.trim()),
				Action: richText(input.action.trim()), Dialogue: richText(rows.join('\n')),
				...(input.location !== undefined ? { Location: richText(input.location.trim()) } : {}),
				...(input.characters ? { Characters: { multi_select: input.characters.map((name) => ({ name: name.replace(/,/g, ' ').trim().slice(0, 100) })).filter((entry) => entry.name) } } : {}),
				...(input.reference_page_ids ? { References: relation(refs) } : {})
			};
			let pageId: string;
			let action: WriteResult['action'];
			if (input.page_id) {
				pageId = bareId(input.page_id);
				await api.updatePage(pageId, props);
				action = 'updated';
			} else {
				if (!record.sources.scenes) return { ok: false, error: 'This series has no Scenes database' };
				pageId = bareId((await api.createPage(record.sources.scenes, props)).id);
				createdScenes.set(pageId, ep.page_id);
				action = 'created';
			}
			for (const beat of beats) await linkBeatToScene(beat, pageId);
			return { ok: true, action, kind: 'scene', title: input.title.trim(), page_id: pageId, url: notionUrl(pageId) };
		}
	};
}
export type StoryWriter = ReturnType<typeof createStoryWriter>;
