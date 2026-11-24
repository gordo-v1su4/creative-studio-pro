/**
 * Making a take from the Details tab (DECISIONS 17): "Get price" and "Confirm" are two separate steps, so nothing
 * is spent by one click. A price belongs to the exact length, resolution and sound it was quoted for; changing any
 * of them, or the shot, drops it, and Confirm stays shut until a new price is asked for.
 */
import { ANIMATE_MAX_S, ANIMATE_MIN_S, type AnimateResolution } from './animate';
import { MIN_LONG_EDGE } from './media';

export interface TakeSettings { duration_s: number; resolution: AnimateResolution; generate_audio: boolean }
export interface Quote { key: string; credits: number }

/** What a price was quoted for: the shot and everything the price depends on (not the prompt's wording). */
export const quoteKey = (cardId: string, settings: TakeSettings) => JSON.stringify([cardId, settings.duration_s, settings.resolution, settings.generate_audio]);

/** The length a shot is sent at: its planned length in whole seconds, inside what the model renders. */
export const takeSeconds = (durationMs: number) => Math.min(ANIMATE_MAX_S, Math.max(ANIMATE_MIN_S, Math.round(durationMs / 1000)));

/** Why this shot cannot be sent as it stands (empty = it can). The server checks all of this again before any spend. */
export function takeBlockers(input: { pick: { kind: string; width?: number; height?: number } | null; prompt: string; unsaved: boolean }): string[] {
	const out: string[] = [];
	if (!input.pick) out.push('This shot has no take yet; it needs a still as its pick');
	else if (input.pick.kind !== 'image') out.push('The pick is a video; a take is made from a still');
	else if (input.pick.width && input.pick.height && Math.max(input.pick.width, input.pick.height) < MIN_LONG_EDGE) out.push(`The still is under ${MIN_LONG_EDGE}px on its long edge`);
	if (!input.prompt.trim()) out.push('The video prompt is empty');
	if (input.unsaved) out.push('Save the workspace first, so the take is made from what is saved');
	return out;
}

/** Confirm opens only for a price asked for these exact settings, with nothing in the way. */
export function canConfirm(input: { quote: Quote | null; key: string; blockers: string[]; busy: boolean }): boolean {
	return !input.busy && input.blockers.length === 0 && input.quote?.key === input.key;
}
