/**
 * The one plain line that tells the operator what is waiting on them.
 * It replaces the stage-and-gate strip; gates stay with their runs.
 */

type Take = { card_id: string; kind: 'image' | 'video' | 'audio'; rejected?: boolean; review_status?: string };
type NextLineProject = {
	production: { cards: Array<{ card_id: string; benched?: boolean }>; assets: Take[] };
	/** True when the project's takes are reviewed in Review Room. */
	reviewed: boolean;
};

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type ShotStatus = 'missing' | 'awaiting' | 'changes' | 'progress' | 'approved';

/** A shot's review status as its takes stand: review status is shared by a shot's takes, so the strongest one speaks for it. */
export function shotStatus(takes: Take[]): ShotStatus {
	const live = takes.filter((take) => take.kind !== 'audio' && !take.rejected);
	if (live.length === 0) return 'missing';
	const statuses = live.map((take) => take.review_status ?? 'awaiting_review');
	if (statuses.includes('needs_changes')) return 'changes';
	if (statuses.includes('approved')) return 'approved';
	if (statuses.includes('in_progress')) return 'progress';
	return 'awaiting';
}

export function nextLine(project: NextLineProject | null): string {
	if (!project) return 'Start a project';
	const { cards, assets } = project.production;
	if (cards.length === 0) return 'Write the story, then the shot list';

	const takesOf = new Map<string, Take[]>();
	for (const asset of assets) takesOf.set(asset.card_id, [...(takesOf.get(asset.card_id) ?? []), asset]);

	let missing = 0;
	let changes = 0;
	let awaiting = 0;
	for (const card of cards) {
		const status = shotStatus(takesOf.get(card.card_id) ?? []);
		if (status === 'missing') {
			if (!card.benched) missing += 1;
			continue;
		}
		if (!project.reviewed) continue;
		if (status === 'changes') changes += 1;
		else if (status === 'awaiting') awaiting += 1;
	}

	const parts = [
		missing && count(missing, 'shot has no take', 'shots have no take'),
		changes && count(changes, 'shot needs changes', 'shots need changes'),
		awaiting && count(awaiting, 'shot awaits review', 'shots await review')
	].filter(Boolean);
	return parts.length ? parts.join(' · ') : 'Nothing is waiting';
}
