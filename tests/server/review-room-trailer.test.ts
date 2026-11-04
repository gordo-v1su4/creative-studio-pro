import { expect, test } from 'bun:test';
import { connectTrailer } from '../../src/lib/server/review-room-trailer';
import type { ReviewRoomClient } from '../../src/lib/server/review-room';
import type { Project } from '../../src/lib/domain/schemas';

const input = { project_id: 'room', folder_id: 'trailer', show_code: 'BLR', code: 'TR100' };
function setup(owned = true) {
	const folders = [{ id: 'trailer', title: 'TR100 — Teaser Trailer', parentFolderId: null as string | null, ownedByCaller: owned }];
	const client = { folders: async () => folders, createFolder: async (_: string, title: string, parentFolderId: string) => {
		const folder = { id: `folder-${folders.length}`, title, parentFolderId, ownedByCaller: true }; folders.push(folder); return folder;
	} } as unknown as ReviewRoomClient;
	const project = { project_id: 'local', production: { cards: [{ card_id: 'a', order: 0, title: 'Rooftop' }, { card_id: 'b', order: 1, title: 'A shot without media' }] } } as unknown as Project;
	return { client, project, folders };
}
test('trailer registers empty shots and keeps codes and folders stable after reordering', async () => {
	const { client, project, folders } = setup();
	const first = await connectTrailer(client, project, input);
	expect(first.shots.a.code).toBe('BLR_TR100_SHT_0010');
	expect(first.shots.b.code).toBe('BLR_TR100_SHT_0020');
	project.review_room = first;
	project.production.cards.reverse();
	project.production.cards.push({ card_id: 'c', order: 0, title: 'New insert' } as never);
	const second = await connectTrailer(client, project, input);
	expect(second.shots.a).toEqual(first.shots.a);
	expect(second.shots.c.code).toBe('BLR_TR100_SHT_0030');
	expect(folders).toHaveLength(4);
});
test('connection retries reuse folders created before the local connection was saved', async () => {
	const { client, project, folders } = setup();
	const first = await connectTrailer(client, project, input);
	expect(await connectTrailer(client, project, input)).toEqual(first);
	expect(folders).toHaveLength(3);
});
test('ordinary folders and changing an existing connection are rejected', async () => {
	const { client, project } = setup(false);
	await expect(connectTrailer(client, project, input)).rejects.toThrow('connected');
	const own = setup(); own.project.review_room = { ...input, shots: {}, code: 'TR101' };
	await expect(connectTrailer(own.client, own.project, input)).rejects.toThrow('different connection');
});
