import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { previousShot } from '../../src/lib/domain/shot-references';
import type { Project, ProductionAsset, StoryCard } from '../../src/lib/domain/schemas';
import { attachPreviousFrame, lastFrameArgs, type PreviousFrameDeps } from '../../src/lib/server/previous-frame';
import { shotAttachments } from '../../src/lib/server/references';
import type { ReviewRoomClient } from '../../src/lib/server/review-room';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const shot = (id: string, order: number): StoryCard => ({ card_id: id, order, title: `Shot ${id}`, beat: `${id} happens`, purpose: 'Story', duration_ms: 4000, image_prompt: 'still', video_prompt: 'clip', status: 'draft' });
const take = (id: string, cardId: string, review = true): ProductionAsset => ({
	asset_id: id, card_id: cardId, kind: 'video', name: `${id}.mp4`, mime_type: 'video/mp4', url: `/api/projects/x/files/${id}.mp4`, created_at: '2026-10-17T00:00:00Z',
	...(review ? { review_room: { asset_id: `ra-${id}`, version_id: `rv-${id}`, version: 1, code: 'BLR_EP101_PAR_0010' } } : {})
});

async function setup(assets: ProductionAsset[] = [take('t1', 'a')]) {
	const root = await mkdtemp(join(tmpdir(), 'csp-refs-')); roots.push(root);
	const store = new ProjectStore({ root });
	const gateway = new ProjectCommandGateway(store);
	const created = await gateway.createProject({ command: 'create_project', title: 'Refs', brief: '', creative_focus: 'full room', created_by: 'gordo' });
	if (!created.ok) throw new Error(created.error.message);
	const saved = await gateway.saveProduction({
		command: 'save_production', project_id: created.data.project_id, expected_version: created.data.version,
		production: { status: 'draft', title: 'Refs', logline: '', premise: '', theme: '', cards: [shot('a', 0), shot('b', 1), shot('c', 2)], assets, updated_at: null }
	});
	if (!saved.ok) throw new Error(saved.error.message);
	const asked: string[] = [];
	const client = {
		versionMedia: async (versionId: string) => { asked.push(versionId); return { original: { url: `https://storage.test/${versionId}.mp4`, mimeType: 'video/mp4', sizeBytes: 1, expiresAt: 0 }, poster: null }; },
		download: async () => new Uint8Array([1])
	} as unknown as ReviewRoomClient;
	const frames: string[] = [];
	const deps: PreviousFrameDeps = {
		store, gateway, projectRoot: root, client,
		probe: async () => ({ width: 2560, height: 1440 }),
		lastFrame: async (source, output) => { frames.push(source); await writeFile(output, 'jpg'); }
	};
	return { root, store, gateway, deps, project: saved.data, asked, frames };
}

const ok = <T>(outcome: { ok: true; project: T } | { ok: false; message: string }): T => { if (!outcome.ok) throw new Error(outcome.message); return outcome.project; };

describe('previous shot as a reference', () => {
	test('takes the last frame of the previous pick from Review Room and stores it as a reference chip', async () => {
		const { root, deps, project, asked, frames } = await setup();
		const after = ok(await attachPreviousFrame(deps, { project_id: project.project_id, card_id: 'b', expected_version: project.version })) as Project;
		expect(asked).toEqual(['rv-t1']);
		expect(frames).toEqual(['https://storage.test/rv-t1.mp4']);
		const card = after.production.cards.find((entry) => entry.card_id === 'b')!;
		expect(card.references).toEqual([expect.objectContaining({ kind: 'previous_frame', from_card_id: 'a', take_id: 't1', width: 2560, height: 1440 })]);
		const attached = shotAttachments(root, after, card);
		expect(await readFile(attached.previousFrame!.file, 'utf8')).toBe('jpg');
		const lines = (await readFile(join(root, project.project_id, 'ledger.jsonl'), 'utf8')).trim().split('\n');
		expect(JSON.parse(lines.at(-1)!).type).toBe('project.shot_references_set.v1');
	});

	test('taking it again replaces the old frame and keeps series chips', async () => {
		const { gateway, deps, project } = await setup();
		const chipped = await gateway.handle({ command: 'set_shot_references', project_id: project.project_id, expected_version: project.version, card_id: 'b', references: [{ kind: 'series', page_id: 'kai' }, { kind: 'series', page_id: 'kai' }] });
		if (!chipped.ok) throw new Error(chipped.error.message);
		const chippedProject = chipped.data as Project;
		expect(chippedProject.production.cards[1].references).toEqual([{ kind: 'series', page_id: 'kai' }]);
		const once = ok(await attachPreviousFrame(deps, { project_id: project.project_id, card_id: 'b', expected_version: chippedProject.version })) as Project;
		const twice = ok(await attachPreviousFrame(deps, { project_id: project.project_id, card_id: 'b', expected_version: once.version })) as Project;
		expect(twice.production.cards[1].references?.map((reference) => reference.kind)).toEqual(['series', 'previous_frame']);
	});

	test('refused when the previous shot has no pick, or its pick is not in Review Room', async () => {
		const none = await setup([]);
		const refused = await attachPreviousFrame(none.deps, { project_id: none.project.project_id, card_id: 'b', expected_version: none.project.version });
		expect(refused).toMatchObject({ ok: false, status: 400, message: 'The previous shot has no pick yet' });
		const local = await setup([take('t1', 'a', false)]);
		const notStored = await attachPreviousFrame(local.deps, { project_id: local.project.project_id, card_id: 'b', expected_version: local.project.version });
		expect(notStored).toMatchObject({ ok: false, status: 400 });
		const first = await attachPreviousFrame(none.deps, { project_id: none.project.project_id, card_id: 'a', expected_version: none.project.version });
		expect(first.ok).toBeFalse();
	});

	test('the previous shot skips benched shots', async () => {
		const { gateway, project } = await setup();
		const benched = await gateway.benchBeat({ command: 'bench_beat', project_id: project.project_id, expected_version: project.version, card_id: 'b' });
		if (!benched.ok) throw new Error(benched.error.message);
		expect(previousShot(benched.data.production, 'c')?.card_id).toBe('a');
	});

	test('ffmpeg seeks from the end for the last frame', () => {
		expect(lastFrameArgs('https://x/v.mp4', 'out.jpg')).toEqual(['-y', '-sseof', '-0.5', '-i', 'https://x/v.mp4', '-update', '1', '-q:v', '2', 'out.jpg']);
	});
});
