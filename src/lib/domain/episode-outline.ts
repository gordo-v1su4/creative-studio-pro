import type { Project, StoryCard } from '$lib/domain/schemas';
import { plannedMinutes } from '$lib/domain/notion-series';

/**
 * The Episode outline the Story tab shows for an episode imported from Notion: its acts in order, each
 * scene's share of the target length (from the scene's timecode, scaled to 10 / 15 / 30 min), the shot
 * time the board holds for it now, and who appears where. Read from the live board, so edits show at once.
 */
export type OutlineSeries = Pick<NonNullable<Project['series']>, 'episode_number' | 'episode_title' | 'scenes'>;
export type OutlineCard = Pick<StoryCard, 'card_id' | 'duration_ms' | 'benched' | 'source'> & { group_id?: string };

export interface OutlineSceneRow {
	page_id: string; number: number; title: string; act: string; summary: string; story_beats: string; timecode: string; location: string;
	group_id: string; characters: string[]; shots: number; shot_s: number; target_s: number;
}
export interface OutlineAct { act: string; target_s: number; shot_s: number; scenes: OutlineSceneRow[] }
export interface EpisodeOutline {
	target_s: number; shot_s: number; gap_s: number; fill: number;
	acts: OutlineAct[];
	/** Everyone who appears, most scenes first. */
	characters: Array<{ name: string; scenes: number }>;
}

const ACT_ORDER = ['Teaser', 'Act 1', 'Act 2', 'Act 3', 'Act 4', 'Act 5', 'Tag', ''];
const actRank = (act: string) => { const i = ACT_ORDER.indexOf(act); return i < 0 ? ACT_ORDER.length : i; };

export function episodeOutline(series: OutlineSeries, cards: OutlineCard[], targetMinutes: number): EpisodeOutline {
	const target_s = Math.round(targetMinutes * 60);
	const scenes = [...series.scenes].sort((a, b) => actRank(a.act) - actRank(b.act) || a.number - b.number);

	// Each scene's weight: its planned minutes, else its imported shot length, else an equal share.
	const planned = scenes.map((scene) => plannedMinutes(scene.timecode));
	const byShots = scenes.map((scene) => scene.seconds / 60);
	const weights = planned.every((value) => value === null)
		? (byShots.some((value) => value > 0) ? byShots : scenes.map(() => 1))
		: planned.map((value, i) => value ?? byShots[i]);
	const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
	const targets = weights.map((weight) => Math.round((weight / total) * target_s));
	// Rounding drift goes to the longest scene, so the acts add up to the episode exactly.
	if (targets.length) targets[weights.indexOf(Math.max(...weights))] += target_s - targets.reduce((sum, value) => sum + value, 0);

	const live = cards.filter((card) => !card.benched);
	const rows: OutlineSceneRow[] = scenes.map((scene, i) => {
		const own = live.filter((card) => card.group_id === scene.group_id);
		const characters = [...scene.characters];
		for (const name of own.flatMap((card) => card.source?.characters ?? [])) if (!characters.includes(name)) characters.push(name);
		return {
			page_id: scene.page_id, number: scene.number, title: scene.title, act: scene.act || 'Unassigned', summary: scene.summary, story_beats: scene.story_beats,
			timecode: scene.timecode, location: scene.location, group_id: scene.group_id, characters,
			shots: own.length, shot_s: Math.round(own.reduce((sum, card) => sum + card.duration_ms, 0) / 100) / 10, target_s: targets[i]
		};
	});

	const acts: OutlineAct[] = [];
	for (const row of rows) {
		let act = acts.at(-1);
		if (act?.act !== row.act) { act = { act: row.act, target_s: 0, shot_s: 0, scenes: [] }; acts.push(act); }
		act.scenes.push(row); act.target_s += row.target_s; act.shot_s += row.shot_s;
	}

	const counts = new Map<string, number>();
	for (const row of rows) for (const name of row.characters) counts.set(name, (counts.get(name) ?? 0) + 1);
	const characters = [...counts.entries()].map(([name, scenes]) => ({ name, scenes })).sort((a, b) => b.scenes - a.scenes || a.name.localeCompare(b.name));

	const shot_s = Math.round(rows.reduce((sum, row) => sum + row.shot_s, 0) * 10) / 10;
	return { target_s, shot_s, gap_s: Math.max(0, Math.round((target_s - shot_s) * 10) / 10), fill: target_s ? shot_s / target_s : 0, acts, characters };
}

/** "5:30" from seconds. */
export function clockOf(seconds: number): string {
	const whole = Math.round(seconds);
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
