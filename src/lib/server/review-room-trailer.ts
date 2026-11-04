import type { Project } from '$lib/domain/schemas';
import { idempotencyKey, type ReviewRoomClient } from './review-room';

/** Register every board shot, including shots without takes, under a standalone trailer. */
export async function connectTrailer(client: ReviewRoomClient, project: Project, input: {
	project_id: string; folder_id: string; show_code: string; code: string; reference_series_id?: string;
}): Promise<NonNullable<Project['review_room']>> {
	const folders = await client.folders(input.project_id);
	const root = folders.find((folder) => folder.id === input.folder_id);
	if (!root?.ownedByCaller) throw new Error('The trailer folder must be connected to Creative Studio Pro first');
	if (project.review_room && (project.review_room.project_id !== input.project_id || project.review_room.folder_id !== input.folder_id || project.review_room.code !== input.code || project.review_room.show_code !== input.show_code)) throw new Error('This trailer already has a different connection');
	const shots = { ...project.review_room?.shots };
	let next = Math.max(0, ...Object.values(shots).map((shot) => Number(shot.code.split('_').at(-1)) || 0)) + 10;
	for (const card of project.production.cards.toSorted((a, b) => a.order - b.order)) {
		if (shots[card.card_id]) continue;
		const code = `${input.show_code}_${input.code}_SHT_${String(next).padStart(4, '0')}`;
		const title = `${code} — ${card.title}`.slice(0, 200);
		const existing = folders.find((f) => f.parentFolderId === root.id && f.ownedByCaller && f.title.startsWith(code + ' —'));
		const folder = existing ?? await client.createFolder(input.project_id, title, root.id, idempotencyKey('trailer-shot', project.project_id, card.card_id));
		shots[card.card_id] = { code, folder_id: folder.id }; next += 10;
	}
	return { ...input, shots, cursor: project.review_room?.cursor };
}
