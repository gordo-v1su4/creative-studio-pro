import type { Project } from '$lib/domain/schemas';
import type { ProjectCommandGateway } from '$lib/application/gateway';
import { appendPlannedShots } from '$lib/domain/story-plan';
import { connectTrailer } from './review-room-trailer';
import type { ReviewRoomClient } from './review-room';

/** Save the board and permanent folder mapping together. Failed/retried remote work is idempotent. */
export async function savePlannedBoard(project: Project, gateway: ProjectCommandGateway, client?: ReviewRoomClient) {
	const production = appendPlannedShots(project.production, new Date().toISOString());
	if (project.review_room && !client) throw new Error('Review Room must be configured before adding this trailer’s shots');
	const connection = project.review_room && client
		? await connectTrailer(client, { ...project, production }, project.review_room)
		: undefined;
	return gateway.saveProduction({ command: 'save_production', project_id: project.project_id, expected_version: project.version, production }, connection);
}
