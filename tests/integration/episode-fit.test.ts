import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { episodeOutline } from '../../src/lib/domain/episode-outline';
import { fitPlan, fittedCards } from '../../src/lib/domain/episode-fit';
import { liveSpine } from '../../src/lib/domain/spine';
import { fitScene, fitSystemPrompt } from '../../src/lib/server/episode-fit';
import type { AgentModelClient } from '../../src/lib/server/model-provider';
import type { Project, StoryCard } from '../../src/lib/domain/schemas';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const scripted = (answers: string[]) => {
	const asked: { system: string; prompt: string }[] = [];
	const client: AgentModelClient = { choice: { provider: 'kimi', model: 'k3' } as AgentModelClient['choice'], async generate(input) { asked.push(input); return answers.shift() ?? ''; } };
	return { client, asked };
};

const G1 = '01a0fda5-0000-7000-8000-000000000901', G2 = '01a0fda5-0000-7000-8000-000000000902';
const card = (n: number, group: string, title: string, seconds: number, prompt = 'A wide shot of the quad.'): StoryCard => ({
	card_id: `01a0fda5-0000-7000-8000-${String(n).padStart(12, '0')}`, order: n, title, beat: `beat ${n}`, purpose: 'p', duration_ms: seconds * 1000,
	image_prompt: 'i', video_prompt: prompt, status: 'draft', group_id: group, source: { notion_page_id: `shot-${n}`, scene_page_id: group === G1 ? 's1' : 's2', characters: ['Kai Santana'] }
});
const scene = (n: number, group: string, title: string, timecode: string, seconds: number) => ({ page_id: `s${n}`, number: n, title, act: 'Act 1', summary: `${title} summary`, story_beats: '1. Kai crosses the quad.', timecode, location: 'College quad', characters: ['Kai Santana'], group_id: group, seconds, shot_count: 1 });

const CLEAN = 'No image: Kai Santana — a freshman.\nNo image: the quad — the campus lawn.\nWide shot of the quad at noon. Kai Santana walks across the quad, slow dolly in. Birds call.\nSpeak only the scripted lines, verbatim. No subtitles. No on-screen text.';
const PRONOUN = 'No image: Kai Santana — a freshman.\nKai Santana turns; he smiles at the quad.';
const FIXED = 'No image: Kai Santana — a freshman.\nNo image: the quad — the campus lawn.\nKai Santana turns and smiles at the quad.';

