import type { Generation, ProductionAsset, ProductionState } from './schemas';
import { lintPrompt } from './prompt-lint';
import { isUnder2K, MIN_LONG_EDGE } from './media';
import type { TakeResult } from './takes';
import { finalizedTake } from './finalize';

/**
 * Animate (CONTEXT.md: Animate): a beat's still sent to Seedance as the start
 * frame. Every send passes one gate before any spend: the prompt linter, the
 * 2K reference check, and the cost check — an explicit confirm of the
 * estimated price, or YOLO, which skips only the confirm and stops at the
 * session's credit cap.
 */

export const ANIMATE_RESOLUTIONS = ['480p', '720p', '1080p'] as const;
export type AnimateResolution = (typeof ANIMATE_RESOLUTIONS)[number];
export const ANIMATE_MIN_S = 4;
export const ANIMATE_MAX_S = 30;

export interface SeedanceRequest {
	prompt: string;
	duration: number;
	resolution: '480p' | '720p' | '1080p';
	generate_audio: boolean;
	/** A local still for the start frame (the CLI uploads it). */
	start_image?: string;
	/** Render a finalizable 480p draft. */
	draft?: boolean;
	/** Finalize this completed draft at 1080p (same render). */
	draft_job_id?: string;
}

export interface AnimateSettings {
	prompt: string;
	duration_s: number;
	resolution: AnimateResolution;
	generate_audio: boolean;
}

/**
 * The Seedance request for these settings. 480p always goes out as a draft:
 * same price, and it can later be finalized to 1080p from the same render
 * for seven days (a plain 480p render could only be upscaled or redone).
 */
export function seedanceRequest(settings: AnimateSettings, startImage?: string): SeedanceRequest {
	return {
		prompt: settings.prompt.trim(),
		duration: Math.round(Math.min(ANIMATE_MAX_S, Math.max(ANIMATE_MIN_S, settings.duration_s))),
		resolution: settings.resolution,
		generate_audio: settings.generate_audio,
		draft: settings.resolution === '480p',
		...(startImage ? { start_image: startImage } : {})
	};
}

export type SendMode =
	| { kind: 'confirm'; confirmed_credits: number }
	| { kind: 'yolo'; cap_credits: number; spent_credits: number };

export interface GateInput {
	prompt: string;
	still: Pick<ProductionAsset, 'kind' | 'width' | 'height'>;
	estimate_credits: number;
	mode: SendMode;
}

/** Reasons a send is blocked; empty means it may go. Nothing is spent until this is empty. */
export function animateGate(input: GateInput): string[] {
	const reasons: string[] = [];
	if (!input.prompt.trim()) reasons.push('The prompt is empty');
	for (const issue of lintPrompt(input.prompt, 'seedance').issues) {
		if (issue.severity === 'error') reasons.push(`Prompt rule ${issue.rule}: ${issue.message}`);
	}
	if (input.still.kind !== 'image') reasons.push('Animate starts from a still');
	else if (!input.still.width || !input.still.height) reasons.push('The still\'s size is unknown; it must be checked against 2K first');
	else if (isUnder2K(input.still)) reasons.push(`The still is ${input.still.width}×${input.still.height}, under ${MIN_LONG_EDGE} px on the long edge`);
	if (input.mode.kind === 'confirm') {
		// A real price change needs a fresh confirm.
		if (input.estimate_credits > input.mode.confirmed_credits + 1e-6) reasons.push(`The price is now ${input.estimate_credits} credits, above the ${input.mode.confirmed_credits} you confirmed`);
	} else {
		if (!(input.mode.cap_credits > 0)) reasons.push('Set a session credit cap before using YOLO');
		else if (input.mode.spent_credits + input.estimate_credits > input.mode.cap_credits + 1e-6) {
			reasons.push(`YOLO cap reached: ${input.mode.spent_credits} credits spent + ${input.estimate_credits} would pass the ${input.mode.cap_credits}-credit session cap`);
		}
	}
	return reasons;
}

export function pendingGenerations(production: ProductionState): Generation[] {
	return (production.generations ?? []).filter((generation) => generation.status === 'queued' || generation.status === 'in_progress');
}

export function applyRecordGeneration(production: ProductionState, generation: Generation): TakeResult {
	if (!production.cards.some((card) => card.card_id === generation.card_id)) return { ok: false, message: `Beat ${generation.card_id} not on this project` };
	if ((production.generations ?? []).some((entry) => entry.request_id === generation.request_id)) return { ok: false, message: `Generation ${generation.request_id} already recorded` };
	return { ok: true, production: { ...production, generations: [...(production.generations ?? []), generation] } };
}

/**
 * Settle a generation: still running (status update only), done (its video
 * becomes a new take on the beat, and the pick), or failed / refused.
 */
export function applySettleGeneration(
	production: ProductionState,
	requestId: string,
	outcome: { status: Generation['status']; take?: Omit<ProductionAsset, 'card_id'>; error?: string },
	now: string
): TakeResult {
	const generation = (production.generations ?? []).find((entry) => entry.request_id === requestId);
	if (!generation) return { ok: false, message: `Generation ${requestId} not found` };
	if (generation.settled_at) return { ok: false, message: `Generation ${requestId} already settled` };
	if (outcome.status === 'completed' && !outcome.take) return { ok: false, message: 'A completed generation needs its take' };
	const done = outcome.status === 'completed' || outcome.status === 'failed' || outcome.status === 'nsfw';
	const settled: Generation = {
		...generation,
		status: outcome.status,
		...(done ? { settled_at: now } : {}),
		...(outcome.take ? { take_id: outcome.take.asset_id } : {}),
		...(outcome.error ? { error: outcome.error.slice(0, 2000) } : {})
	};
	const generations = (production.generations ?? []).map((entry) => (entry.request_id === requestId ? settled : entry));
	if (!outcome.take) return { ok: true, production: { ...production, generations } };
	if (generation.finalizes) {
		// A finalize swaps the draft take's media for the 1080p render; the take, its trims and ramps stay.
		const target = production.assets.find((asset) => asset.asset_id === generation.finalizes);
		if (!target) return { ok: false, message: `Finalized take ${generation.finalizes} not found` };
		const finalized = finalizedTake(target, outcome.take, generation.request_id, now);
		return {
			ok: true,
			production: {
				...production,
				generations: generations.map((entry) => (entry.request_id === requestId ? { ...entry, take_id: target.asset_id } : entry)),
				assets: production.assets.map((asset) => (asset.asset_id === target.asset_id ? finalized : asset))
			}
		};
	}
	return {
		ok: true,
		production: {
			...production,
			generations,
			assets: [...production.assets, { ...outcome.take, card_id: generation.card_id }],
			cards: production.cards.map((card) => (card.card_id === generation.card_id ? { ...card, pick_take_id: outcome.take!.asset_id } : card))
		}
	};
}
