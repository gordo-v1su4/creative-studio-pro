import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { SEED, spineBeats } from '../../src/lib/domain/spine';
import type { StoryCard } from '../../src/lib/domain/schemas';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const beat = (id: string, order: number): StoryCard => ({
	card_id: id, order, title: id, beat: `${id} happens`, purpose: 'Story', duration_ms: 3000,
	image_prompt: 'still', video_prompt: 'clip', status: 'draft'
});

async function setup() {
	const root = await mkdtemp(join(tmpdir(), 'csp-spine-')); roots.push(root);
	const gateway = new ProjectCommandGateway(new ProjectStore({ root }));
	const created = await gateway.createProject({ command: 'create_project', title: 'Spine', brief: '', creative_focus: 'full room', created_by: 'gordo' });
	if (!created.ok) throw new Error(created.error.message);
	const saved = await gateway.saveProduction({
		command: 'save_production', project_id: created.data.project_id, expected_version: created.data.version,
		production: { status: 'draft', title: 'Spine', logline: '', premise: '', theme: '', cards: [beat('a', 0), beat('b', 1), beat('c', 2)], assets: [], updated_at: null }
	});
	if (!saved.ok) throw new Error(saved.error.message);
	return { root, gateway, project: saved.data };
}

describe('rewire the spine', () => {
	test('rewiring stores the links and renumbers beats in the new story order; persists across reload', async () => {
		const { root, gateway, project } = await setup();
		const links = [{ from: SEED, to: 'c' }, { from: 'c', to: 'a' }];
		const outcome = await gateway.rewireSpine({ command: 'rewire_spine', project_id: project.project_id, expected_version: project.version, links });
		if (!outcome.ok) throw new Error(outcome.error.message);
		expect(spineBeats(outcome.data.production).map((card) => card.card_id)).toEqual(['c', 'a']);
		const order = Object.fromEntries(outcome.data.production.cards.map((card) => [card.card_id, card.order]));
		expect(order).toEqual({ c: 0, a: 1, b: 2 });
		const reloaded = await new ProjectStore({ root }).readProject(project.project_id);
		expect(reloaded!.production.links).toEqual(links);
		const lines = (await readFile(join(root, project.project_id, 'ledger.jsonl'), 'utf8')).trim().split('\n');
		expect(JSON.parse(lines.at(-1)!).type).toBe('project.spine_rewired.v1');
	});

	test('a looping rewire is refused and nothing changes', async () => {
		const { gateway, project } = await setup();
		const outcome = await gateway.rewireSpine({
			command: 'rewire_spine', project_id: project.project_id, expected_version: project.version,
			links: [{ from: SEED, to: 'a' }, { from: 'a', to: 'b' }, { from: 'b', to: 'a' }]
		});
		expect(outcome.ok).toBeFalse();
		if (!outcome.ok) expect(outcome.error.code).toBe('INVALID_COMMAND');
	});
});
