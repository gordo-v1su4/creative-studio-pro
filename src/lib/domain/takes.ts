import type { ProductionAsset, ProductionState, StoryCard } from './schemas';

/**
 * Takes on beats (CONTEXT.md: Beat, Take, Pick). A beat is a story card; its
 * takes are the image and video assets attached to it, in creation order.
 * The pick is explicit by take id; a beat with no live explicit pick falls
 * back to its newest live video, else its newest live image.
 */

export type Take = ProductionAsset & { kind: 'image' | 'video' };

export type TakeResult = { ok: true; production: ProductionState } | { ok: false; message: string };

const isTake = (asset: ProductionAsset): asset is Take => asset.kind === 'image' || asset.kind === 'video';

export function takesFor(production: ProductionState, cardId: string, includeRejected = false): Take[] {
	return production.assets.filter(
		(asset): asset is Take => isTake(asset) && asset.card_id === cardId && (includeRejected || !asset.rejected)
	);
}

export function pickFor(production: ProductionState, card: StoryCard): Take | null {
	const live = takesFor(production, card.card_id);
	return (
		live.find((take) => take.asset_id === card.pick_take_id) ??
		live.findLast((take) => take.kind === 'video') ??
		live.at(-1) ??
		null
	);
}

function findTake(production: ProductionState, takeId: string): Take | null {
	const asset = production.assets.find((entry) => entry.asset_id === takeId);
	return asset && isTake(asset) ? asset : null;
}

function withPick(production: ProductionState, cardId: string, takeId: string | undefined): ProductionState {
	return {
		...production,
		cards: production.cards.map((card) => (card.card_id === cardId ? { ...card, pick_take_id: takeId } : card))
	};
}

function withRejected(production: ProductionState, takeId: string, rejected: boolean): ProductionState {
	return {
		...production,
		assets: production.assets.map((asset) => {
			if (asset.asset_id !== takeId) return asset;
			const { rejected: _old, ...rest } = asset;
			return rejected ? { ...rest, rejected: true } : rest;
		})
	};
}

export function applySetPick(production: ProductionState, cardId: string, takeId: string): TakeResult {
	if (!production.cards.some((card) => card.card_id === cardId)) return { ok: false, message: `Beat ${cardId} not on this project` };
	const take = findTake(production, takeId);
	if (!take || take.card_id !== cardId) return { ok: false, message: `Take ${takeId} is not a take of beat ${cardId}` };
	if (take.rejected) return { ok: false, message: 'A rejected take cannot be the pick; restore it first' };
	return { ok: true, production: withPick(production, cardId, takeId) };
}

/** Rejecting the pick moves the pick to the next live take (else the previous one). */
export function applyRejectTake(production: ProductionState, takeId: string): TakeResult {
	const take = findTake(production, takeId);
	if (!take) return { ok: false, message: `Take ${takeId} not found` };
	if (take.rejected) return { ok: true, production };
	const card = production.cards.find((entry) => entry.card_id === take.card_id);
	let next = withRejected(production, takeId, true);
	if (card && pickFor(production, card)?.asset_id === takeId) {
		const all = takesFor(production, card.card_id);
		const index = all.findIndex((entry) => entry.asset_id === takeId);
		const successor = all[index + 1] ?? all[index - 1];
		next = withPick(next, card.card_id, successor?.asset_id);
	}
	return { ok: true, production: next };
}

export function applyRestoreTake(production: ProductionState, takeId: string): TakeResult {
	const take = findTake(production, takeId);
	if (!take) return { ok: false, message: `Take ${takeId} not found` };
	return { ok: true, production: withRejected(production, takeId, false) };
}
