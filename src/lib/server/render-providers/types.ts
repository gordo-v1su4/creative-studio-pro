import type { RenderProviderId } from '$lib/domain/schemas';
import type { Price } from '$lib/domain/render-queue';

/**
 * A render provider (CONTEXT.md: Render provider): where a render is made.
 * One interface for all of them: is it set up (and why not), price, send,
 * check, cancel. Cost keeps the provider's own unit, credits or dollars.
 * Nothing here decides whether to spend; Confirm does (decision 31).
 */

/** A still or reference to attach: a local file, the provider's id of an earlier upload or job, or a public address. */
export interface RenderMedia { path?: string; media_id?: string; url?: string; role?: string }

export interface RenderRequest {
	model: string;
	prompt: string;
	duration_s: number;
	resolution: string;
	generate_audio: boolean;
	aspect_ratio?: string;
	/** The start frame. */
	still?: RenderMedia;
	references?: RenderMedia[];
}

export type RenderSetup = { ready: true } | { ready: false; reason: string };

export interface RenderModel { id: string; label: string; kind: 'video' | 'still'; /** False: listed, not connected to anything yet. */ wired: boolean }

export interface RenderCheck {
	state: 'queued' | 'rendering' | 'done' | 'failed' | 'refused';
	/** Where the finished file is, when done. */
	url?: string;
	error?: string;
	/** An HTTP status where the provider gives one, otherwise its status word. */
	answer_code?: number | string;
}

/** An earlier job's request as the provider kept it, for a re-render by reuse (decision 27). */
export interface RenderReadBack {
	model: string;
	prompt: string;
	duration_s?: number;
	resolution?: string;
	generate_audio?: boolean;
	aspect_ratio?: string;
	still?: RenderMedia;
	references: RenderMedia[];
}

export interface RenderJob { job_id: string; model: string }

export interface RenderProvider {
	id: RenderProviderId;
	label: string;
	models: RenderModel[];
	resolutions: string[];
	setup(): Promise<RenderSetup>;
	price(request: RenderRequest): Promise<Price>;
	/** Sends once. It never retries: a retry can spend (decision 37). */
	send(request: RenderRequest): Promise<{ job_id: string; answer_code?: number | string }>;
	check(job: RenderJob): Promise<RenderCheck>;
	/** Absent where the provider cannot cancel. */
	cancel?(job: RenderJob): Promise<{ cancelled: boolean; answer_code?: number | string }>;
	/** Absent where the provider keeps no request to read back. */
	readBack?(jobId: string): Promise<RenderReadBack>;
}

export class RenderProviderError extends Error {
	constructor(message: string, readonly answer_code?: number | string) { super(message); }
}

/** What the settings screen and the queue say about a provider. */
export interface RenderProviderInfo { id: RenderProviderId; label: string; models: RenderModel[]; resolutions: string[]; setup: RenderSetup; can_cancel: boolean; can_reuse: boolean }

export async function describeProvider(provider: RenderProvider): Promise<RenderProviderInfo> {
	return { id: provider.id, label: provider.label, models: provider.models, resolutions: provider.resolutions, setup: await provider.setup(), can_cancel: Boolean(provider.cancel), can_reuse: Boolean(provider.readBack) };
}
