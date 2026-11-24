import { RENDER_STATES, type Generation, type ProductionAsset, type RenderProviderId } from './schemas';

/**
 * The render queue's rules (CONTEXT.md: Render, Render queue, Re-render;
 * DECISIONS.md 27 to 40). Pure: what a render's state allows, one open
 * re-render per take, where a re-render's request comes from, what may be
 * confirmed and what it totals to, and the colour of an answer code.
 * Nothing here sends, prices or spends.
 */

export { RENDER_STATES };
export type RenderState = (typeof RENDER_STATES)[number];
export type Render = Generation;
export type RenderResult = { ok: true; render: Render } | { ok: false; message: string };
export type RenderUnit = 'credits' | 'usd';
export interface Price { amount: number; unit: RenderUnit }

const LEGACY_STATE: Record<Generation['status'], RenderState> = { queued: 'queued', in_progress: 'rendering', completed: 'done', failed: 'failed', nsfw: 'refused' };
const STATUS_OF: Partial<Record<RenderState, Generation['status']>> = { queued: 'queued', rendering: 'in_progress', done: 'completed', failed: 'failed', refused: 'nsfw' };
const LABEL: Record<RenderState, string> = { drafting: 'drafting', to_approve: 'to approve', approved: 'approved', queued: 'queued', rendering: 'rendering', done: 'done', failed: 'failed', refused: 'refused' };

/** A render's state; a record made before the render queue is read from its status. */
export function renderState(render: Render): RenderState {
	return render.state ?? LEGACY_STATE[render.status];
}

export const renderStateLabel = (state: RenderState): string => LABEL[state];

/**
 * The moves a state allows. Approved is the only way to the provider; a failed
 * render can only be tried again through a new price and Confirm; a refused
 * one goes back to approval so its prompt can be changed (decision 37).
 */
const MOVES: Record<RenderState, readonly RenderState[]> = {
	drafting: ['to_approve'],
	to_approve: ['drafting', 'approved'],
	approved: ['to_approve', 'queued'],
	queued: ['rendering', 'failed', 'refused'],
	rendering: ['done', 'failed', 'refused'],
	done: [],
	failed: ['approved'],
	refused: ['to_approve']
};

export const canMove = (from: RenderState, to: RenderState): boolean => MOVES[from].includes(to);

/** Open: anything not done. A take has at most one open re-render (decision 40). */
export const isOpen = (state: RenderState): boolean => state !== 'done';
/** Removing costs nothing only while nothing is with the provider. */
export const removable = (state: RenderState): boolean => state !== 'queued' && state !== 'rendering' && state !== 'done';
/** The prompt and the settings can change until it is sent. */
const editable = (state: RenderState): boolean => state === 'drafting' || state === 'to_approve' || state === 'approved';

function without<K extends keyof Render>(render: Render, ...keys: K[]): Render {
	const copy = { ...render };
	for (const key of keys) delete copy[key];
	return copy;
}

export function moveRender(render: Render, to: RenderState, now: string): RenderResult {
	const from = renderState(render);
	if (!canMove(from, to)) return { ok: false, message: `A render that is ${LABEL[from]} cannot become ${LABEL[to]}` };
	let next: Render = { ...render, state: to, ...(STATUS_OF[to] ? { status: STATUS_OF[to] } : {}) };
	if (to === 'approved' && from === 'to_approve') next.approved_at = now;
	// "Try again": the same approved prompt, a new price, a new Confirm, a new send.
	if (to === 'approved' && from === 'failed') next = without(next, 'price', 'settled_at', 'sent_at', 'job_id', 'run_id', 'take_id');
	if (to === 'to_approve') next = from === 'refused' ? without(next, 'approved_at', 'price', 'settled_at', 'sent_at', 'job_id', 'run_id') : without(next, 'approved_at');
	if (to === 'drafting') next = without(next, 'check');
	if (to === 'queued') next = { ...without(next, 'answer_code', 'error'), sent_at: now };
	if (to === 'done' || to === 'failed' || to === 'refused') next.settled_at = now;
	return { ok: true, render: next };
}

// ── Re-renders ───────────────────────────────────────────────────────────

/** The open re-render that answers this take, if there is one. */
export function openRerenderFor(renders: readonly Render[], takeId: string): Render | undefined {
	return renders.find((render) => render.answers_take_id === takeId && isOpen(renderState(render)));
}

