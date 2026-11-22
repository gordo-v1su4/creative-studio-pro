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

function sceneSetup() {
	const folders = [{ id: 'trailer', title: 'TR110 — Teaser Trailer', parentFolderId: null as string | null, ownedByCaller: true }];
	const client = { folders: async () => folders, createFolder: async (_: string, title: string, parentFolderId: string) => {
		const folder = { id: `folder-${folders.length}`, title, parentFolderId, ownedByCaller: true }; folders.push(folder); return folder;
	} } as unknown as ReviewRoomClient;
	const project = { project_id: 'local', production: {
		groups: [{ group_id: 'g1', name: 'TR110 01 · The sealed drop and the hood' }, { group_id: 'g2', name: 'TR110 02 · The shadow and the morning after' }, { group_id: 'src', name: 'Sources' }],
		cards: [
			{ card_id: 'a', order: 0, title: 'TR110-01-01 · Down the service stairs', group_id: 'g1' },
			{ card_id: 'b', order: 1, title: 'TR110-01-02 · The silver chain', group_id: 'g1' },
			{ card_id: 'c', order: 2, title: 'TR110-02-01 · Kai pulls back', group_id: 'g2' },
			{ card_id: 'd', order: 3, title: 'TR110-02-01a · Bryson in the chapel arcade', group_id: 'g2' },
			{ card_id: 'e', order: 4, title: 'TR110-02-02 · The grate is empty', group_id: 'g2' },
			{ card_id: 's', order: 5, title: 'A whole-sequence render', group_id: 'src' }
		]
	} } as unknown as Project;
	const input = { project_id: 'room', folder_id: 'trailer', show_code: 'BLR', code: 'TR110', scenes: [{ group_id: 'g1', code: 'DRP' }, { group_id: 'g2', code: 'MRN' }] };
	return { client, project, folders, input };
}
test('story sequences become scene folders and shots take their planned numbers', async () => {
	const { client, project, folders, input } = sceneSetup();
	const tree = await connectTrailer(client, project, input);
	expect(folders.map((f) => f.title)).toEqual(['TR110 — Teaser Trailer', '010 DRP — The sealed drop and the hood', '020 MRN — The shadow and the morning after']);
	expect(tree.shots.a).toEqual({ code: 'BLR_TR110_DRP_0010', folder_id: 'folder-1' });
	expect(tree.shots.b.code).toBe('BLR_TR110_DRP_0020');
	expect([tree.shots.c.code, tree.shots.d.code, tree.shots.e.code]).toEqual(['BLR_TR110_MRN_0010', 'BLR_TR110_MRN_0015', 'BLR_TR110_MRN_0020']);
	expect(tree.shots.s).toBeUndefined();
	expect(tree.scenes?.g2).toEqual({ code: 'MRN', folder_id: 'folder-2' });
});
test('a shot added later takes the gap and nothing already coded moves', async () => {
	const { client, project, folders, input } = sceneSetup();
	project.review_room = await connectTrailer(client, project, input);
	const before = structuredClone(project.review_room.shots);
	project.production.cards.splice(1, 0, { card_id: 'x', order: 0.5, title: 'Unplanned insert', group_id: 'g1' } as never);
	project.production.cards.push({ card_id: 'y', order: 9, title: 'Late addition', group_id: 'g1' } as never);
	const again = await connectTrailer(client, project, input);
	for (const [id, shot] of Object.entries(before)) expect(again.shots[id]).toEqual(shot);
	expect(again.shots.x.code).toBe('BLR_TR110_DRP_0015');
	expect(again.shots.y.code).toBe('BLR_TR110_DRP_0030');
	expect(folders).toHaveLength(3);
	await expect(connectTrailer(client, project, { ...input, scenes: [{ group_id: 'g1', code: 'XXX' }] })).rejects.toThrow('already uses scene code DRP');
});
test('a reconnect without scenes (new planned shots) keeps the scene tree', async () => {
	const { client, project, folders, input } = sceneSetup();
	project.review_room = await connectTrailer(client, project, input);
	project.production.cards.push({ card_id: 'z', order: 9, title: 'TR110-02-03 · Outside in the rain', group_id: 'g2' } as never);
	const { scenes: _, ...plain } = input;
	const again = await connectTrailer(client, project, plain);
	expect(again.shots.z.code).toBe('BLR_TR110_MRN_0030');
	expect(again.scenes).toEqual(project.review_room.scenes);
	expect(folders).toHaveLength(3);
});

