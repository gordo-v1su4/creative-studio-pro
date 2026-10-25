import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { episodeOutline } from '../../src/lib/domain/episode-outline';
import { awaitingApproval, fitPlan, proposedCards, removeShots } from '../../src/lib/domain/episode-fit';
import { compileHandles } from '../../src/lib/domain/handles';
import { ghostQc, GHOST_SECTIONS, MUSIC_CLOSER, MUSIC_OPENER } from '../../src/lib/domain/ghost-qc';
import { PROMPT_PENDING, type ShotSpec } from '../../src/lib/domain/shot-spec';
import { liveSpine } from '../../src/lib/domain/spine';
import { ghostSystem, proposeShots, SpecCheckFailed, writeShotPrompt } from '../../src/lib/server/ghost-shots';
import { fitContext } from '../../src/lib/server/episode-fit';
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
const card = (n: number, group: string, title: string, seconds: number): StoryCard => ({
	card_id: `01a0fda5-0000-7000-8000-${String(n).padStart(12, '0')}`, order: n, title, beat: `beat ${n}`, purpose: 'p', duration_ms: seconds * 1000,
	image_prompt: 'i', video_prompt: 'A wide shot of the quad.', status: 'draft', group_id: group, source: { notion_page_id: `shot-${n}`, scene_page_id: group === G1 ? 's1' : 's2', characters: ['Kai Santana'] }
});
const scene = (n: number, group: string, title: string, timecode: string, seconds: number) => ({ page_id: `s${n}`, number: n, title, act: 'Act 1', summary: `${title} summary`, story_beats: '1. Kai crosses the quad.', timecode, location: 'College quad', characters: ['Kai Santana'], group_id: group, seconds, shot_count: 1 });
const spec = (over: Partial<ShotSpec> = {}): ShotSpec => ({ size: 'MS', angle: 'eye level', subjects: ['@Kai'], action: '@Kai crosses the quad.', dialogue: '', location: '@Quad', light: 'night, sodium lamps', camera_move: 'slow dolly in', duration_s: 6, ...over });

const refs = [
	{ name: 'Kai "Hoodie" Santana', kind: 'Character', role: 'the lead', handles: ['@Kai'] },
	{ name: 'Mara Voss', kind: 'Character', role: 'the new girl', handles: ['@Mara'] },
	{ name: 'College Quad', kind: 'Location', role: '', handles: ['@Quad'] }
];
/** A Ghost prompt as the Agent writes it: handles, the eleven sections, the music opener and closer. */
const ghostPrompt = (seconds = 6, extra = '') => [
	`${seconds} s. Upload:`,
	'SCENE + REALISM LOCK: @Kai crosses @Quad at night. Live-action film footage, real lenses, real skin; not a video game, not animation; no on-screen text.',
	'REFERENCES: image 1 = @Kai\'s face and costume, image 2 = @Quad.',
	'CHARACTERS: @Kai, gray zip hoodie, platinum curls.',
	'SPACE: @Quad, 40 m lawn, lamps on the left.',
	'FIRST FRAME: @Kai at frame right, mid-stride.',
	`TIMELINE: SHOT 1 | 0.0–${seconds}.0 s: 1. @Kai walks. 2. He glances back.`,
	'PHYSICS: hoodie sways with each step.',
	'CAMERA: 35mm, chest height, slow dolly in as he walks.',
	'LIGHT / COLOUR: sodium lamp key, teal grade, amber accent.',
	`SOUND: ${MUSIC_OPENER} Footsteps on wet grass.`,
	`LOCKS: no morphing, no extra characters. ${MUSIC_CLOSER}${extra}`
].join('\n');

