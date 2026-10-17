import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { gridChunks, gridPrompt } from '../../src/lib/domain/grid';
import { quoteGrids, sendGrid, settleGrid, type GridDeps } from '../../src/lib/server/grid';
import type { StoryCard } from '../../src/lib/domain/schemas';
import type { GenerationStatus } from '../../src/lib/server/higgsfield';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('grid prompt', () => {
	test('nine panels in reading order; empty cells stay black; ten shots make two grids', () => {
		const prompt = gridPrompt({ scene: 'P02 — Parking Lot', location: 'campus lot', summary: 'Kai waits.', characters: ['Kai'], shots: [{ card_id: 'a', title: 'A', image_prompt: 'Kai by the car, wide.', description: 'x' }, { card_id: 'b', title: 'B', image_prompt: 'None yet (from Notion).', description: 'Close on the keys.' }] });
		expect(prompt).toContain('Panel 1 (row 1, column 1): Kai by the car, wide.');
		expect(prompt).toContain('Panel 2 (row 1, column 2): Close on the keys.');
		expect(prompt).toContain('Panel 9: plain black, empty.');
		expect(gridChunks(Array.from({ length: 10 }, (_, i) => i)).map((chunk) => chunk.length)).toEqual([9, 1]);
	});
});

async function setup(prompts: string[]) {
	const root = await mkdtemp(join(tmpdir(), 'csp-grid-')); roots.push(root);
	const store = new ProjectStore({ root });
	const gateway = new ProjectCommandGateway(store);
	const created = await gateway.createProject({ command: 'create_project', title: 'Grid', brief: '', creative_focus: 'full room', created_by: 'gordo' });
	if (!created.ok) throw new Error(created.error.message);
	const cards: StoryCard[] = prompts.map((prompt, i) => ({ card_id: `c${i}`, order: i, title: `Shot ${i}`, beat: 'x', purpose: 'y', duration_ms: 5000, image_prompt: prompt, video_prompt: 'v', status: 'draft', group_id: 'g1' }));
	const saved = await gateway.saveProduction({ command: 'save_production', project_id: created.data.project_id, expected_version: created.data.version,
		production: { ...created.data.production, cards, assets: [], groups: [{ group_id: 'g1', name: 'Scene 010', created_at: '2026-10-17T00:00:00.000Z' }] } });
	if (!saved.ok) throw new Error(saved.error.message);
	const calls: string[] = [];
	let status: GenerationStatus = 'queued';
	const deps: GridDeps = {
		store, gateway, projectRoot: root,
		images: { estimate: async () => ({ credits: 4 }), submit: async () => { calls.push('submit'); return { job_id: 'job-grid-1' }; }, status: async () => ({ status, url: status === 'completed' ? 'https://files.test/grid.png' : undefined }) },
		splitter: { split: async () => { throw new Error('unused'); }, splitGrid: async (_file, rows, cols) => ({ panels: Array.from({ length: rows * cols }, (_, i) => ({ index: i + 1, label: `${i + 1}` })), download: async () => new Uint8Array([255, 216, 255]) }) },
		download: async () => new Uint8Array([137, 80, 78, 71]), probe: async () => ({ width: 1280, height: 720 })
	};
	return { deps, project: saved.data, calls, setStatus: (next: GenerationStatus) => { status = next; } };
}

describe('grid stills against fakes', () => {
	test('a blocked prompt stops the grid before any spend', async () => {
		const { deps, project, calls } = await setup(['Cut to @Image 1 on the roof']);
		const quoted = await quoteGrids(deps, project, 'g1');
		if (!quoted.ok) throw new Error(quoted.message);
		const sent = await sendGrid(deps, { project_id: project.project_id, group_id: 'g1', chunk: 0, confirmed_credits: 4 });
		expect(quoted.grids[0].blocked.length > 0 === !sent.ok).toBeTrue();
		if (!sent.ok) expect(calls).toEqual([]);
	});

	test('send after approval, wait while pending, then one still per shot remembering its grid panel', async () => {
		const { deps, project, setStatus } = await setup(['Kai by the car, wide.', 'Close on the keys.']);
		const sent = await sendGrid(deps, { project_id: project.project_id, group_id: 'g1', chunk: 0, confirmed_credits: 4 });
		if (!sent.ok) throw new Error(sent.message);
		expect(sent.card_ids).toEqual(['c0', 'c1']);
		expect((await settleGrid(deps, { project_id: project.project_id, job_id: sent.job_id, card_ids: sent.card_ids }))).toEqual({ ok: true, pending: true });
		setStatus('completed');
		const settled = await settleGrid(deps, { project_id: project.project_id, job_id: sent.job_id, card_ids: sent.card_ids });
		if (!settled.ok || settled.pending) throw new Error('not settled');
		expect(settled.added).toBe(2);
		const stills = settled.project.production.assets;
		expect(stills.map((asset) => [asset.card_id, asset.kind, asset.grid?.panel, asset.width])).toEqual([['c0', 'image', 0, 1280], ['c1', 'image', 1, 1280]]);
		const again = await quoteGrids(deps, settled.project, 'g1');
		expect(again.ok && again.grids).toEqual([]);
	});

	test('a price above the confirmed one is refused', async () => {
		const { deps, project } = await setup(['Kai by the car, wide.']);
		const sent = await sendGrid(deps, { project_id: project.project_id, group_id: 'g1', chunk: 0, confirmed_credits: 2 });
		expect(sent.ok).toBeFalse();
		if (!sent.ok) expect(sent.reasons?.join(' ')).toContain('above the 2');
	});
});