test('a connected trailer stores exported cuts as versions of BLR_TR110_TRL01 in its own _Deliverables', async () => {
	const { pushDeliverable } = await import('../../src/lib/server/review-room-takes');
	const { mkdtemp, writeFile } = await import('node:fs/promises');
	const { tmpdir } = await import('node:os');
	const { join } = await import('node:path');
	const dir = await mkdtemp(join(tmpdir(), 'csp-deliv-'));
	const file = join(dir, 'cut.mp4'); await writeFile(file, 'mp4');
	const folders = [{ id: 'trailer', title: 'TR110 — Teaser Trailer', parentFolderId: null as string | null, ownedByCaller: true }];
	const uploads: Array<{ folderId: string; assetCode: string }> = [];
	let saved: unknown = null;
	const project = { project_id: 'p', version: 3, title: 'TR110', review_room: { project_id: 'room', folder_id: 'trailer', code: 'TR110', show_code: 'BLR', shots: {} } };
	const client = {
		folders: async () => folders,
		createFolder: async (_: string, title: string, parentFolderId: string) => { const f = { id: 'deliv', title, parentFolderId, ownedByCaller: true }; folders.push(f); return f; },
		beginUpload: async (input: { folderId: string; assetCode: string }) => { uploads.push(input); return { sessionId: 's', url: 'u', posterUrl: 'pu' }; },
		putSigned: async () => {}, completeUpload: async () => ({ assetId: 'a' }),
		changes: async () => ({ cursor: '1', assets: [], removedAssets: [], versions: [{ versionId: 'v', assetId: 'a', version: uploads.length, isCurrent: true }] }),
		setCurrentVersion: async () => {}, putMetadata: async () => {}
	};
	const deps = {
		store: { readProject: async () => project, updateProject: async (_: string, __: number, fn: (p: unknown) => unknown) => { saved = fn(project); return saved; } },
		client, probe: async () => ({ duration_s: 137, width: 1920, height: 1080 }), poster: async (_: string, out: string) => { await writeFile(out, 'jpg'); }
	} as never;
	const stored = await pushDeliverable(deps, 'p', { file, name: 'rough-cut-18.mp4', kind: 'TRL', scope: 'episode' });
	expect(stored.ok && stored.code).toBe('BLR_TR110_TRL01');
	expect(folders.at(-1)).toMatchObject({ title: '_Deliverables', parentFolderId: 'trailer' });
	expect(uploads[0]).toMatchObject({ folderId: 'deliv', assetCode: 'BLR_TR110_TRL01' });
	expect((saved as { review_room: { deliverables_folder_id: string } }).review_room.deliverables_folder_id).toBe('deliv');
	// V1S-505: the QC report rides along — its verdict as a field, the report under the notes.
	const metadata: Array<Record<string, unknown>> = [];
	client.putMetadata = (async (_: string, m: Record<string, unknown>) => { metadata.push(m); }) as never;
	const qc = { at: '2026-11-22T18:00:00Z', file: 'cut.mp4', status: 'fail' as const, duration_s: 137, checks: [
		{ id: 'lip_sync' as const, label: 'Lip sync', status: 'fail' as const, summary: '1 entry measured (1 with dialogue); 1 off or unsure', items: [{ status: 'fail' as const, at_s: 45.18, message: '07 Mara: dialogue +100 ms (late, over 40 ms)' }] }
	] };
	await pushDeliverable(deps, 'p', { file, name: 'rough-cut-21.mp4', kind: 'TRL', scope: 'episode', cut: 'Rough cut 21', qc });
	expect(String(metadata[0].notes).split('\n')).toEqual([
		'Rough cut 21 · Trailer · TR110 · 137.0 s', '',
		'QC FAIL · lip sync fail', 'FAIL Lip sync: 1 entry measured (1 with dialogue); 1 off or unsure', '✗ 0:45.18 07 Mara: dialogue +100 ms (late, over 40 ms)'
	]);
	expect(metadata[0].customFields).toContainEqual({ id: 'qc', label: 'qc', kind: 'text', value: 'QC FAIL · lip sync fail' });
});
test('a removed shot keeps its number: a replacement never reuses its code', async () => {
	const { client, project, input } = sceneSetup();
	project.review_room = await connectTrailer(client, project, input);
	// Remove "The silver chain" (DRP_0020) and add a new shot at the end of the sequence.
	project.production.cards = project.production.cards.filter((card) => card.card_id !== 'b');
	project.production.cards.push({ card_id: 'n', order: 9, title: 'A new shot', group_id: 'g1' } as never);
	const again = await connectTrailer(client, project, input);
	expect(again.shots.b.code).toBe('BLR_TR110_DRP_0020');
	expect(again.shots.n.code).toBe('BLR_TR110_DRP_0030');
});
test('a scene code stays with its sequence even when that sequence is left out of a reconnect', async () => {
	const { client, project, input } = sceneSetup();
	project.review_room = await connectTrailer(client, project, input);
	project.production.groups!.push({ group_id: 'g3', name: 'TR110 03 · Everybody knows Kai' } as never);
	await expect(connectTrailer(client, project, { ...input, scenes: [{ group_id: 'g3', code: 'DRP' }] })).rejects.toThrow('already belongs to another sequence');
});
