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
test('failed folder creation leaves the local board untouched and can be retried', async () => {
	const { store, gateway, project, client } = await setup();
	await expect(savePlannedBoard(project, gateway, { ...client, createFolder: async () => { throw Error('Offline'); } })).rejects.toThrow('Offline');
	expect((await store.readProject(project.project_id))?.version).toBe(project.version);
	expect((await store.readProject(project.project_id))?.production.cards).toHaveLength(0);
	const saved = await savePlannedBoard(project, gateway, client); expect(saved.ok).toBe(true);
});
