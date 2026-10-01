import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { cutsOf } from '../../src/lib/domain/cuts';
import type { Project, ProductionAsset, StoryCard } from '../../src/lib/domain/schemas';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const beat = (id: string, order: number): StoryCard => ({
	card_id: id, order, title: id, beat: `${id} happens`, purpose: 'Story', duration_ms: 5000,
	image_prompt: 'still', video_prompt: 'clip', status: 'draft'
});
const take = (id: string, cardId: string, extra: Partial<ProductionAsset> = {}): ProductionAsset => ({
	asset_id: id, card_id: cardId, kind: 'video', name: id, mime_type: 'video/mp4', url: `/files/${id}`,
	created_at: '2026-10-01T07:00:00.000Z', ...extra
});
const RAMP = [{ x: 0, rate: 1 }, { x: 1, rate: 2 }];

/** Two beats; beat a's take carries a trim and ramp from the selection player. */
async function setup() {
	const root = await mkdtemp(join(tmpdir(), 'csp-cuts-')); roots.push(root);
	const store = new ProjectStore({ root });
	const gateway = new ProjectCommandGateway(store);
	const created = await gateway.createProject({ command: 'create_project', title: 'Cuts', brief: '', creative_focus: 'full room', created_by: 'gordo' });
	if (!created.ok) throw new Error(created.error.message);
	const saved = await gateway.saveProduction({
		command: 'save_production', project_id: created.data.project_id, expected_version: created.data.version,
		production: { status: 'draft', title: 'Cuts', logline: '', premise: '', theme: '', cards: [beat('a', 0), beat('b', 1)],
			assets: [take('a1', 'a', { in_s: 1, out_s: 4, speed: RAMP }), take('a2', 'a'), take('b1', 'b')], updated_at: null }
	});
	if (!saved.ok) throw new Error(saved.error.message);
	return { root, store, gateway, project: saved.data };
}

function ok(outcome: Awaited<ReturnType<ProjectCommandGateway['pushCut']>>): Project {
	if (!outcome.ok) throw new Error(outcome.error.message);
	return outcome.data;
}

async function lastEvent(root: string, projectId: string) {
	const lines = (await readFile(join(root, projectId, 'ledger.jsonl'), 'utf8')).trim().split('\n');
	return JSON.parse(lines.at(-1)!).type as string;
}

async function pushTrailer(gateway: ProjectCommandGateway, project: Project) {
	return ok(await gateway.handle({
		command: 'push_cut', project_id: project.project_id, expected_version: project.version, name: 'Trailer',
		entries: [
			{ card_id: 'b', asset_id: 'b1', in_s: 0, out_s: 2 },
			{ card_id: 'a', asset_id: 'a1', in_s: 1, out_s: 4, speed: RAMP }
		]
	}) as Awaited<ReturnType<ProjectCommandGateway['pushCut']>>);
}

