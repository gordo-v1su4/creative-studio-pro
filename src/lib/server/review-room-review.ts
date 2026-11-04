import type { Project, ProductionAsset } from '$lib/domain/schemas';
import { applyRejectTake, applyRestoreTake } from '$lib/domain/takes';
import type { PushDeps } from './review-room-takes';

export type ReviewStatus = NonNullable<ProductionAsset['review_status']>;
export type ReviewDecision = { take_id: string; expected_version: number; status?: ReviewStatus; excluded?: boolean };

/** Status belongs to the remote shot; exclusion belongs to one version. Never delete media. */
export async function reviewTake(deps: { store: PushDeps['store']; client?: PushDeps['client'] }, projectId: string, decision: ReviewDecision): Promise<Project> {
	const project = await deps.store.readProject(projectId);
	if (!project || project.version !== decision.expected_version) throw new Error('Project changed; reload before reviewing');
	const take = project.production.assets.find((entry) => entry.asset_id === decision.take_id && entry.kind !== 'audio');
	if (!take) throw new Error('Take not found');
	if (decision.status !== undefined && !take.review_room) throw new Error('Store this take in Review Room before setting its review status');
	if (take.review_room) {
		if (!deps.client) throw new Error('Configure Review Room before changing a linked take');
		if (decision.status !== undefined) await deps.client.setReviewStatus(take.review_room.asset_id, decision.status);
		if (decision.excluded !== undefined) await deps.client.setVersionExcluded(take.review_room.version_id, decision.excluded);
	}
	return deps.store.updateProject(projectId, project.version, (current) => {
		let production = current.production;
		if (decision.excluded !== undefined) {
			const changed = (decision.excluded ? applyRejectTake : applyRestoreTake)(production, take.asset_id);
			if (!changed.ok) throw new Error(changed.message);
			production = changed.production;
		}
		if (decision.status !== undefined) production = { ...production, assets: production.assets.map((entry) =>
			(entry.asset_id === take.asset_id || (take.review_room && entry.review_room?.asset_id === take.review_room.asset_id))
				? { ...entry, review_status: decision.status } : entry) };
		return { ...current, production };
	});
}
