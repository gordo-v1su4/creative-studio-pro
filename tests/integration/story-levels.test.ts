import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { productionStateSchema, type Project } from '../../src/lib/domain/schemas';
import { levelsOf, shotCodeOf, STORY_LEVELS } from '../../src/lib/domain/story-levels';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

const brief = { title: 'Blood Rush', slug: 'blood-rush', logline: 'Kai breaks blood law.', format: { type: 'Teaser', runtime: '30s', aspect: '16:9', platform: 'Web' }, tone_visual_rules: 'Night.', must_haves: ['Kai'], must_nots: ['Daylight'], success_criteria: ['It plays'] };
const plan = { title: 'Blood Rush · Teaser', sections: [{ id: 'act1', title: 'Act 1', summary: '', scenes: [{ id: 'vh', title: 'Video Haven, 2:47 AM' }], moments: [{ id: 'm1', title: 'The floor', beat: 'Mara on the floor.', duration_s: 8, scene_id: 'vh', shots: [{ id: 'sh1', title: 'Wide', beat: 'The store, dark.', duration_s: 4 }, { id: 'sh2', title: 'Mara', beat: 'Her face.', duration_s: 4 }] }] }] };

async function setup() {
	const root = await mkdtemp(join(tmpdir(), 'csp-levels-')); roots.push(root);
	const store = new ProjectStore({ root }), gateway = new ProjectCommandGateway(store);
	const created = await store.createProject({ title: 'Blood Rush · Teaser', brief: 'A vampire thing in a video store.', creative_focus: 'full room', created_by: 'test' });
	const planned = await gateway.saveProduction({ command: 'save_production', project_id: created.project_id, expected_version: created.version, production: productionStateSchema.parse({ story_plan: plan }) });
	if (!planned.ok) throw new Error(planned.error.message);
	const briefed = await gateway.saveBrief({ command: 'save_brief', project_id: created.project_id, expected_version: planned.data.version, brief });
	if (!briefed.ok) throw new Error(briefed.error.message);
	return { root, store, gateway, project: briefed.data };
}
async function approveAll(gateway: ProjectCommandGateway, start: Project): Promise<Project> {
	let project = start;
	for (const level of STORY_LEVELS) {
		const outcome = await gateway.approveStoryLevel(project.project_id, project.version, { level });
		if (!outcome.ok) throw new Error(`${level}: ${outcome.error.message}`);
		project = outcome.data;
	}
	return project;
}
const save = (gateway: ProjectCommandGateway, project: Project, production: Project['production']) => gateway.saveProduction({ command: 'save_production', project_id: project.project_id, expected_version: project.version, production });

test('from a brief to an approved shot list: each level is approved in order and its codes are given once', async () => {
	const { root, store, gateway, project } = await setup();
	const early = await gateway.approveStoryLevel(project.project_id, project.version, { level: 'scenes' });
	expect(early).toMatchObject({ ok: false, error: { code: 'INVALID_COMMAND', message: 'Approve the brief first' } });
	const done = await approveAll(gateway, project);
	expect(levelsOf(done)).toEqual({ brief: 'approved', acts: 'approved', scenes: 'approved', beats: 'approved', shots: 'approved' });
	expect(done.production.story_levels).toMatchObject({ show_code: 'BLR', project_code: 'TR100' });
	expect(done.production.cards.map((card) => shotCodeOf(done, card))).toEqual(['BLR_TR100_VHA_0010', 'BLR_TR100_VHA_0020']);
	expect(await store.readProject(project.project_id)).toEqual(done);
	const again = await gateway.approveStoryLevel(done.project_id, done.version, { level: 'scenes' });
	expect(again).toMatchObject({ ok: false, error: { message: 'The scenes are already approved' } });
	const ledger = await readFile(join(root, project.project_id, 'ledger.jsonl'), 'utf8').catch(() => '');
	if (ledger) expect(ledger).toContain('project.story_level_approved.v1');
});

test('after its level is approved no save changes a code; titles and everything else still save', async () => {
	const { gateway, project } = await setup();
	const done = await approveAll(gateway, project);

	const recoded = structuredClone(done.production);
	recoded.story_plan!.sections[0].scenes[0].scene_code = 'XXX';
	expect(await save(gateway, done, recoded)).toMatchObject({ ok: false, error: { code: 'INVALID_COMMAND', message: 'Scene code VHA is fixed: its level is approved, so only the title can change' } });

	const renumbered = structuredClone(done.production);
	renumbered.cards[0].shot_number = 40;
	expect(await save(gateway, done, renumbered)).toMatchObject({ ok: false, error: { message: 'Shot code VHA_0010 is fixed: its level is approved, so only the title can change' } });

	const retitled = structuredClone(done.production);
	retitled.story_plan!.sections[0].scenes[0].title = 'Video Haven, closing time';
	retitled.cards[0].title = 'Wide, from the door';
	const saved = await save(gateway, done, retitled);
	if (!saved.ok) throw new Error(saved.error.message);
	expect(saved.data.production.story_plan!.sections[0].scenes[0]).toMatchObject({ title: 'Video Haven, closing time', scene_code: 'VHA' });
	expect(shotCodeOf(saved.data, saved.data.production.cards[0])).toBe('BLR_TR100_VHA_0010');
});

test('a save made from a copy that predates the approval loses nothing, and cannot write approvals itself', async () => {
	const { gateway, project } = await setup();
	const done = await approveAll(gateway, project);
	const stale = structuredClone(done.production);
	stale.story_levels = { approved: {} };
	for (const card of stale.cards) { card.shot_number = undefined; card.scene_code = undefined; }
	stale.story_plan!.sections[0].scenes[0].scene_code = undefined;
	const saved = await save(gateway, done, stale);
	if (!saved.ok) throw new Error(saved.error.message);
	expect(saved.data.production.story_levels).toEqual(done.production.story_levels);
	expect(saved.data.production.cards.map((card) => shotCodeOf(saved.data, card))).toEqual(['BLR_TR100_VHA_0010', 'BLR_TR100_VHA_0020']);

});

test('only approving a level writes approvals: a save that claims them is not believed', async () => {
	const { gateway, project } = await setup();
	const forged = await save(gateway, project, { ...project.production, story_levels: { approved: { brief: 'x', acts: 'x', scenes: 'x', beats: 'x', shots: 'x' }, show_code: 'ZZZ' } });
	if (!forged.ok) throw new Error(forged.error.message);
	expect(forged.data.production.story_levels).toBeUndefined();
});

test('a scene added after the scenes were approved is named when they are approved again; the first names stay', async () => {
	const { gateway, project } = await setup();
	const done = await approveAll(gateway, project);
	const more = structuredClone(done.production);
	more.story_plan!.sections[0].scenes.push({ id: 'cmp', title: 'Campus' });
	const saved = await save(gateway, done, more);
	if (!saved.ok) throw new Error(saved.error.message);
	expect(levelsOf(saved.data).scenes).toBe('proposed');
	const again = await gateway.approveStoryLevel(saved.data.project_id, saved.data.version, { level: 'scenes' });
	if (!again.ok) throw new Error(again.error.message);
	expect(again.data.production.story_plan!.sections[0].scenes.map((scene) => scene.scene_code)).toEqual(['VHA', 'CMP']);
});
