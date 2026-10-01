import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { isUnder2K, mediaKind, safeFileName } from '../../src/lib/domain/media';
import { benchedBeats } from '../../src/lib/domain/bench';
import { pickFor, takesFor } from '../../src/lib/domain/takes';
import { spineBeats } from '../../src/lib/domain/spine';
import type { Project, StoryCard } from '../../src/lib/domain/schemas';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const beat = (id: string, order: number): StoryCard => ({
	card_id: id, order, title: id, beat: `${id} happens`, purpose: 'Story', duration_ms: 3000,
	image_prompt: 'still', video_prompt: 'clip', status: 'draft'
});
const dropped = (id: string, kind: 'image' | 'video', extra: Record<string, number> = {}) => ({
	asset_id: id, kind, name: `${id}.${kind === 'image' ? 'png' : 'mp4'}`, mime_type: `${kind}/*`,
	url: `/api/projects/p/files/board/${id}`, created_at: '2026-10-01T19:00:00.000Z', ...extra
});

async function setup() {
	const root = await mkdtemp(join(tmpdir(), 'csp-intake-')); roots.push(root);
	const gateway = new ProjectCommandGateway(new ProjectStore({ root }));
	const created = await gateway.createProject({ command: 'create_project', title: 'Intake', brief: '', creative_focus: 'full room', created_by: 'gordo' });
	if (!created.ok) throw new Error(created.error.message);
	const saved = await gateway.saveProduction({
		command: 'save_production', project_id: created.data.project_id, expected_version: created.data.version,
		production: { status: 'draft', title: 'Intake', logline: '', premise: '', theme: '', cards: [beat('a', 0), beat('b', 1)], assets: [], updated_at: null }
	});
	if (!saved.ok) throw new Error(saved.error.message);
	return { root, gateway, project: saved.data };
}
function ok(outcome: Awaited<ReturnType<ProjectCommandGateway['addTake']>>): Project {
	if (!outcome.ok) throw new Error(outcome.error.message);
	return outcome.data;
}

describe('dropping media on the board', () => {
	test('add_take puts a new take on the beat and makes it the pick; persists with its own ledger event', async () => {
		const { root, gateway, project } = await setup();
		const first = ok(await gateway.addTake({ command: 'add_take', project_id: project.project_id, expected_version: project.version, card_id: 'a', take: dropped('t1', 'video', { width: 854, height: 480, duration_s: 5 }) }));
		const second = ok(await gateway.addTake({ command: 'add_take', project_id: project.project_id, expected_version: first.version, card_id: 'a', take: dropped('t2', 'image', { width: 2048, height: 1152 }) }));
		expect(takesFor(second.production, 'a').map((t) => t.asset_id)).toEqual(['t1', 't2']);
		expect(pickFor(second.production, second.production.cards[0])?.asset_id).toBe('t2');
		const reloaded = await new ProjectStore({ root }).readProject(project.project_id);
		expect(reloaded!.production.assets.find((a) => a.asset_id === 't1')).toMatchObject({ width: 854, height: 480, duration_s: 5 });
		const lines = (await readFile(join(root, project.project_id, 'ledger.jsonl'), 'utf8')).trim().split('\n');
		expect(JSON.parse(lines.at(-1)!).type).toBe('project.take_added.v1');
	});

	test('add_take refuses an unknown beat and a duplicate take', async () => {
		const { gateway, project } = await setup();
		expect((await gateway.addTake({ command: 'add_take', project_id: project.project_id, expected_version: project.version, card_id: 'zz', take: dropped('t1', 'image') })).ok).toBeFalse();
		const added = ok(await gateway.addTake({ command: 'add_take', project_id: project.project_id, expected_version: project.version, card_id: 'a', take: dropped('t1', 'image') }));
		expect((await gateway.addTake({ command: 'add_take', project_id: project.project_id, expected_version: added.version, card_id: 'b', take: dropped('t1', 'image') })).ok).toBeFalse();
	});

	test('add_beat makes a benched beat off the spine holding the take; the story order is unchanged', async () => {
		const { gateway, project } = await setup();
		const added = ok(await gateway.addBeat({ command: 'add_beat', project_id: project.project_id, expected_version: project.version, card_id: 'n', title: 'Title card', take: dropped('t9', 'video', { duration_s: 2.5 }) }));
		expect(spineBeats(added.production).map((c) => c.card_id)).toEqual(['a', 'b']);
		expect(benchedBeats(added.production).map((c) => c.card_id)).toEqual(['n']);
		const card = added.production.cards.find((c) => c.card_id === 'n')!;
		expect(card).toMatchObject({ title: 'Title card', duration_ms: 2500, pick_take_id: 't9', benched: true });
		expect(pickFor(added.production, card)?.asset_id).toBe('t9');
	});
});

describe('media rules', () => {
	test('only images and videos are taken', () => {
		expect(mediaKind('shot.MP4')).toBe('video');
		expect(mediaKind('still.jpeg')).toBe('image');
		expect(mediaKind('song.mp3')).toBeNull();
		expect(mediaKind('notes')).toBeNull();
	});

	test('stills under 2K on the long edge are flagged; videos and unknown sizes are not', () => {
		expect(isUnder2K({ kind: 'image', width: 1920, height: 1080 })).toBeTrue();
		expect(isUnder2K({ kind: 'image', width: 1152, height: 2048 })).toBeFalse();
		expect(isUnder2K({ kind: 'video', width: 854, height: 480 })).toBeFalse();
		expect(isUnder2K({ kind: 'image' })).toBeFalse();
	});

	test('file names are made safe for the project folder', () => {
		expect(safeFileName('../../etc/pass wd.png')).toBe('etc-pass-wd.png');
		expect(safeFileName('Mara — floor (v2).mp4')).toBe('Mara-floor-v2-.mp4');
	});
});
