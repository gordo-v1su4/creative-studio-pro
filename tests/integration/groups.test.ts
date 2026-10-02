import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { groupOf, groupsOf, shotsOf, type SplitterManifest } from '../../src/lib/domain/groups';
import type { ProductionAsset, Project, StoryCard } from '../../src/lib/domain/schemas';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function setup() {
	const root = await mkdtemp(join(tmpdir(), 'csp-groups-')); roots.push(root);
	const gateway = new ProjectCommandGateway(new ProjectStore({ root }));
	const created = await gateway.createProject({ command: 'create_project', title: 'Groups', brief: '', creative_focus: 'full room', created_by: 'gordo' });
	if (!created.ok) throw new Error(created.error.message);
	const beat = (card_id: string, order: number): StoryCard => ({ card_id, order, title: card_id, beat: 'b', purpose: 'p', duration_ms: 3000, image_prompt: 'i', video_prompt: 'v', status: 'draft' });
	const take: ProductionAsset = { asset_id: 'trailer', card_id: 'a', kind: 'video', name: 'trailer-20s.mp4', mime_type: 'video/mp4', url: '/files/trailer-20s.mp4', created_at: '2026-10-01T00:00:00.000Z' };
	const saved = await gateway.saveProduction({ command: 'save_production', project_id: created.data.project_id, expected_version: created.data.version, production: { status: 'draft', title: 'G', logline: '', premise: '', theme: '', cards: [beat('a', 0), beat('b', 1)], assets: [take], updated_at: null } });
	if (!saved.ok) throw new Error(saved.error.message);
	return { gateway, project: saved.data };
}
const ok = (outcome: { ok: true; data: Project } | { ok: false; error: { message: string } }) => { if (!outcome.ok) throw new Error(outcome.error.message); return outcome.data; };

describe('board groups', () => {
	test('beats start in Main; groups are created, renamed, and beats move between them', async () => {
		const { gateway, project } = await setup();
		expect(groupsOf(project.production)).toEqual([{ group_id: 'main', name: 'Main', count: 2 }]);
		const id = project.project_id;
		const made = ok(await gateway.changeGroups({ command: 'create_group', project_id: id, expected_version: project.version, group_id: 'review', name: 'Trailer review' }));
		const moved = ok(await gateway.changeGroups({ command: 'move_beats', project_id: id, expected_version: made.version, group_id: 'review', card_ids: ['b'] }));
		expect(groupsOf(moved.production).map((g) => [g.name, g.count])).toEqual([['Main', 1], ['Trailer review', 1]]);
		const renamed = ok(await gateway.changeGroups({ command: 'rename_group', project_id: id, expected_version: moved.version, group_id: 'review', name: 'Review' }));
		expect(groupsOf(renamed.production)[1].name).toBe('Review');
		const back = ok(await gateway.changeGroups({ command: 'move_beats', project_id: id, expected_version: renamed.version, group_id: 'main', card_ids: ['b'] }));
		expect(back.production.cards.find((c) => c.card_id === 'b')!.group_id).toBeUndefined();

		const dup = await gateway.changeGroups({ command: 'create_group', project_id: id, expected_version: back.version, group_id: 'other', name: 'review' });
		expect(dup.ok).toBeFalse();
		const nowhere = await gateway.changeGroups({ command: 'move_beats', project_id: id, expected_version: back.version, group_id: 'nope', card_ids: ['a'] });
		expect(nowhere.ok).toBeFalse();
	});

	test('a beat dropped on the board joins the group being shown', async () => {
		const { gateway, project } = await setup();
		const made = ok(await gateway.changeGroups({ command: 'create_group', project_id: project.project_id, expected_version: project.version, group_id: 'g1', name: 'Shots' }));
		const added = ok(await gateway.addBeat({ command: 'add_beat', project_id: project.project_id, expected_version: made.version, card_id: 'dropped', title: 'Dropped', group_id: 'g1', take: { asset_id: 'd1', kind: 'video', name: 'd.mp4', mime_type: 'video/mp4', url: '/files/d.mp4', created_at: '2026-10-01T00:00:00.000Z' } }));
		expect(groupOf(added.production.cards.find((c) => c.card_id === 'dropped')!)).toBe('g1');
	});
});

describe('split into shots (fake splitter manifest)', () => {
	const manifest: SplitterManifest = { job_id: 'job1', frame_rate: 24, segments: [
		{ index: 2, start_seconds: 4.25, end_seconds: 9.5, duration_seconds: 5.25, clip_path: 'clips/seg_002.mp4' },
		{ index: 1, start_seconds: 0, end_seconds: 4.25, duration_seconds: 4.25, clip_path: 'clips/seg_001.mp4' },
		{ index: 3, start_seconds: 9.5, end_seconds: 9.52, duration_seconds: 0.02, clip_path: 'clips/seg_003.mp4' }
	] };

	test('segments become ordered shots; a sliver under two frames is dropped', () => {
		expect(shotsOf(manifest)).toEqual([
			{ index: 1, in_s: 0, out_s: 4.25, clip_path: 'clips/seg_001.mp4', file_name: '01-shot.mp4' },
			{ index: 2, in_s: 4.25, out_s: 9.5, clip_path: 'clips/seg_002.mp4', file_name: '02-shot.mp4' }
		]);
	});

	test('a split makes a new group of shot beats, each slice remembering its source take and in/out; they stay off the spine', async () => {
		const { gateway, project } = await setup();
		let n = 0;
		const shots = shotsOf(manifest).map((shot) => ({ ...shot, url: `/files/shots/${shot.file_name}`, width: 854, height: 480 }));
		const split = ok(await gateway.splitIntoShots(project.project_id, project.version, { group_id: 'v6', name: 'V6 trailer — shots', source: project.production.assets[0], shots, ids: () => `id${++n}` }));
		expect(groupsOf(split.production).map((g) => [g.name, g.count])).toEqual([['Main', 2], ['V6 trailer — shots', 2]]);
		const shotBeats = split.production.cards.filter((c) => c.group_id === 'v6');
		expect(shotBeats.map((c) => [c.title, c.duration_ms])).toEqual([['V6 trailer — shots — shot 1', 4250], ['V6 trailer — shots — shot 2', 5250]]);
		const slices = split.production.assets.filter((a) => a.source_take);
		expect(slices.map((a) => a.source_take)).toEqual([{ asset_id: 'trailer', in_s: 0, out_s: 4.25 }, { asset_id: 'trailer', in_s: 4.25, out_s: 9.5 }]);
		expect(shotBeats.every((c) => c.pick_take_id && slices.some((a) => a.asset_id === c.pick_take_id))).toBeTrue();
		expect((split.production.links ?? []).some((l) => shotBeats.some((c) => c.card_id === l.to))).toBeFalse();
	});
});
