import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { benchedBeats } from '../../src/lib/domain/bench';
import { liveSpine } from '../../src/lib/domain/spine';
import type { Project, StoryCard } from '../../src/lib/domain/schemas';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const beat = (id: string, order: number): StoryCard => ({
	card_id: id, order, title: id, beat: `${id} happens`, purpose: 'Story', duration_ms: 3000,
	image_prompt: 'still', video_prompt: 'clip', status: 'draft'
});

async function setup() {
	const root = await mkdtemp(join(tmpdir(), 'csp-bench-')); roots.push(root);
	const gateway = new ProjectCommandGateway(new ProjectStore({ root }));
	const created = await gateway.createProject({ command: 'create_project', title: 'Bench', brief: '', creative_focus: 'full room', created_by: 'gordo' });
	if (!created.ok) throw new Error(created.error.message);
	const saved = await gateway.saveProduction({
		command: 'save_production', project_id: created.data.project_id, expected_version: created.data.version,
		production: { status: 'draft', title: 'Bench', logline: '', premise: '', theme: '', cards: [beat('a', 0), beat('b', 1), beat('c', 2)], assets: [], updated_at: null }
	});
	if (!saved.ok) throw new Error(saved.error.message);
	return { root, gateway, project: saved.data };
}

function ok(outcome: Awaited<ReturnType<ProjectCommandGateway['benchBeat']>>): Project {
	if (!outcome.ok) throw new Error(outcome.error.message);
	return outcome.data;
}
const ids = (cards: StoryCard[]) => cards.map((card) => card.card_id);

describe('benched beats', () => {
	test('bench keeps the beat in place but skips it in the live spine; persists across reload', async () => {
		const { root, gateway, project } = await setup();
		const benched = ok(await gateway.benchBeat({ command: 'bench_beat', project_id: project.project_id, expected_version: project.version, card_id: 'b' }));
		expect(ids(benched.production.cards)).toEqual(['a', 'b', 'c']);
		expect(benched.production.cards[1].order).toBe(1);
		expect(ids(liveSpine(benched.production))).toEqual(['a', 'c']);
		expect(ids(benchedBeats(benched.production))).toEqual(['b']);
		const reloaded = await new ProjectStore({ root }).readProject(project.project_id);
		expect(ids(benchedBeats(reloaded!.production))).toEqual(['b']);
		const lines = (await readFile(join(root, project.project_id, 'ledger.jsonl'), 'utf8')).trim().split('\n');
		expect(JSON.parse(lines.at(-1)!).type).toBe('project.beat_benched.v1');
	});

	test('unbench returns the beat to the live spine at its old place', async () => {
		const { gateway, project } = await setup();
		const benched = ok(await gateway.benchBeat({ command: 'bench_beat', project_id: project.project_id, expected_version: project.version, card_id: 'b' }));
		const back = ok(await gateway.benchBeat({ command: 'unbench_beat', project_id: project.project_id, expected_version: benched.version, card_id: 'b' }));
		expect(ids(liveSpine(back.production))).toEqual(['a', 'b', 'c']);
		expect(back.production.cards[1]).not.toHaveProperty('benched');
	});

	test('bench refuses an unknown beat', async () => {
		const { gateway, project } = await setup();
		const refused = await gateway.benchBeat({ command: 'bench_beat', project_id: project.project_id, expected_version: project.version, card_id: 'zz' });
		expect(refused.ok).toBeFalse();
		if (!refused.ok) expect(refused.error.code).toBe('INVALID_COMMAND');
	});
});
