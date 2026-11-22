import type { Project } from '$lib/domain/schemas';
import type { ProjectCommandGateway } from '$lib/application/gateway';
import { appendPlannedShots, plannedGroupId } from '$lib/domain/story-plan';
import { connectTrailer } from './review-room-trailer';
import type { ReviewRoomClient } from './review-room';

/**
 * The Review Room scenes after Add to Board: every scene the trailer already has, plus each story section with a
 * scene code whose board group exists now. Undefined when no section asks for one (the connection keeps what it has).
 */
export function plannedScenes(project: Project, production: Project['production']): Array<{ group_id: string; code: string }> | undefined {
	const known = Object.entries(project.review_room?.scenes ?? {}).map(([group_id, scene]) => ({ group_id, code: scene.code }));
	const asked = (production.story_plan?.sections ?? []).flatMap((section) => {
		const group_id = plannedGroupId(section.id);
		return section.scene_code && production.groups?.some((group) => group.group_id === group_id) && !known.some((scene) => scene.group_id === group_id)
			? [{ group_id, code: section.scene_code }] : [];
	});
	return asked.length ? [...known, ...asked] : undefined;
}

/** Save the board and permanent folder mapping together. Failed/retried remote work is idempotent. */
export async function savePlannedBoard(project: Project, gateway: ProjectCommandGateway, client?: ReviewRoomClient) {
	const production = appendPlannedShots(project.production, new Date().toISOString());
	if (project.review_room && !client) throw new Error('Review Room must be configured before adding this trailer’s shots');
	const connection = project.review_room && client
		? await connectTrailer(client, { ...project, production }, { ...project.review_room, scenes: plannedScenes(project, production) })
		: undefined;
	return gateway.saveProduction({ command: 'save_production', project_id: project.project_id, expected_version: project.version, production }, connection);
}
