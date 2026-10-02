import { describe, expect, test } from 'bun:test';
import { episodeOutline, type OutlineCard, type OutlineSeries } from '../../src/lib/domain/episode-outline';

// Shaped like EP01: a 2-min teaser, two Act 1 scenes, a Tag; the timecodes plan for 6.5 min.
const scene = (n: number, act: string, timecode: string, characters: string[], seconds: number, shots: number) => ({
	page_id: `scene-${n}`, number: n, title: `P${String(n).padStart(2, '0')} — Scene ${n}`, act, summary: `Scene ${n} summary`, story_beats: '', timecode,
	location: `Place ${n}`, characters, group_id: `group-${n}`, seconds, shot_count: shots
});
const series: OutlineSeries = {
	episode_number: 1, episode_title: 'EP01 — The Late Shift',
	scenes: [
		scene(1, 'Teaser', '0:00–2:00 (Teaser)', ['Kai', 'Mara'], 40, 2),
		scene(2, 'Act 1', 'Act 1 · ~1:30', ['Kai'], 17, 1),
		scene(3, 'Act 1', 'Act 1 · ~2:00', ['Mara', 'Lucian'], 15, 1),
		scene(13, 'Tag', 'Tag · ~1:00', ['Mara'], 15, 1)
	]
};
const card = (id: string, group: string, seconds: number, extra: Partial<OutlineCard> = {}): OutlineCard => ({ card_id: id, group_id: group, duration_ms: seconds * 1000, ...extra });
const cards: OutlineCard[] = [
	card('a', 'group-1', 20, { source: { notion_page_id: 'x', scene_page_id: 'scene-1', characters: ['Malachi'] } }),
	card('b', 'group-1', 20),
	card('c', 'group-2', 17),
	card('d', 'group-3', 15),
	card('e', 'group-13', 15),
	card('f', 'group-3', 9, { benched: true }),
	card('g', undefined as unknown as string, 5)
];

describe('episode outline', () => {
	test('acts in order, each scene budgeted from its timecode and scaled to the target length', () => {
		const outline = episodeOutline(series, cards, 10);
		expect(outline.target_s).toBe(600);
		expect(outline.acts.map((act) => act.act)).toEqual(['Teaser', 'Act 1', 'Tag']);
		// 2 + 1.5 + 2 + 1 = 6.5 planned minutes → ×(10 / 6.5)
		const [teaser, act1, tag] = outline.acts;
		expect(teaser.scenes[0].target_s).toBe(Math.round((2 / 6.5) * 600));
		expect(act1.scenes.map((s) => s.target_s)).toEqual([Math.round((1.5 / 6.5) * 600), Math.round((2 / 6.5) * 600)]);
		expect(tag.target_s).toBe(Math.round((1 / 6.5) * 600));
		// Act targets add up to the episode exactly (rounding goes to the longest scene).
		expect(outline.acts.reduce((sum, act) => sum + act.target_s, 0)).toBe(600);
	});

	test('shot time comes from the live board: benched beats and beats outside the episode groups do not count', () => {
		const outline = episodeOutline(series, cards, 10);
		const act1 = outline.acts[1];
		expect(act1.scenes[1]).toMatchObject({ shot_s: 15, shots: 1 });
		expect(outline.shot_s).toBe(87);
		expect(outline.gap_s).toBe(600 - 87);
		expect(outline.fill).toBeCloseTo(87 / 600, 5);
	});

	test('characters per scene join the Notion scene list and the shots, and the episode lists who appears where', () => {
		const outline = episodeOutline(series, cards, 15);
		expect(outline.acts[0].scenes[0].characters).toEqual(['Kai', 'Mara', 'Malachi']);
		expect(outline.characters[0]).toEqual({ name: 'Mara', scenes: 3 });
		expect(outline.characters.map((c) => c.name)).toEqual(['Mara', 'Kai', 'Lucian', 'Malachi']);
	});

	test('scenes with no usable timecode share the time by their shot length, else equally', () => {
		const loose: OutlineSeries = { ...series, scenes: [scene(1, '', 'whenever', [], 30, 1), scene(2, '', '', [], 10, 1)] };
		const outline = episodeOutline(loose, [], 10);
		expect(outline.acts.map((act) => act.act)).toEqual(['Unassigned']);
		expect(outline.acts[0].scenes.map((s) => s.target_s)).toEqual([450, 150]);
		const empty = episodeOutline({ ...series, scenes: [scene(1, 'Act 1', '', [], 0, 0), scene(2, 'Act 1', '', [], 0, 0)] }, [], 10);
		expect(empty.acts[0].scenes.map((s) => s.target_s)).toEqual([300, 300]);
	});
});
