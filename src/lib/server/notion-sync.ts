import { bareId, toEpisode, toScene, toShot, type NotionPage, type SeriesShot } from '$lib/domain/notion-series';
import { episodeCode, formatShotCode, shotNumberText } from '$lib/domain/shot-codes';
import type { Project, StoryCard } from '$lib/domain/schemas';
import type { ProjectCommandGateway } from '$lib/application/gateway';
import type { NotionApi } from '$lib/server/notion';
import type { SeriesRecord } from '$lib/server/series';

/**
 * The app → Notion sync (V1S-325, ADR 0002). Deterministic, no LLM. The app owns the codes: Show code,
 * Episode code, Scene code, Shot code, Shot # and Locked are written wherever Notion shows something else
 * (so a value typed over in Notion is restored). A shot's plain fields (description, duration, dialogue line,
 * refs) sync both ways against the values of the last sync: changed in Notion since then → Notion wins and
 * the board takes it; otherwise the board's value is written. Shots that exist only on the board (Fit's)
 * are created in Notion. Prompts never leave the app.
 */

export interface NotionSyncReport { episodes: number; scenes: number; shots_updated: number; shots_created: number; pulled: number }
export interface PlainFields { description: string; duration_s: number; dialogue: string; refs: string }
export interface CardSync { card_id: string; notion_page_id: string; scene_page_id: string; synced: PlainFields; pulled: Partial<PlainFields> }

const rich = (value: string) => ({ rich_text: value ? [{ type: 'text', text: { content: value.slice(0, 2000) } }] : [] });
const title = (value: string) => ({ title: [{ type: 'text', text: { content: value.slice(0, 2000) } }] });

async function all(api: NotionApi, source: string): Promise<NotionPage[]> {
	const out: NotionPage[] = [];
	let cursor: string | undefined;
	for (let guard = 0; guard < 100; guard++) {
		const page = await api.query(source, cursor);
		out.push(...page.results);
		if (!page.has_more || !page.next_cursor) break;
		cursor = page.next_cursor;
	}
	return out;
}

/** A card's plain fields as the board has them (imported shots keep theirs in `source`, Fit's in `fit`). */
export function boardFields(card: StoryCard): PlainFields {
	return {
		description: card.beat,
		duration_s: Math.round(card.duration_ms / 100) / 10,
		dialogue: card.source?.dialogue ?? card.fit?.dialogue ?? '',
		refs: card.source?.refs ?? card.fit?.refs ?? ''
	};
}
const notionFields = (shot: SeriesShot): PlainFields => ({ description: shot.description, duration_s: Math.round(shot.duration_s * 10) / 10, dialogue: shot.dialogue, refs: shot.refs });
const FIELDS: Array<keyof PlainFields> = ['description', 'duration_s', 'dialogue', 'refs'];
const NOTION_PROP: Record<keyof PlainFields, string> = { description: 'Description', duration_s: 'Duration (s)', dialogue: 'Dialogue / VO', refs: 'Seedance Refs' };
const toProp = (field: keyof PlainFields, value: string | number) => (field === 'duration_s' ? { number: value as number } : rich(value as string));

/**
 * The three-way rule for one shot: which fields the board takes from Notion, and which Notion takes from the
 * board. A field without a last-synced value (never synced) is written from the board.
 */
export function mergeFields(board: PlainFields, notion: PlainFields, last: PlainFields | undefined): { pull: Partial<PlainFields>; push: Partial<PlainFields>; synced: PlainFields } {
	const pull: Partial<PlainFields> = {}, push: Partial<PlainFields> = {};
	const synced = { ...board };
	for (const field of FIELDS) {
		if (board[field] === notion[field]) continue;
		if (last && notion[field] !== last[field]) { (pull as Record<string, unknown>)[field] = notion[field]; (synced as Record<string, unknown>)[field] = notion[field]; }
		else (push as Record<string, unknown>)[field] = board[field];
	}
	return { pull, push, synced };
}