describe('cuts', () => {
	test('push saves a named cut to the ledger and it survives a reload', async () => {
		const { root, gateway, project } = await setup();
		const pushed = await pushTrailer(gateway, project);
		const [cut] = cutsOf(pushed.production);
		expect(cut).toMatchObject({ name: 'Trailer', version: 1, locked: false });
		expect(cut.entries.map((e) => [e.asset_id, e.in_s, e.out_s])).toEqual([['b1', 0, 2], ['a1', 1, 4]]);
		expect(cut.entries[1].speed).toEqual(RAMP);
		expect(pushed.production.assets).toEqual(project.production.assets);
		expect(await lastEvent(root, project.project_id)).toBe('project.cut_pushed.v1');
		const reloaded = await new ProjectStore({ root }).readProject(project.project_id);
		expect(cutsOf(reloaded!.production)).toEqual([cut]);
	});

	test("changing a take's trim on the board after pushing leaves the cut unchanged", async () => {
		const { gateway, project } = await setup();
		const pushed = await pushTrailer(gateway, project);
		const before = cutsOf(pushed.production);
		// The selection player's take-default save: a whole-production save with new take trims (and a stale cut list).
		const assets = pushed.production.assets.map((a) => (a.asset_id === 'a1' ? { ...a, in_s: 0, out_s: 1.5, speed: undefined } : a));
		const saved = ok(await gateway.saveProduction({
			command: 'save_production', project_id: project.project_id, expected_version: pushed.version,
			production: { ...pushed.production, assets, cuts: [] }
		}));
		expect(saved.production.assets.find((a) => a.asset_id === 'a1')).toMatchObject({ in_s: 0, out_s: 1.5 });
		expect(cutsOf(saved.production)).toEqual(before);
		// Picks and benching don't reach it either.
		const picked = ok(await gateway.setPick({ command: 'set_pick', project_id: project.project_id, expected_version: saved.version, card_id: 'a', take_id: 'a2' }));
		const benched = ok(await gateway.benchBeat({ command: 'bench_beat', project_id: project.project_id, expected_version: picked.version, card_id: 'b' }));
		expect(cutsOf(benched.production)).toEqual(before);
	});

	test('edits in a cut persist to the cut only', async () => {
		const { root, gateway, project } = await setup();
		const pushed = await pushTrailer(gateway, project);
		const [cut] = cutsOf(pushed.production);
		const [b, a] = cut.entries;
		const edited = ok(await gateway.editCut({
			command: 'edit_cut', project_id: project.project_id, expected_version: pushed.version, cut_id: cut.cut_id,
			entries: [{ ...a, in_s: 2, speed: [{ x: 0, rate: 3 }, { x: 1, rate: 1 }] }, { ...b, out_s: 1 }]
		}));
		expect(await lastEvent(root, project.project_id)).toBe('project.cut_edited.v1');
		const reloaded = (await new ProjectStore({ root }).readProject(project.project_id))!;
		const [after] = cutsOf(reloaded.production);
		expect(after.entries.map((e) => [e.entry_id, e.in_s, e.out_s])).toEqual([[a.entry_id, 2, 4], [b.entry_id, 0, 1]]);
		expect(after.entries[0].speed).toEqual([{ x: 0, rate: 3 }, { x: 1, rate: 1 }]);
		expect(reloaded.production.assets).toEqual(project.production.assets);
		expect(reloaded.production.cards).toEqual(project.production.cards);
		expect(edited.version).toBe(reloaded.version);
	});

	test('rename persists; refusals are INVALID_COMMAND and stale versions conflict', async () => {
		const { root, gateway, project } = await setup();
		const pushed = await pushTrailer(gateway, project);
		const [cut] = cutsOf(pushed.production);
		const renamed = ok(await gateway.renameCut({ command: 'rename_cut', project_id: project.project_id, expected_version: pushed.version, cut_id: cut.cut_id, name: 'Promo' }));
		expect(cutsOf(renamed.production)[0].name).toBe('Promo');
		expect(await lastEvent(root, project.project_id)).toBe('project.cut_renamed.v1');

		const foreign = await gateway.pushCut({ command: 'push_cut', project_id: project.project_id, expected_version: renamed.version, name: 'X', entries: [{ card_id: 'a', asset_id: 'b1', in_s: 0, out_s: 1 }] });
		expect(foreign.ok).toBeFalse();
		if (!foreign.ok) expect(foreign.error.code).toBe('INVALID_COMMAND');
		const missing = await gateway.editCut({ command: 'edit_cut', project_id: project.project_id, expected_version: renamed.version, cut_id: 'nope', entries: cut.entries });
		expect(missing.ok).toBeFalse();
		if (!missing.ok) expect(missing.error.code).toBe('INVALID_COMMAND');
		const stale = await gateway.editCut({ command: 'edit_cut', project_id: project.project_id, expected_version: pushed.version, cut_id: cut.cut_id, entries: cut.entries });
		expect(stale.ok).toBeFalse();
		if (!stale.ok) expect(stale.error.code).toBe('VERSION_CONFLICT');
	});
});
