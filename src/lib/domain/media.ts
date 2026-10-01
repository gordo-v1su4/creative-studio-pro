import type { ProductionAsset, ProductionState, StoryCard } from './schemas';
import { defaultLinks } from './spine';
import type { TakeResult } from './takes';

/**
 * Media brought onto the board (dropped files). Images and videos become
 * takes; everything else is refused. Stills and references under 2K on the
 * long edge are flagged, never silently used (operator rule, see
 * scripts/check-refs.ts).
 */

export const MIN_LONG_EDGE = 2048;

const KINDS: Record<string, 'image' | 'video'> = {
	'.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image',
	'.mp4': 'video', '.webm': 'video', '.mov': 'video'
};

export const ACCEPTED_EXTENSIONS = Object.keys(KINDS);

/** The take kind for a file name, or null when the board can't take it. */
export function mediaKind(fileName: string): 'image' | 'video' | null {
	const dot = fileName.lastIndexOf('.');
	return dot < 0 ? null : (KINDS[fileName.slice(dot).toLowerCase()] ?? null);
}

/** True when a still's long edge is under 2K. Unknown sizes and videos are not flagged. */
export function isUnder2K(take: Pick<ProductionAsset, 'kind' | 'width' | 'height'>): boolean {
	return take.kind === 'image' && !!take.width && !!take.height && Math.max(take.width, take.height) < MIN_LONG_EDGE;
}

/** A file name safe to keep in the project folder. */
export function safeFileName(fileName: string): string {
	const cleaned = fileName.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+/, '');
	return cleaned.slice(-120) || 'file';
}

type NewTake = Omit<ProductionAsset, 'card_id'> & { kind: 'image' | 'video' };

export function applyAddTake(production: ProductionState, cardId: string, take: NewTake): TakeResult {
	if (!production.cards.some((card) => card.card_id === cardId)) return { ok: false, message: `Beat ${cardId} not on this project` };
	if (production.assets.some((asset) => asset.asset_id === take.asset_id)) return { ok: false, message: `Take ${take.asset_id} already exists` };
	return {
		ok: true,
		production: {
			...production,
			assets: [...production.assets, { ...take, card_id: cardId }],
			cards: production.cards.map((card) => (card.card_id === cardId ? { ...card, pick_take_id: take.asset_id } : card))
		}
	};
}

/**
 * A new beat for a file dropped on empty canvas: benched and off the spine,
 * so the story order doesn't change until the operator hooks it in.
 */
export function applyAddBeat(production: ProductionState, cardId: string, title: string, take: NewTake): TakeResult {
	if (production.cards.some((card) => card.card_id === cardId)) return { ok: false, message: `Beat ${cardId} already exists` };
	if (production.assets.some((asset) => asset.asset_id === take.asset_id)) return { ok: false, message: `Take ${take.asset_id} already exists` };
	const beat: StoryCard = {
		card_id: cardId,
		order: production.cards.reduce((max, card) => Math.max(max, card.order + 1), 0),
		title,
		beat: `Dropped in: ${take.name}`,
		purpose: 'Added from a dropped file; give it a purpose and hook it onto the spine.',
		duration_ms: Math.min(120_000, Math.max(1, Math.round((take.duration_s ?? 3) * 1000))),
		image_prompt: 'None yet (dropped file).',
		video_prompt: 'None yet (dropped file).',
		status: 'draft',
		pick_take_id: take.asset_id,
		benched: true
	};
	return {
		ok: true,
		production: {
			...production,
			// Pin the current spine first: a project still on card-order links would otherwise pull the new beat onto it.
			links: production.links ?? defaultLinks(production.cards),
			cards: [...production.cards, beat],
			assets: [...production.assets, { ...take, card_id: cardId }]
		}
	};
}
