import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { productionStateSchema } from '../../src/lib/domain/schemas';
import { savePlannedBoard } from '../../src/lib/server/planned-board';
import type { ReviewRoomClient } from '../../src/lib/server/review-room';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup() {
	const root = await mkdtemp(join(tmpdir(), 'csp-plan-')); roots.push(root);
	const store = new ProjectStore({ root }), gateway = new ProjectCommandGateway(store);
	const p = await store.createProject({ title: 'TR105', brief: 'Test', creative_focus: 'full room', created_by: 'test' });
	const project = await store.updateProject(p.project_id, p.version, current => ({ ...current,
		review_room: { project_id: 'room', folder_id: 'trailer', code: 'TR105', show_code: 'BLR', shots: {} },
		production: productionStateSchema.parse({ story_plan: { title: 'Trailer', sections: [{ id: 'act', title: 'Act', summary: '', moments: [{ id: 'moment', title: 'A moment', beat: 'Kai watches.', duration_s: 6, characters: ['Kai'], location: 'Roof', approved: true, shots: [{ id: 'shot', title: 'The look', beat: 'Kai watches.', duration_s: 6 }] }] }] } })
	}));
	const folders = [{ id: 'trailer', title: 'TR105 — Teaser Trailer', parentFolderId: null as string | null, ownedByCaller: true }];
	const client = { folders: async () => folders, createFolder: async (_: string, title: string, parentFolderId: string) => { const folder = { id: 'shot-folder', title, parentFolderId, ownedByCaller: true }; folders.push(folder); return folder; } } as unknown as ReviewRoomClient;
	return { store, gateway, project, client, folders };
}
test('adding approved shots also persists TR105 folders; a repeat creates neither duplicate cards nor folders', async () => {
	const { store, gateway, project, client, folders } = await setup();
	const saved = await savePlannedBoard(project, gateway, client); if (!saved.ok) throw Error(saved.error.message);
	const card = saved.data.production.cards[0];
	expect(card.benched).toBe(true);
	expect(saved.data.review_room?.shots[card.card_id]).toEqual({ code: 'BLR_TR105_SHT_0010', folder_id: 'shot-folder' });
	expect((await store.readProject(project.project_id))?.review_room).toEqual(saved.data.review_room);
	const again = await savePlannedBoard(saved.data, gateway, client); if (!again.ok) throw Error(again.error.message);
	expect(again.data.production.cards).toEqual(saved.data.production.cards);
	expect(folders).toHaveLength(2);
});
test('a coded scene becomes a Review Room scene folder beside the existing scenes; a scene mapped onto an existing group keeps its code', async () => {
	const { store, gateway, project } = await setup();
	const folders = [
		{ id: 'trailer', title: 'TR110 — Teaser Trailer', parentFolderId: null as string | null, ownedByCaller: true },
		{ id: 'pck', title: '080 PCK — Red', parentFolderId: 'trailer', ownedByCaller: true }
	];
	const created: string[] = [];
	const client = { folders: async () => folders, createFolder: async (_: string, title: string, parentFolderId: string) => { const folder = { id: `f${created.length}`, title, parentFolderId, ownedByCaller: true }; created.push(title); folders.push(folder); return folder; } } as unknown as ReviewRoomClient;
	const p = await store.updateProject(project.project_id, project.version, (current) => ({ ...current,
		review_room: { project_id: 'room', folder_id: 'trailer', code: 'TR110', show_code: 'BLR', scenes: { 'seq-08': { code: 'PCK', folder_id: 'pck' } }, shots: { rush: { code: 'BLR_TR110_PCK_0020', folder_id: 'pck' } } },
		production: productionStateSchema.parse({
			groups: [{ group_id: 'seq-08', name: 'TR110 08 · Red', created_at: '2026-11-21T00:00:00Z' }],
			cards: [{ card_id: 'rush', group_id: 'seq-08', order: 0, title: 'TR110-08-02 · Restraint slips', beat: 'x', purpose: 'x', duration_ms: 6000, image_prompt: 'x', video_prompt: 'x', status: 'draft' }],
			story_plan: { title: 'TR110', sections: [
				{ id: 'act-3', title: 'Act 3 · What the Camera Saw', summary: '',
					scenes: [{ id: 'pck', title: 'Red and the pickup deadline', group_id: 'seq-08', scene_code: 'PCK' }, { id: 'wcs', title: 'The watcher', scene_code: 'WCS' }],
					moments: [
						{ id: 'red', title: 'Red and the watcher', beat: 'x', duration_s: 6, approved: true, scene_id: 'pck', shots: [{ id: 'linked', title: 'The Rush', beat: 'x', duration_s: 6, card_id: 'rush' }] },
						{ id: 'film', title: 'Someone films', beat: 'x', duration_s: 6, approved: true, scene_id: 'wcs', shots: [{ id: 'watcher', title: 'The watcher', beat: 'x', duration_s: 6 }] }
					] },
				{ id: 'act-4', title: 'Act 4', summary: '', moments: [{ id: 'm4', title: 'Later', beat: 'x', duration_s: 4, approved: true, shots: [{ id: 'later', title: 'Later', beat: 'x', duration_s: 4 }] }] }
			] }
		})
	}));
	const saved = await savePlannedBoard(p, gateway, client); if (!saved.ok) throw Error(saved.error.message);
	const room = saved.data.review_room!;
	expect(room.scenes?.['seq-08']).toEqual({ code: 'PCK', folder_id: 'pck' });
	expect(room.scenes?.['plan-scene-wcs']?.code).toBe('WCS');
	expect(created).toEqual(['020 WCS — TR110 · The watcher']);
	expect(room.shots.rush.code).toBe('BLR_TR110_PCK_0020');
	expect(room.shots['plan-shot-watcher'].code).toBe('BLR_TR110_WCS_0010');
	expect(room.shots['plan-shot-linked']).toBeUndefined();
	expect(room.shots['plan-shot-later']).toBeUndefined(); // no scene code, so no folder and no code yet
	const again = await savePlannedBoard(saved.data, gateway, client); if (!again.ok) throw Error(again.error.message);
	expect(again.data.review_room).toEqual(room);
	expect(created).toHaveLength(1);
});

test('failed folder creation leaves the local board untouched and can be retried', async () => {
	const { store, gateway, project, client } = await setup();
	await expect(savePlannedBoard(project, gateway, { ...client, createFolder: async () => { throw Error('Offline'); } })).rejects.toThrow('Offline');
	expect((await store.readProject(project.project_id))?.version).toBe(project.version);
	expect((await store.readProject(project.project_id))?.production.cards).toHaveLength(0);
	const saved = await savePlannedBoard(project, gateway, client); expect(saved.ok).toBe(true);
});
