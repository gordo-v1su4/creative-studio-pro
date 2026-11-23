/**
 * What a shot card shows at rest (DESIGN.md: Shot card): its number, length, review status,
 * and one mark per take with the pick and the excluded ones told apart.
 */
import { shotStatus, type ShotStatus } from './next-line';

type CardInput = { card_id: string; order: number; shot_number?: number; duration_ms: number };
type TakeInput = {
	asset_id: string;
	card_id: string;
	kind: 'image' | 'video' | 'audio';
	rejected?: boolean;
	review_status?: string;
	review_room?: { version: number };
};

export type ShotCardTake = { id: string; kind: 'image' | 'video'; label: string; pick: boolean; excluded: boolean };
export type ShotCardFacts = {
	number: string;
	length: string;
	status: ShotStatus;
	statusLabel: string;
	takes: ShotCardTake[];
	takesLabel: string;
	/** The pick's Review Room version (v003), or '' when it is not stored there. */
	version: string;
};

const STATUS_LABEL: Record<ShotStatus, string> = {
	missing: 'No take',
	awaiting: 'Awaiting review',
	progress: 'In progress',
	changes: 'Needs changes',
	approved: 'Approved'
};

/** A take is named by its Review Room version once stored there, else by its place among the shot's takes. */
export const takeLabel = (take: { review_room?: { version: number } }, index: number) =>
	take.review_room ? `v${String(take.review_room.version).padStart(3, '0')}` : `Take ${index + 1}`;

export function shotCardFacts(card: CardInput, assets: TakeInput[], pickId: string | null): ShotCardFacts {
	const own = assets.filter((asset) => asset.card_id === card.card_id && asset.kind !== 'audio');
	const takes = own.map((asset, index) => ({
		id: asset.asset_id,
		kind: asset.kind as 'image' | 'video',
		label: takeLabel(asset, index),
		pick: asset.asset_id === pickId && !asset.rejected,
		excluded: !!asset.rejected
	}));
	const status = shotStatus(own);
	const seconds = Math.round(card.duration_ms / 100) / 10;
	return {
		number: card.shot_number ? String(card.shot_number).padStart(4, '0') : String(card.order + 1).padStart(2, '0'),
		length: `${seconds}s`,
		status,
		statusLabel: STATUS_LABEL[status],
		takes,
		takesLabel: takes.length === 0 ? '' : `${takes.length} ${takes.length === 1 ? 'take' : 'takes'}`,
		version: takes.find((take) => take.pick)?.label.startsWith('v') ? takes.find((take) => take.pick)!.label : ''
	};
}