export type RequestSource =
	| { kind: 'record'; render: Render }
	| { kind: 'job'; job_id: string }
	| { kind: 'none'; reason: string };

/**
 * Where a re-render's request comes from (decision 27): the app's own record
 * of the render that made the take, when it kept the still; otherwise the
 * Higgsfield job, read back by its id; otherwise nowhere, with the reason.
 */
export function requestSource(take: ProductionAsset, renders: readonly Render[]): RequestSource {
	if (take.kind !== 'video') return { kind: 'none', reason: 'Only a video take can be re-rendered' };
	const record = renders.find((render) => render.take_id === take.asset_id && (render.still?.url || render.still?.media_id));
	if (record) return { kind: 'record', render: record };
	const provider = take.generation?.provider ?? 'higgsfield';
	if (take.job_id && provider !== 'higgsfield') return { kind: 'none', reason: `This take was made on ${provider}, which cannot read an earlier request back` };
	if (take.job_id) return { kind: 'job', job_id: take.job_id };
	return { kind: 'none', reason: 'This take has no record of how it was made and no Higgsfield job id, so its request cannot be sent again' };
}

export interface QueueRerenderInput {
	/** The new render's id, made by the caller. */
	id: string;
	take: ProductionAsset;
	requested_change?: string;
	unchanged?: boolean;
	notes?: NonNullable<Render['notes']>;
	/** The request read back from Higgsfield, when the take keeps no record of its own. */
	readback?: { prompt: string; model?: string; duration_s?: number; generate_audio?: boolean };
	now: string;
}

/** Where every entry starts (decision 32); the operator can change both before approving. */
export const DEFAULT_RENDER_PROVIDER: RenderProviderId = 'higgsfield';
export const DEFAULT_RENDER_MODEL = 'seedance_2_5';
export const DEFAULT_RENDER_RESOLUTION = '480p';

/**
 * Queue a re-render of a take: the entry already open for it, or a new one
 * that reuses the take's request with only the prompt left to change.
 */
export function queueRerender(renders: readonly Render[], input: QueueRerenderInput): { ok: true; render: Render; created: boolean } | { ok: false; message: string } {
	const open = openRerenderFor(renders, input.take.asset_id);
	if (open) return { ok: true, render: open, created: false };
	const source = requestSource(input.take, renders);
	if (source.kind === 'none') return { ok: false, message: source.reason };
	const requested = input.requested_change?.trim() ?? '';
	if (!requested && !input.unchanged && !input.notes?.length) return { ok: false, message: 'Type what should change, or choose "Render again unchanged"' };
	const made = source.kind === 'record' ? source.render : undefined;
	const was = input.take.generation;
	const prompt = made?.prompt ?? was?.prompt ?? input.readback?.prompt ?? '';
	if (!prompt) return { ok: false, message: "This take's prompt is not known yet; read its request back from Higgsfield first" };
	const duration = made?.duration_s ?? was?.duration_s ?? input.readback?.duration_s ?? input.take.duration_s;
	if (!duration) return { ok: false, message: "This take's length is not known" };
	const audio = made?.generate_audio ?? was?.generate_audio ?? input.readback?.generate_audio;
	const render: Render = {
		request_id: input.id,
		card_id: input.take.card_id,
		...(input.take.identity_tags ? { identity_tags: structuredClone(input.take.identity_tags) } : {}),
		provider: DEFAULT_RENDER_PROVIDER,
		model: made?.model ?? was?.model ?? input.readback?.model ?? DEFAULT_RENDER_MODEL,
		prompt,
		prompt_before: prompt,
		duration_s: duration,
		resolution: DEFAULT_RENDER_RESOLUTION,
		...(audio === undefined ? {} : { generate_audio: audio }),
		estimate_credits: 0,
		draft: false,
		status: 'queued',
		submitted_at: input.now,
		state: input.unchanged ? 'to_approve' : 'drafting',
		answers_take_id: input.take.asset_id,
		...(requested ? { requested_change: requested } : {}),
		...(input.unchanged ? { unchanged: true, check: [] } : {}),
		...(input.notes?.length ? { notes: input.notes } : {}),
		...(made?.still ? { still: made.still } : {}),
		...(made?.references ? { references: made.references } : {}),
		...(source.kind === 'job' ? { reuse_job_id: source.job_id } : made?.job_id ? { reuse_job_id: made.job_id } : {})
	};
	return { ok: true, render, created: true };
}

