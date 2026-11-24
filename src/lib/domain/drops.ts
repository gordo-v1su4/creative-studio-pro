/**
 * What a drop means (SPEC: Drop rules). One resolver answers "what does dropping X on Y do" so the shot grid, the
 * canvas, the outline and the selection strip behave the same: a clip on a shot is a new take, files on open space
 * or a scene are new shots there, a shot on a scene moves it, a shot on the selection joins it, a picture on a
 * reference is a source image. Anything else means nothing, with a line saying why.
 */

export type Media = 'image' | 'video' | 'other';

export type Dragged =
	/** Files from outside the app. `media` is known only once they are dropped; while dragging it is absent. */
	| { kind: 'files'; media?: Media[] }
	/** One or more shots, by card id. */
	| { kind: 'shots'; cardIds: string[] };

export type DropTarget =
	| { kind: 'shot'; cardId: string }
	/** A scene or group, in the outline or as a node on the canvas. */
	| { kind: 'group'; groupId: string }
	/** Open space in the grid or on the canvas, showing this group. */
	| { kind: 'space'; groupId: string }
	/** The selection strip, before the entry at this position. */
	| { kind: 'selection'; at: number }
	| { kind: 'reference'; referenceId: string };

export type DropMeaning =
	| { kind: 'new-take'; cardId: string }
	| { kind: 'new-shots'; groupId: string }
	| { kind: 'move'; groupId: string; cardIds: string[] }
	| { kind: 'select'; cardIds: string[]; at: number }
	| { kind: 'source-image'; referenceId: string }
	| { kind: 'nothing'; why: string };

export interface DropContext {
	/** The group a shot is in, or null when the shot is not on this project. */
	groupOf: (cardId: string) => string | null;
	/** Whether a shot can play in a selection (a video pick, or a missing shot's text card). */
	playable: (cardId: string) => boolean;
}

const nothing = (why: string): DropMeaning => ({ kind: 'nothing', why });

export function dropMeaning(dragged: Dragged, target: DropTarget, context: DropContext): DropMeaning {
	if (dragged.kind === 'files') {
		const known = dragged.media;
		if (known && !known.some((kind) => kind !== 'other')) return nothing('Only pictures and video can be dropped here');
		switch (target.kind) {
			case 'shot': return { kind: 'new-take', cardId: target.cardId };
			case 'space':
			case 'group': return { kind: 'new-shots', groupId: target.groupId };
			case 'reference': return known && !known.includes('image') ? nothing('A reference takes pictures, not video') : { kind: 'source-image', referenceId: target.referenceId };
			case 'selection': return nothing('Add files as shots first, then gather them');
		}
	}
	const shots = dragged.cardIds.filter((cardId) => context.groupOf(cardId) !== null);
	if (!shots.length) return nothing('Nothing to drop');
	switch (target.kind) {
		case 'group': {
			const moving = shots.filter((cardId) => context.groupOf(cardId) !== target.groupId);
			return moving.length ? { kind: 'move', groupId: target.groupId, cardIds: moving } : nothing('Already in this scene');
		}
		case 'selection': {
			const playing = shots.filter(context.playable);
			return playing.length ? { kind: 'select', cardIds: playing, at: target.at } : nothing('A still pick does not play in a selection');
		}
		case 'shot': return nothing('Drop a shot on a scene to move it, or on the selection to gather it');
		case 'space': return nothing('Drop a shot on a scene to move it, or on the selection to gather it');
		case 'reference': return nothing('A reference takes pictures');
	}
}

/** The line shown while something is held over a target: what letting go will do. */
export function dropLabel(meaning: DropMeaning, names: { shot?: string; group?: string }): string {
	switch (meaning.kind) {
		case 'new-take': return `Drop to add as a take of ${names.shot ?? 'this shot'}`;
		case 'new-shots': return `Drop to add as shots${names.group ? ` in ${names.group}` : ''}`;
		case 'move': return `Drop to move ${meaning.cardIds.length === 1 ? 'the shot' : `${meaning.cardIds.length} shots`} to ${names.group ?? 'this scene'}`;
		case 'select': return 'Drop to add to the selection';
		case 'source-image': return 'Drop to add as a source image';
		case 'nothing': return meaning.why;
	}
}