describe('Shots from Ghost (V1S-375)', () => {
	test('Ghost proposes shot specs (no prompts); the cards wait for approval, then land after the scene on the spine', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-fit-')); roots.push(root);
		const gateway = new ProjectCommandGateway(new ProjectStore({ root }));
		const created = await gateway.createProject({ command: 'create_project', title: 'EP01', brief: '', creative_focus: 'full room', created_by: 'test' });
		if (!created.ok) throw new Error(created.error.message);
		const series: NonNullable<Project['series']> = {
			series_id: 'series', episode_page_id: 'ep', episode_number: 1, episode_title: 'EP01 — The Late Shift', summary: 'Kai breaks the rule.', twist: '', cliffhanger: '', imported_at: '2026-10-02T00:00:00.000Z',
			scenes: [scene(1, G1, 'P01 — Teaser', 'Act 1 · ~0:20', 20), scene(2, G2, 'P02 — Morning Quad', 'Act 1 · ~0:40', 6)]
		};
		const imported = await gateway.importEpisode(created.data.project_id, created.data.version, { series, cards: [card(0, G1, 'P01.01', 20), card(1, G2, 'P02.01', 6)], groups: [{ group_id: G1, name: 'P01', created_at: series.imported_at }, { group_id: G2, name: 'P02', created_at: series.imported_at }], title: 'EP01', logline: '' });
		if (!imported.ok) throw new Error(imported.error.message);
		let project = imported.data;
		const outline = episodeOutline(series, project.production.cards, 1);
		const [plan] = fitPlan(outline);
		expect(plan).toMatchObject({ page_id: 's2', gap_s: 34 });

		const answer = JSON.stringify({ shots: [spec({ subjects: ['Kai Santana'], action: 'Kai Santana crosses the quad.', location: 'College quad' }), spec({ size: 'CU', subjects: ['Kai Santana'], action: 'Kai Santana smiles.', location: 'College quad', duration_s: 9 })] });
		const agent = scripted([answer, answer]);
		const specs = await proposeShots(agent.client, { system: await ghostSystem(), story: 'Fall 2001.', series, outline, target_min: 1, scene: plan, sceneCards: [project.production.cards[1]], nextScene: null, banned: [] });
		expect(agent.asked[0].system).toContain('GHOST (ONE SHOT Community Edition)');
		expect(agent.asked[0].prompt).toContain('as SHOT SPECS only, no prompts yet');
		expect(agent.asked[1].prompt).toContain('CHECK THEM AGAINST THIS CHECKLIST');

		const added = proposedCards(plan, [project.production.cards[1]], specs, { newId: () => crypto.randomUUID(), now: '2026-10-25T00:00:00.000Z', target_min: 1, summary: 'The quad.' });
		expect(added.map((c) => [c.title, c.duration_ms, c.video_prompt])).toEqual([['P02.02', 6000, PROMPT_PENDING], ['P02.03', 9000, PROMPT_PENDING]]);
		expect(added[1].beat).toBe('Close-up, eye level — Kai Santana smiles.');
		const saved = await gateway.fitScene(project.project_id, project.version, G2, added);
		if (!saved.ok) throw new Error(saved.error.message);
		project = saved.data;
		expect(liveSpine(project.production).map((c) => c.title)).toEqual(['P01.01', 'P02.01', 'P02.02', 'P02.03']);
		expect(awaitingApproval(project.production.cards, G2).map((c) => c.title)).toEqual(['P02.02', 'P02.03']);
		// One proposed shot rejected: the spine closes over it.
		const rejected = removeShots(project.production, [added[0].card_id]);
		expect(rejected.removed).toBe(1);
		expect(rejected.production.cards.map((c) => c.title)).toEqual(['P01.01', 'P02.01', 'P02.03']);
		// The context shows proposed shots by spec, never their pending prompt.
		expect(fitContext({ story: '', series, outline, target_min: 1, scene: plan, sceneCards: project.production.cards.filter((c) => c.group_id === G2), nextScene: null, banned: [] })).not.toContain(PROMPT_PENDING);
	});

	test('a dialogue line left out, or a stray reference, is fixed by the Agent; still failing, nothing is returned', async () => {
		const series: NonNullable<Project['series']> = {
			series_id: 'series', episode_page_id: 'ep', episode_number: 101, episode_title: 'EP101', summary: '', twist: '', cliffhanger: '', imported_at: '2026-10-17T00:00:00.000Z',
			scenes: [{ ...scene(1, G1, 'Morning Quad', 'Act 1', 20), dialogue: 'MARA (sharp): "You dropped this."\nKAI: "Keep it."', reference_ids: [] }]
		};
		const outline = episodeOutline(series, [], 1);
		const [plan] = fitPlan(outline);
		const base = { system: 's', story: '', series, outline, target_min: 1, scene: { ...plan, shots_wanted: 2 }, sceneCards: [], nextScene: null, banned: [], references: refs.slice(0, 2) };
		const first = JSON.stringify({ shots: [spec({ subjects: ['@Mara', '@Bryce'], action: '@Mara stops @Kai. @Bryce watches.', location: '', dialogue: 'MARA (sharp): "You dropped this."' })] });
		const fixed = JSON.stringify({ shots: [spec({ subjects: ['@Mara'], action: '@Mara stops @Kai.', location: '', dialogue: 'MARA (sharp): "You dropped this."' }), spec({ action: '@Kai walks on.', location: '', dialogue: 'KAI: "Keep it."' })] });
		const agent = scripted([first, fixed]);
		const checks: Array<[number, number]> = [];
		const specs = await proposeShots(agent.client, base, (round, problems) => { checks.push([round, problems.length]); });
		expect(agent.asked[1].prompt).toContain('Dialogue line not placed in any shot: KAI: "Keep it."');
		expect(agent.asked[1].prompt).toContain('@Bryce is not one of this scene\'s references');
		expect(checks).toEqual([[0, 2], [2, 0]]);
		expect(specs).toHaveLength(2);

		const silent = JSON.stringify({ shots: [spec({ subjects: ['@Kai'], action: '@Kai waits.', location: '' })] });
		const stuck = scripted([silent, silent, silent]);
		const failed = await proposeShots(stuck.client, base).catch((cause) => cause);
		expect(failed).toBeInstanceOf(SpecCheckFailed);
	});

	test('the prompt is written from the approved spec in Ghost\'s format, handles swapped Ghost\'s way, QC repaired', async () => {
		// First answer misses the closer and uses a stray handle; the repair fixes both.
		const broken = ghostPrompt(6).replace(MUSIC_CLOSER, '') + ' @Bryce stands by.';
		const agent = scripted([JSON.stringify({ video_prompt: broken }), JSON.stringify({ video_prompt: ghostPrompt(6) })]);
		const written = await writeShotPrompt(agent.client, { system: 's', context: 'ctx', title: 'P02.02', spec: spec(), references: refs, banned: [] });
		expect(agent.asked[0].prompt).toContain('THE APPROVED SHOT SPEC for P02.02');
		expect(agent.asked[1].prompt).toContain(`The no-music closer is missing`);
		expect(agent.asked[1].prompt).toContain('@Bryce is not a reference of this series');
		expect([written.qc, written.rounds]).toEqual([[], 1]);
		// Stored with handles; compiled, the header is Ghost's upload line and names carry Ghost's tags.
		expect(written.video_prompt).toContain('@Kai');
		expect(written.compiled.split('\n')[0]).toBe('6 s. Upload: image 1 = Kai "Hoodie" Santana, image 2 = College Quad');
		expect(written.compiled).toContain('Kai "Hoodie" Santana (image 1) crosses College Quad (image 2)');
		expect(written.compiled).not.toMatch(/@[A-Za-z]/);
	});

	test('the Ghost QC: sections in order, header, music lines, references, timeline, banned words', () => {
		const compiled = compileHandles(ghostPrompt(6), refs, 'ghost');
		const names = compiled.images.map((image) => image.reference.name);
		expect(ghostQc(compiled.prompt, { duration_s: 6, references: names })).toEqual([]);
		expect(ghostQc(compiled.prompt, { duration_s: 8, references: names }).join(' ')).toContain('header says 6 s but the shot is 8 s');
		const swapped = compiled.prompt.replace('PHYSICS:', 'TEMP:').replace('CAMERA:', 'PHYSICS:').replace('TEMP:', 'CAMERA:');
		expect(ghostQc(swapped, { duration_s: 6, references: names }).join(' ')).toContain('out of order');
		expect(ghostQc(compiled.prompt.replace(MUSIC_OPENER, ''), { duration_s: 6, references: names }).join(' ')).toContain('opener is missing');
		expect(ghostQc(`${compiled.prompt} neon sign`, { duration_s: 6, references: names }).join(' ')).toContain('"neon"');
		expect(ghostQc(compiled.prompt.replace('0.0–6.0 s', '0.0–9.0 s'), { duration_s: 6, references: names }).join(' ')).toContain('past the 6-second clip');
		expect(ghostQc(compiled.prompt, { duration_s: 6, references: [...names, 'Mara Voss'] }).join(' ')).toContain('"Mara Voss" never appears');
		expect(GHOST_SECTIONS).toHaveLength(11);
	});
});