/**
 * Put a prompt on an entry: the Agent's draft arriving, or the operator's
 * edit. Either way it waits for approval again; the price does not depend on
 * the words, so it stays.
 */
export function withPrompt(render: Render, prompt: string, check: string[]): RenderResult {
	const state = renderState(render);
	if (!editable(state)) return { ok: false, message: `A render that is ${LABEL[state]} cannot be changed` };
	return { ok: true, render: { ...without(render, 'approved_at'), prompt, check, state: 'to_approve' } };
}

/** Change where and at what size it is made. The approval is for the prompt and stays; the price goes. */
export function withSettings(render: Render, settings: { provider?: RenderProviderId; model?: string; resolution?: string }): RenderResult {
	const state = renderState(render);
	if (!editable(state)) return { ok: false, message: `A render that is ${LABEL[state]} cannot be changed` };
	return { ok: true, render: { ...without(render, 'price'), ...settings } };
}

// ── Price and Confirm ────────────────────────────────────────────────────

/** What a price depends on. The prompt is not part of it. */
export function priceKey(render: Render): string {
	return [render.provider, render.model, render.resolution, render.duration_s, render.generate_audio === false ? 'silent' : 'sound'].join('|');
}

export function withPrice(render: Render, price: Price, now: string): Render {
	return { ...render, price: { ...price, key: priceKey(render), at: now }, ...(price.unit === 'credits' ? { estimate_credits: price.amount } : {}) };
}

/** Why this render cannot be confirmed yet (empty = it can). */
export function confirmBlockers(render: Render): string[] {
	if (renderState(render) !== 'approved') return ['Not approved'];
	if (!render.check) return ['The prompt has not been checked'];
	if (render.check.length) return [`The prompt's check found ${render.check.length} thing${render.check.length === 1 ? '' : 's'}`];
	if (!render.price) return ['No price yet'];
	if (render.price.key !== priceKey(render)) return ['The price is for other settings'];
	return [];
}

export const confirmable = (renders: readonly Render[]): Render[] => renders.filter((render) => confirmBlockers(render).length === 0);

export interface ProviderTotal { provider: RenderProviderId; unit: RenderUnit; amount: number; count: number }

/** What Confirm would spend, per render provider and unit. Credits and dollars stay apart. */
export function totalsByProvider(renders: readonly Render[]): ProviderTotal[] {
	const totals: ProviderTotal[] = [];
	for (const render of confirmable(renders)) {
		const price = render.price!;
		let total = totals.find((entry) => entry.provider === render.provider && entry.unit === price.unit);
		if (!total) totals.push((total = { provider: render.provider, unit: price.unit, amount: 0, count: 0 }));
		total.amount = Math.round((total.amount + price.amount) * 1e6) / 1e6;
		total.count += 1;
	}
	return totals;
}

/**
 * The renders whose price is no longer the one shown: Confirm is refused for
 * all of them before anything is sent. A price that cannot be compared (none,
 * or another unit) counts as risen.
 */
export function risenPrices(renders: readonly Render[], fresh: Record<string, Price | undefined>): string[] {
	return renders
		.filter((render) => {
			const now = fresh[render.request_id];
			return !render.price || !now || now.unit !== render.price.unit || now.amount > render.price.amount;
		})
		.map((render) => render.request_id);
}

// ── The answer code ──────────────────────────────────────────────────────

export type AnswerColour = 'teal' | 'amber' | 'red' | 'none';

const WORDS: Record<string, AnswerColour> = {
	completed: 'teal', complete: 'teal', ok: 'teal', succeeded: 'teal', success: 'teal', done: 'teal',
	nsfw: 'amber', refused: 'amber', canceled: 'amber', cancelled: 'amber', invalid: 'amber', invalid_request: 'amber', rejected: 'amber', moderated: 'amber',
	failed: 'red', error: 'red', timeout: 'red', timed_out: 'red'
};

/** The colour of a provider's answer (decision 36): teal for 2xx, amber for 4xx, red for 5xx; a status word the same way. */
export function answerCodeColour(code: number | string | undefined): AnswerColour {
	if (typeof code === 'number') return code >= 200 && code < 300 ? 'teal' : code >= 400 && code < 500 ? 'amber' : code >= 500 && code < 600 ? 'red' : 'none';
	if (!code) return 'none';
	return WORDS[code.toLowerCase()] ?? 'none';
}
