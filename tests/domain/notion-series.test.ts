import { describe, expect, test } from 'bun:test';
import { actBudget, actOf, checkDatabase, layoutEpisode, plannedMinutes, toEpisode, toScene, toShot, type NotionPage } from '../../src/lib/domain/notion-series';

const text = (value: string) => [{ plain_text: value }];
const title = (value: string) => ({ type: 'title' as const, title: text(value) });
const rich = (value: string) => ({ type: 'rich_text' as const, rich_text: text(value) });
const num = (value: number) => ({ type: 'number' as const, number: value });
const sel = (value: string) => ({ type: 'select' as const, select: { name: value } });
const rel = (...ids: string[]) => ({ type: 'relation' as const, relation: ids.map((id) => ({ id })) });

// Shaped like the Blood Rush rows (EP01 → P01 teaser, P02 Act 1, P13 Tag), with dashed ids as the API returns them.
const EP = 'aaaaaaaa-0000-0000-0000-000000000001';
const episode: NotionPage = { id: EP, properties: { Title: title('EP01 — The Late Shift'), 'Episode #': num(1), Status: sel('Shot List'), Act: sel('RUSH'), Summary: rich('Kai breaks blood law.'), Cliffhanger: rich('"Who turned her?"'), Scenes: rel('bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000013') } };
const scene = (n: number, name: string, timecode: string): NotionPage => ({ id: `bbbbbbbb-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`, properties: { Scene: title(name), 'Scene #': num(n), Timecode: rich(timecode), Summary: rich(`${name} summary`), Episode: rel(EP), Characters: { type: 'multi_select', multi_select: [{ name: 'Kai' }, { name: 'Mara' }] } } });
const shot = (sceneN: number, n: number, seconds: number): NotionPage => ({ id: `cccccccc-0000-0000-00${String(sceneN).padStart(2, '0')}-0000000000${String(n).padStart(2, '0')}`, properties: { Shot: title(`E01 S${sceneN} SH${n}`), 'Shot #': num(n), Scene: rel(`bbbbbbbb-0000-0000-0000-0000000000${String(sceneN).padStart(2, '0')}`), Description: rich(`shot ${n}`), 'Duration (s)': num(seconds), 'Video Prompt (Seedance 2.5)': rich(`prompt ${n}`), 'Dialogue / VO': rich(n === 1 ? '"Who turned her?"' : '') } });

describe('Notion series template', () => {
	test('a database passes when every required property exists with the right type', () => {
		const schema = { Title: { type: 'title' }, 'Episode #': { type: 'number' }, Summary: { type: 'rich_text' }, Scenes: { type: 'relation' }, Status: { type: 'status' } };
		expect(checkDatabase('episodes', schema)).toMatchObject({ ok: true, missing: [], wrongType: [] });
		const broken = checkDatabase('episodes', { Title: { type: 'title' }, 'Episode #': { type: 'rich_text' }, Scenes: { type: 'relation' } });
		expect(broken.ok).toBeFalse();
		expect(broken.missing).toEqual(['Episodes · Summary']);
		expect(broken.wrongType[0]).toContain('Episode # is rich_text');
		expect(checkDatabase('shots', null).missing).toEqual(['the Shots database']);
	});

	test('acts and planned minutes come from scene timecodes', () => {
		expect(actOf('0:00–2:00 (Teaser)')).toBe('Teaser');
		expect(actOf('Act 2 · ~3:00')).toBe('Act 2');
		expect(actOf('Tag · ~0:45')).toBe('Tag');
		expect(plannedMinutes('Act 1 · ~1:30')).toBe(1.5);
		expect(plannedMinutes('0:00–2:00 (Teaser)')).toBe(2);
		expect(plannedMinutes('whenever')).toBeNull();
	});

	test('an episode lays out in act order with its shots, and budgets scale to the target length', () => {
		const scenes = [scene(13, 'P13 — Mara’s Dorm (Tag)', 'Tag · ~0:45'), scene(2, 'P02 — Morning Quad', 'Act 1 · ~1:30'), scene(1, 'P01 — 2:47 AM (Teaser)', '0:00–2:00 (Teaser)')].map(toScene);
		const shots = [shot(2, 2, 8), shot(2, 1, 9), shot(1, 1, 40), shot(13, 1, 15)].map(toShot);
		const layout = layoutEpisode(toEpisode(episode), scenes, shots);
		expect(layout.episode).toMatchObject({ number: 1, title: 'EP01 — The Late Shift', status: 'Shot List', page_id: EP.replace(/-/g, '') });
		expect(layout.scenes.map((s) => s.act)).toEqual(['Teaser', 'Act 1', 'Tag']);
		expect(layout.scenes[1].shots.map((s) => s.title)).toEqual(['E01 S2 SH1', 'E01 S2 SH2']);
		expect(layout.scenes[0].characters).toEqual(['Kai', 'Mara']);
		expect(layout.seconds).toBe(72);
		// Planned 2 + 1.5 + 0.75 = 4.25 min; at 10 minutes each act gets its share.
		const budget = actBudget(layout, 10);
		expect(budget.map((b) => b.act)).toEqual(['Teaser', 'Act 1', 'Tag']);
		expect(budget[0].target_s).toBe(Math.round((2 / 4.25) * 600));
		expect(budget.reduce((sum, b) => sum + b.target_s, 0)).toBeCloseTo(600, -1);
		expect(budget[1].shot_s).toBe(17);
	});
});