describe('Fit to length (server side)', () => {
	test('the Agent writes a scene\'s shots, every prompt is linted and fixed, and they land after the scene on the spine', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-fit-')); roots.push(root);
		const gateway = new ProjectCommandGateway(new ProjectStore({ root }));
		const created = await gateway.createProject({ command: 'create_project', title: 'EP01', brief: '', creative_focus: 'full room', created_by: 'test' });
		if (!created.ok) throw new Error(created.error.message);
		const series: NonNullable<Project['series']> = {
			series_id: 'series', episode_page_id: 'ep', episode_number: 1, episode_title: 'EP01 — The Late Shift', summary: 'Kai breaks the rule.', twist: '', cliffhanger: '', imported_at: '2026-10-02T00:00:00.000Z',
			scenes: [scene(1, G1, 'P01 — Teaser', 'Act 1 · ~0:20', 20), scene(2, G2, 'P02 — Morning Quad', 'Act 1 · ~0:40', 6)]
		};
		// One existing prompt carries a banned word: the Agent must never read it.
		const cards = [card(0, G1, 'P01.01', 20), card(1, G2, 'P02.01', 6, 'Kai Santana under fangs posters.')];
		const imported = await gateway.importEpisode(created.data.project_id, created.data.version, { series, cards, groups: [{ group_id: G1, name: 'P01', created_at: series.imported_at }, { group_id: G2, name: 'P02', created_at: series.imported_at }], title: 'EP01', logline: '' });
		if (!imported.ok) throw new Error(imported.error.message);
		let project = imported.data;

		// 1 min episode: P01 plans 0:20 and has 0:20; P02 plans 0:40 and has 0:06 → 34 s to fill.
		const outline = episodeOutline(series, project.production.cards, 1);
		const [plan] = fitPlan(outline);
		expect(plan).toMatchObject({ page_id: 's2', gap_s: 34, shots_wanted: 6 });

		const answer = JSON.stringify({ shots: [
			{ description: 'Kai Santana crosses the quad.', duration_s: 6, video_prompt: CLEAN, audio: 'Birds.', characters: ['Kai Santana'] },
			{ description: 'Kai Santana smiles.', duration_s: 5, video_prompt: PRONOUN, dialogue: '' }
		] });
		const agent = scripted([answer, FIXED]);
		const rounds: Array<[number, number, number]> = [];
		const shots = await fitScene(agent.client, { system: await fitSystemPrompt(), story: 'Fall 2001. Kai Santana keeps a hidden crew.', series, outline, target_min: 1, scene: plan, sceneCards: [project.production.cards[1]], nextScene: null, banned: [] }, () => {}, (i, round) => { rounds.push([i, round.round, round.issues.length]); });

		// The ask: the story, the scene and its shots, the job; no banned word anywhere in it.
		expect(agent.asked[0].prompt).toContain('THE SCENE TO FILL: P02 — Morning Quad');
		expect(agent.asked[0].prompt).toContain('Write 6 NEW shots, about 34 s');
		expect(agent.asked[0].prompt).not.toMatch(/fangs/i);
		expect(agent.asked[0].prompt).toContain('▇▇▇');
		expect(agent.asked[0].system).toContain('Naming rules');
		// The clean prompt passed first time; the pronoun was fixed in one round (the single-shot warning is not a problem here).
		expect(shots[0]).toMatchObject({ video_prompt: CLEAN, lint: { rounds: 0, fixed: 0, remaining: 0 } });
		expect(shots[1]).toMatchObject({ video_prompt: FIXED, lint: { rounds: 1, fixed: 1, remaining: 0 } });
		expect(rounds).toContainEqual([1, 0, 1]);

		const added = fittedCards(plan, [project.production.cards[1]], shots, { newId: () => crypto.randomUUID(), now: '2026-10-02T00:00:00.000Z', target_min: 1, summary: 'The quad.' });
		const saved = await gateway.fitScene(project.project_id, project.version, G2, added);
		if (!saved.ok) throw new Error(saved.error.message);
		project = saved.data;
		expect(project.production.cards.map((c) => c.title)).toEqual(['P01.01', 'P02.01', 'P02.02', 'P02.03']);
		// Two shots for a 34 s gap: each as long as a shot may be.
		expect(project.production.cards.slice(2).map((c) => c.duration_ms)).toEqual([10_000, 10_000]);
		expect(liveSpine(project.production).map((c) => c.title)).toEqual(['P01.01', 'P02.01', 'P02.02', 'P02.03']);
		expect(episodeOutline(series, project.production.cards, 1).acts[0].scenes[1]).toMatchObject({ shots: 3, shot_s: 26 });

		// Undo: the fitted beats go, the Notion ones stay.
		const undone = await gateway.unfitEpisode(project.project_id, project.version);
		if (!undone.ok) throw new Error(undone.error.message);
		expect(undone.data.production.cards.map((c) => c.title)).toEqual(['P01.01', 'P02.01']);
		const again = await gateway.unfitEpisode(undone.data.project_id, undone.data.version);
		expect(again.ok).toBeFalse();
	});

	test('only an imported episode takes fitted beats', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-fit-')); roots.push(root);
		const gateway = new ProjectCommandGateway(new ProjectStore({ root }));
		const created = await gateway.createProject({ command: 'create_project', title: 'Plain', brief: '', creative_focus: 'full room', created_by: 'test' });
		if (!created.ok) throw new Error(created.error.message);
		const refused = await gateway.fitScene(created.data.project_id, created.data.version, G1, [card(5, G1, 'X.01', 6)]);
		expect(refused.ok).toBeFalse();
	});
});
