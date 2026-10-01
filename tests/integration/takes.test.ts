import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { pickFor, takesFor } from '../../src/lib/domain/takes';
import type { Project, ProductionAsset, StoryCard } from '../../src/lib/domain/schemas';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const card: StoryCard = {
	card_id: 'beat-1', order: 0, title: 'Leap', beat: 'She jumps the gap', purpose: 'Commitment',
	duration_ms: 5000, image_prompt: 'rooftop', video_prompt: 'rooftop leap', status: 'draft'
};
const take = (id: string, kind: ProductionAsset['kind'], minute: number): ProductionAsset => ({
	asset_id: id, card_id: 'beat-1', kind, name: id, mime_type: `${kind}/*`, url: `/files/${id}`,
	created_at: `2026-10-01T07:${String(minute).padStart(2, '0')}:00.000Z`
});

/** A project whose one beat holds a still and three video takes (v3 newest). */
async function setup() {
	const root = await mkdtemp(join(tmpdir(), 'csp-takes-')); roots.push(root);
	const store = new ProjectStore({ root });
	const gateway = new ProjectCommandGateway(store);
	const created = await gateway.createProject({ command: 'create_project', title: 'Takes', brief: '', creative_focus: 'full room', created_by: 'gordo' });
	if (!created.ok) throw new Error(created.error.message);
	const saved = await gateway.saveProduction({
		command: 'save_production', project_id: created.data.project_id, expected_version: created.data.version,
		production: { status: 'draft', title: 'Takes', logline: '', premise: '', theme: '', cards: [card],
			assets: [take('still', 'image', 0), take('v1', 'video', 1), take('v2', 'video', 2), take('v3', 'video', 3)], updated_at: null }
	});
	if (!saved.ok) throw new Error(saved.error.message);
	return { root, store, gateway, project: saved.data };
}

const pickOf = (project: Project) => pickFor(project.production, project.production.cards[0])?.asset_id;
function ok(outcome: Awaited<ReturnType<ProjectCommandGateway['setPick']>>): Project {
	if (!outcome.ok) throw new Error(outcome.error.message);
	return outcome.data;
}

describe('takes on beats', () => {
	test('a beat with no explicit pick shows its newest video', async () => {
		const { project } = await setup();
		expect(pickOf(project)).toBe('v3');
		expect(takesFor(project.production, 'beat-1').map((t) => t.asset_id)).toEqual(['still', 'v1', 'v2', 'v3']);
	});

	test('set pick persists to the ledger and survives a reload', async () => {
		const { root, gateway, project } = await setup();
		const picked = ok(await gateway.setPick({ command: 'set_pick', project_id: project.project_id, expected_version: project.version, card_id: 'beat-1', take_id: 'v1' }));
		expect(pickOf(picked)).toBe('v1');
		const reloaded = await new ProjectStore({ root }).readProject(project.project_id);
		expect(pickOf(reloaded!)).toBe('v1');
		const lines = (await readFile(join(root, project.project_id, 'ledger.jsonl'), 'utf8')).trim().split('\n');
		expect(JSON.parse(lines.at(-1)!).type).toBe('project.take_picked.v1');
	});

	test('a still can be the pick', async () => {
		const { gateway, project } = await setup();
		const picked = ok(await gateway.setPick({ command: 'set_pick', project_id: project.project_id, expected_version: project.version, card_id: 'beat-1', take_id: 'still' }));
		expect(pickOf(picked)).toBe('still');
	});

	test('set pick refuses a take from another beat, and a stale version', async () => {
		const { gateway, project } = await setup();
		const foreign = await gateway.setPick({ command: 'set_pick', project_id: project.project_id, expected_version: project.version, card_id: 'beat-1', take_id: 'nope' });
		expect(foreign.ok).toBeFalse();
		if (!foreign.ok) expect(foreign.error.code).toBe('INVALID_COMMAND');
		const stale = await gateway.setPick({ command: 'set_pick', project_id: project.project_id, expected_version: project.version - 1, card_id: 'beat-1', take_id: 'v1' });
		expect(stale.ok).toBeFalse();
		if (!stale.ok) expect(stale.error.code).toBe('VERSION_CONFLICT');
	});

	test('reject hides a take from cycling but keeps it; rejecting the pick moves to the next take', async () => {
		const { gateway, project } = await setup();
		const picked = ok(await gateway.setPick({ command: 'set_pick', project_id: project.project_id, expected_version: project.version, card_id: 'beat-1', take_id: 'v1' }));
		const rejected = ok(await gateway.rejectTake({ command: 'reject_take', project_id: project.project_id, expected_version: picked.version, take_id: 'v1' }));
		expect(takesFor(rejected.production, 'beat-1').map((t) => t.asset_id)).toEqual(['still', 'v2', 'v3']);
		expect(takesFor(rejected.production, 'beat-1', true)).toHaveLength(4);
		expect(pickOf(rejected)).toBe('v2');
		const refused = await gateway.setPick({ command: 'set_pick', project_id: project.project_id, expected_version: rejected.version, card_id: 'beat-1', take_id: 'v1' });
		expect(refused.ok).toBeFalse();
	});

	test('rejecting the last take moves the pick back one', async () => {
		const { gateway, project } = await setup();
		const rejected = ok(await gateway.rejectTake({ command: 'reject_take', project_id: project.project_id, expected_version: project.version, take_id: 'v3' }));
		expect(pickOf(rejected)).toBe('v2');
	});

	test('restore brings a rejected take back into cycling without changing the pick', async () => {
		const { gateway, project } = await setup();
		const rejected = ok(await gateway.rejectTake({ command: 'reject_take', project_id: project.project_id, expected_version: project.version, take_id: 'v1' }));
		const restored = ok(await gateway.restoreTake({ command: 'restore_take', project_id: project.project_id, expected_version: rejected.version, take_id: 'v1' }));
		expect(takesFor(restored.production, 'beat-1').map((t) => t.asset_id)).toEqual(['still', 'v1', 'v2', 'v3']);
		expect(restored.production.assets.find((a) => a.asset_id === 'v1')).not.toHaveProperty('rejected');
		expect(pickOf(restored)).toBe('v3');
	});
});
