import type { Generation, ProductionAsset, ProductionState } from './schemas';
import { lintPrompt } from './prompt-lint';
import { isUnder2K, MIN_LONG_EDGE } from './media';
import type { TakeResult } from './takes';

/**
 * Animate (CONTEXT.md: Animate): a beat's still sent to Seedance as the start
 * frame. Every send passes one gate before any spend: the prompt linter, the
 * 2K reference check, and the cost check — an explicit confirm of the
 * estimated price, or YOLO, which skips only the confirm and stops at the
 * session's credit cap.
 */

export const SEEDANCE_I2V = 'bytedance/seedance-2.5/image-to-video';
export const ANIMATE_RESOLUTIONS = ['480p', '720p', '1080p'] as const;
export type AnimateResolution = (typeof ANIMATE_RESOLUTIONS)[number];
export const ANIMATE_MIN_S = 4;
export const ANIMATE_MAX_S = 30;

export interface AnimateSettings {
	prompt: string;
	duration_s: number;
	resolution: AnimateResolution;
	generate_audio: boolean;
}

/** The Seedance image-to-video body for these settings (and the still's public URL). */
export function animateBody(settings: AnimateSettings, imageUrl: string): Record<string, unknown> {
	return {
		image_url: imageUrl,
		prompt: settings.prompt.trim(),
		duration: Math.round(Math.min(ANIMATE_MAX_S, Math.max(ANIMATE_MIN_S, settings.duration_s))),
		resolution: settings.resolution,
		generate_audio: settings.generate_audio
	};
}

export type SendMode =
	| { kind: 'confirm'; confirmed_usd: number }
	| { kind: 'yolo'; cap_usd: number; spent_usd: number };

export interface GateInput {
	prompt: string;
	still: Pick<ProductionAsset, 'kind' | 'width' | 'height'>;
	estimate_usd: number;
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
		// A small tolerance for rounding; a real price change needs a fresh confirm.
		if (input.estimate_usd > input.mode.confirmed_usd + 0.005) reasons.push(`The price is now $${input.estimate_usd.toFixed(2)}, above the $${input.mode.confirmed_usd.toFixed(2)} you confirmed`);
	} else {
		if (!(input.mode.cap_usd > 0)) reasons.push('Set a session credit cap before using YOLO');
		else if (input.mode.spent_usd + input.estimate_usd > input.mode.cap_usd + 1e-9) {
			reasons.push(`YOLO cap reached: $${input.mode.spent_usd.toFixed(2)} spent + $${input.estimate_usd.toFixed(2)} would pass the $${input.mode.cap_usd.toFixed(2)} session cap`);
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
