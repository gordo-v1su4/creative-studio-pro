/**
 * What a shot card shows at rest (DESIGN.md: Shot card): its number, length, review status,
 * and one mark per take with the pick and the excluded ones told apart.
 */
import { shotStatus, type ShotStatus } from './next-line';
import type { Project, StoryCard } from './schemas';
import { shotCodeOf } from './story-levels';

type CardInput = { card_id: string; order: number; shot_number?: number; duration_ms: number };
type TakeInput = {
	asset_id: string;
	card_id: string;
	kind: 'image' | 'video' | 'audio';
	rejected?: boolean;
	review_status?: string;
	review_room?: { version: number; code?: string };
	/** The take's original file name: never renamed, shown second to its take name. */
	name?: string;
};

export type ShotCardTake = {
	id: string; kind: 'image' | 'video'; label: string; pick: boolean; excluded: boolean;
	/** What the take is called: `BLR_TR130_DRP_0010_v001`, or the shot's code and its take label. */
	name: string;
	/** Its original file name ('' when it has none). */
	file: string;
};
export type ShotCardFacts = {
	number: string;
	/** What the shot is called everywhere: its shot code, or its short number while it has none. */
	code: string;
	/** The code from the scene on (`DRP_0010`), for where the whole code does not fit on one line. */
	short: string;
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

/** A shot's short number while it has no code: its shot number, else its place in the order. */
const shortNumber = (card: Pick<CardInput, 'order' | 'shot_number'>) =>
	card.shot_number ? String(card.shot_number).padStart(4, '0') : String(card.order + 1).padStart(2, '0');

/**
 * What a shot is called (CONTEXT.md: Shot code): Review Room's code for it when it has one there, else the code
 * built from the show, project, scene code and shot number the app holds, else `fallback` (its short number).
 */
export function shotCode(project: Project, card: Pick<StoryCard, 'card_id' | 'order' | 'scene_code' | 'shot_number'>, fallback = shortNumber(card)): string {
	return shotCodeOf(project, card) ?? fallback;
}

const LONG = /^[A-Z]{3}_(?:TR|EP)\d{3}_(.+)$/;
/** `BLR_TR130_DRP_0010` → `DRP_0010` (a take keeps its `_v001`); anything else stays as it is. */
export const shortName = (code: string) => LONG.exec(code)?.[1] ?? code;

/** A take's name: its shot's code and `_v###` once stored in Review Room, else the shot's code and its take label. */
export function takeName(code: string, take: { review_room?: { version: number; code?: string } }, index: number): string {
	return take.review_room ? `${take.review_room.code || code}_${takeLabel(take, index)}` : `${code} ${takeLabel(take, index)}`;
}

/** `code` is the shot's code (see shotCode); without it the shot is named by its short number. */
export function shotCardFacts(card: CardInput, assets: TakeInput[], pickId: string | null, code: string = shortNumber(card)): ShotCardFacts {
	const own = assets.filter((asset) => asset.card_id === card.card_id && asset.kind !== 'audio');
	const takes = own.map((asset, index) => ({
		id: asset.asset_id,
		kind: asset.kind as 'image' | 'video',
		label: takeLabel(asset, index),
		name: takeName(code, asset, index),
		file: asset.name ?? '',
		pick: asset.asset_id === pickId && !asset.rejected,
		excluded: !!asset.rejected
	}));
	const status = shotStatus(own);
	const seconds = Math.round(card.duration_ms / 100) / 10;
	return {
		number: shortNumber(card),
		code,
		short: shortName(code),
		length: `${seconds}s`,
		status,
		statusLabel: STATUS_LABEL[status],
		takes,
		takesLabel: takes.length === 0 ? '' : `${takes.length} ${takes.length === 1 ? 'take' : 'takes'}`,
		version: takes.find((take) => take.pick)?.label.startsWith('v') ? takes.find((take) => take.pick)!.label : ''
	};
}