/** Sync one series and its imported episodes with Notion. `readProject` / `gateway` reach the episode projects. */
export async function syncSeriesToNotion(api: NotionApi, record: SeriesRecord, readProject: (id: string) => Promise<Project | null>, gateway: ProjectCommandGateway): Promise<NotionSyncReport> {
	const report: NotionSyncReport = { episodes: 0, scenes: 0, shots_updated: 0, shots_created: 0, pulled: 0 };
	if (!record.sources.episodes || !record.sources.scenes || !record.sources.shots) return report;
	const locked = Boolean(record.codes_locked_at);
	const show = record.show_code ?? '';

	// Episodes: Show code, Episode code, Locked.
	for (const episode of (await all(api, record.sources.episodes)).map(toEpisode)) {
		const want = { show, episode: episodeCode(episode.season, episode.number) };
		const have = episode.notion_codes;
		if (have.show === want.show && have.episode === want.episode && have.locked === locked) continue;
		await api.updatePage(episode.page_id, { 'Show code': rich(want.show), 'Episode code': rich(want.episode), Locked: { checkbox: locked } });
		report.episodes++;
	}

	// Shot # is padded text ("0010") in template v3, a plain number before.
	const shotNumberIsText = (await api.dataSource(record.sources.shots)).properties['Shot #']?.type === 'rich_text';
	const shotNo = (n: number) => (shotNumberIsText ? rich(shotNumberText(n)) : { number: n });
	const scenePages = new Map((await all(api, record.sources.scenes)).map(toScene).map((scene) => [scene.page_id, scene]));
	const shotPages = new Map((await all(api, record.sources.shots)).map(toShot).map((shot) => [shot.page_id, shot]));

	for (const [episodePageId, projectId] of Object.entries(record.episode_projects)) {
		const project = await readProject(projectId);
		if (!project?.series) continue;
		const series = project.series;
		const epCode = episodeCode(series.season ?? null, series.episode_number);

		// Scenes: Scene code, Locked.
		for (const scene of series.scenes) {
			const page = scenePages.get(bareId(scene.page_id));
			if (!page || !scene.code) continue;
			if (page.notion_codes.scene === scene.code && page.notion_codes.locked === locked) continue;
			await api.updatePage(page.page_id, { 'Scene code': rich(scene.code), Locked: { checkbox: locked } });
			report.scenes++;
		}

		// Shots: codes always from the board; plain fields both ways; board-only shots created.
		const updates: CardSync[] = [];
		for (const card of project.production.cards) {
			const scene = series.scenes.find((entry) => entry.group_id === card.group_id);
			if (!scene) continue;
			const code = show && scene.code && card.shot_number ? formatShotCode({ show, episode: epCode, scene: scene.code, shot: card.shot_number }) : '';
			const board = boardFields(card);
			const page = card.source?.notion_page_id ? shotPages.get(bareId(card.source.notion_page_id)) : undefined;
			if (page) {
				const { pull, push, synced } = mergeFields(board, notionFields(page), card.source?.synced);
				const props: Record<string, unknown> = {};
				for (const [field, value] of Object.entries(push) as Array<[keyof PlainFields, string | number]>) props[NOTION_PROP[field]] = toProp(field, value);
				if (code && page.notion_codes.shot !== code) props['Shot code'] = rich(code);
				if (card.shot_number && page.notion_codes.shot_number !== card.shot_number) props['Shot #'] = shotNo(card.shot_number);
				if (page.notion_codes.locked !== locked) props.Locked = { checkbox: locked };
				if (Object.keys(props).length) { await api.updatePage(page.page_id, props); report.shots_updated++; }
				if (Object.keys(pull).length) report.pulled++;
				const same = card.source?.synced && FIELDS.every((field) => card.source!.synced![field] === synced[field]);
				if (!same || Object.keys(pull).length) updates.push({ card_id: card.card_id, notion_page_id: page.page_id, scene_page_id: scene.page_id, synced, pulled: pull });
			} else {
				const created = await api.createPage(record.sources.shots, {
					Shot: title(code || card.title), Scene: { relation: [{ id: scene.page_id }] }, Episode: { relation: [{ id: episodePageId }] },
					Description: rich(board.description), 'Duration (s)': { number: board.duration_s }, 'Dialogue / VO': rich(board.dialogue), 'Seedance Refs': rich(board.refs),
					'Shot code': rich(code), ...(card.shot_number ? { 'Shot #': shotNo(card.shot_number) } : {}), Locked: { checkbox: locked }
				});
				report.shots_created++;
				updates.push({ card_id: card.card_id, notion_page_id: bareId(created.id), scene_page_id: scene.page_id, synced: board, pulled: {} });
			}
		}
		if (updates.length) {
			const outcome = await gateway.applyNotionSync(project.project_id, project.version, updates);
			if (!outcome.ok) throw new Error(`${series.episode_title}: ${outcome.error.message}`);
		}
	}
	return report;
}
