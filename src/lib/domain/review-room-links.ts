/**
 * Addresses in Review Room (ADR 0008: each app links to the other). One page there shows a project, and within it
 * a folder, a shot and one version of it: `/?project=…&folder=…&asset=…&version=…`. A link carries as much as this
 * app knows; Review Room opens the deepest part it can find.
 */
import type { Project } from './schemas';

export interface RoomAddress { project: string; folder?: string; asset?: string; version?: string }

export function roomLink(base: string | null | undefined, address: RoomAddress): string | null {
	const origin = base?.trim().replace(/\/+$/, '');
	if (!origin || !address.project) return null;
	const query = new URLSearchParams({ project: address.project });
	if (address.folder) query.set('folder', address.folder);
	if (address.asset) query.set('asset', address.asset);
	if (address.version) query.set('version', address.version);
	return `${origin}/?${query}`;
}

/** Any take: only where it is stored in Review Room matters here. */
type StoredTake = { review_room?: { asset_id: string; version_id: string }; [key: string]: unknown } | null | undefined;

/** A shot there: the exact version when this take is stored, else the shot's folder, else the project's folder. */
export function shotRoomLink(base: string | null | undefined, project: Project, cardId: string, take: StoredTake): string | null {
	const room = project.review_room;
	if (!room) return null;
	const folder = room.shots[cardId]?.folder_id ?? room.folder_id;
	return roomLink(base, { project: room.project_id, folder, ...(take?.review_room ? { asset: take.review_room.asset_id, version: take.review_room.version_id } : {}) });
}

/** A scene there: its folder when the group is a scene in Review Room, else the project's folder. */
export function sceneRoomLink(base: string | null | undefined, project: Project, groupId: string): string | null {
	const room = project.review_room;
	if (!room) return null;
	return roomLink(base, { project: room.project_id, folder: room.scenes?.[groupId]?.folder_id ?? room.folder_id });
}
