import type { Project, StoryCard } from './schemas';
import { pickFor } from './takes';

/**
 * Missing shots (V1S-495): a shot on the board with no take yet plays, wherever shots play in order, as a plain text
 * card (a slate) for its planned length, showing its shot code, its order and its story beat. The slate is not a take:
 * it lives under a reserved id, so the shot stays missing until a real take lands on it.
 */
export const SLATE_PREFIX = 'slate-';
export const slateAssetId = (cardId: string) => `${SLATE_PREFIX}${cardId}`;
export const isSlateId = (assetId: string) => assetId.startsWith(SLATE_PREFIX);
export const slateCardId = (assetId: string) => assetId.slice(SLATE_PREFIX.length);
export const slateUrl = (projectId: string, cardId: string) => `/api/projects/${projectId}/slate/${cardId}`;

/** Whether a shot is missing: it has no take of any kind yet. */
export function isMissingShot(production: Project['production'], card: StoryCard): boolean {
	return !production.assets.some((asset) => asset.card_id === card.card_id && asset.kind !== 'audio');
}

/** The slate's lines and length: the shot code (when Review Room gave one), its order in its scene, and its story beat. */
export function slateFor(project: Project, card: StoryCard): { code: string; order: string; title: string; beat: string; duration_s: number } {
	const group = project.production.groups?.find((entry) => entry.group_id === card.group_id);
	const siblings = project.production.cards.filter((entry) => entry.group_id === card.group_id).toSorted((a, b) => a.order - b.order);
	const at = siblings.findIndex((entry) => entry.card_id === card.card_id) + 1;
	const code = project.review_room?.shots[card.card_id]?.code ?? '';
	return {
		code,
		order: `${group?.name ?? 'Main board'} · shot ${at} of ${siblings.length}`,
		title: card.title,
		beat: card.beat,
		duration_s: Math.min(120, Math.max(0.5, (card.duration_ms || 3000) / 1000))
	};
}

/** What a shot plays as in a sequence: its video pick; a slate when it has no take at all; nothing for a still pick. */
export function playItemFor(project: Project, card: StoryCard): { id: string; title: string; src: string; assetId: string } | null {
	if (card.benched) return null;
	const pick = pickFor(project.production, card);
	if (pick?.kind === 'video') return { id: card.card_id, title: card.title, src: pick.url, assetId: pick.asset_id };
	if (isMissingShot(project.production, card)) return { id: card.card_id, title: card.title, src: slateUrl(project.project_id, card.card_id), assetId: slateAssetId(card.card_id) };
	return null;
}
