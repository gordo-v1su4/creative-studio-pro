/**
 * The viewer's keyboard (CONTEXT.md: Viewer): one key, one action, the same everywhere a take is played.
 */

export type ReviewStatus = 'awaiting_review' | 'in_progress' | 'needs_changes' | 'approved';

export type ViewerAction =
	| { type: 'toggle-play' }
	| { type: 'pause' }
	| { type: 'forward' }
	| { type: 'back' }
	| { type: 'shot'; by: -1 | 1 }
	| { type: 'take'; by: -1 | 1 }
	| { type: 'pick' }
	| { type: 'exclude' }
	| { type: 'status'; status: ReviewStatus }
	| { type: 'close' };

type KeyLike = { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean };

const STATUS_KEYS: Record<string, ReviewStatus> = { '1': 'awaiting_review', '2': 'in_progress', '3': 'needs_changes', '4': 'approved' };

/** The review statuses in key order, with the words the viewer shows. */
export const REVIEW_STATUSES: Array<{ key: string; status: ReviewStatus; label: string }> = [
	{ key: '1', status: 'awaiting_review', label: 'Awaiting review' },
	{ key: '2', status: 'in_progress', label: 'In progress' },
	{ key: '3', status: 'needs_changes', label: 'Needs changes' },
	{ key: '4', status: 'approved', label: 'Approved' }
];

export function viewerAction(event: KeyLike): ViewerAction | null {
	if (event.metaKey || event.ctrlKey || event.altKey) return null;
	const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
	if (key in STATUS_KEYS) return { type: 'status', status: STATUS_KEYS[key] };
	switch (key) {
		case ' ': return { type: 'toggle-play' };
		case 'Escape': return { type: 'close' };
		case 'ArrowRight': return { type: 'shot', by: 1 };
		case 'ArrowLeft': return { type: 'shot', by: -1 };
		case 'ArrowDown': return { type: 'take', by: 1 };
		case 'ArrowUp': return { type: 'take', by: -1 };
		case 'j': return { type: 'back' };
		case 'k': return { type: 'pause' };
		case 'l': return { type: 'forward' };
		case 'p': return { type: 'pick' };
		case 'x': return { type: 'exclude' };
		default: return null;
	}
}

/** Move within a list and stop at either end. */
export function step(length: number, index: number, by: number): number {
	if (length <= 0) return 0;
	return Math.min(length - 1, Math.max(0, index + by));
}

/** mm:ss.hh, the way the viewer and notes show time. */
export function timecode(seconds: number): string {
	const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
	const hundredths = Math.floor(safe * 100 + 1e-6);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${pad(Math.floor(hundredths / 6000))}:${pad(Math.floor(hundredths / 100) % 60)}.${pad(hundredths % 100)}`;
}
