import { expect, test } from 'bun:test';
import { generationSchema, productionAssetSchema, type Generation, type ProductionAsset } from '../../src/lib/domain/schemas';
import {
	answerCodeColour,
	canMove,
	confirmBlockers,
	isOpen,
	moveRender,
	openRerenderFor,
	priceKey,
	queueRerender,
	removable,
	renderState,
	requestSource,
	risenPrices,
	totalsByProvider,
	withPrice,
	withPrompt,
	withSettings,
	RENDER_STATES
} from '../../src/lib/domain/render-queue';

const NOW = '2026-11-24T12:00:00Z';
const LATER = '2026-11-24T12:05:00Z';

function render(over: Partial<Generation> = {}): Generation {
	return generationSchema.parse({
		request_id: 'r1', card_id: 'shot-1', provider: 'higgsfield', model: 'seedance_2_5', prompt: 'A slow push in.',
		duration_s: 5, resolution: '480p', estimate_credits: 0, status: 'queued', submitted_at: NOW,
		state: 'approved', answers_take_id: 'take-1', generate_audio: true, check: [], ...over
	});
}

function take(over: Partial<ProductionAsset> = {}): ProductionAsset {
	return productionAssetSchema.parse({ asset_id: 'take-1', card_id: 'shot-1', kind: 'video', name: 'hf_1.mp4', mime_type: 'video/mp4', url: '/media/hf_1.mp4', created_at: NOW, duration_s: 5, ...over });
}

// ── The record ───────────────────────────────────────────────────────────

test('a generation stored before the render queue still loads, and reads as a render', () => {
	const old = generationSchema.parse({
		request_id: 'job-9', card_id: 'shot-1', provider: 'higgsfield', model: 'seedance', prompt: 'p',
		duration_s: 5, resolution: '480p', estimate_credits: 12, draft: true, status: 'in_progress', submitted_at: NOW
	});
	expect(old.state).toBeUndefined();
	expect(renderState(old)).toBe('rendering');
	expect(renderState({ ...old, status: 'queued' })).toBe('queued');
	expect(renderState({ ...old, status: 'completed' })).toBe('done');
	expect(renderState({ ...old, status: 'failed' })).toBe('failed');
	expect(renderState({ ...old, status: 'nsfw' })).toBe('refused');
});

test('a render says its own state when it has one', () => {
	expect(renderState(render({ state: 'to_approve' }))).toBe('to_approve');
});

// ── Moves ────────────────────────────────────────────────────────────────

test('a render moves only forward through approval, sending and rendering', () => {
	const allowed = new Set([
		'drafting>to_approve', 'to_approve>drafting', 'to_approve>approved', 'approved>to_approve', 'approved>queued',
		'queued>rendering', 'queued>failed', 'queued>refused', 'rendering>done', 'rendering>failed', 'rendering>refused',
		'failed>approved', 'refused>to_approve'
	]);
	for (const from of RENDER_STATES) for (const to of RENDER_STATES) expect([`${from}>${to}`, canMove(from, to)]).toEqual([`${from}>${to}`, allowed.has(`${from}>${to}`)]);
});

test('nothing reaches the provider without passing through approved', () => {
	expect(moveRender(render({ state: 'to_approve' }), 'queued', NOW)).toEqual({ ok: false, message: 'A render that is to approve cannot become queued' });
	expect(moveRender(render({ state: 'drafting' }), 'approved', NOW).ok).toBe(false);
});

test('approving, sending and finishing each leave their time', () => {
	const approved = moveRender(render({ state: 'to_approve' }), 'approved', NOW);
	if (!approved.ok) throw new Error(approved.message);
	expect(approved.render.approved_at).toBe(NOW);
	const queued = moveRender(withPrice(approved.render, { amount: 12, unit: 'credits' }, NOW), 'queued', LATER);
	if (!queued.ok) throw new Error(queued.message);
	expect(queued.render.sent_at).toBe(LATER);
	expect(queued.render.status).toBe('queued');
	const rendering = moveRender(queued.render, 'rendering', LATER);
	if (!rendering.ok) throw new Error(rendering.message);
	expect(rendering.render.status).toBe('in_progress');
	const done = moveRender(rendering.render, 'done', LATER);
	if (!done.ok) throw new Error(done.message);
	expect([done.render.status, done.render.settled_at]).toEqual(['completed', LATER]);
});

test('"Try again" on a failed render asks for a new price and a new Confirm', () => {
	const failed = render({ state: 'failed', status: 'failed', settled_at: NOW, sent_at: NOW, job_id: 'job-1', answer_code: 502, error: 'Bad gateway', price: { amount: 12, unit: 'credits', key: 'k', at: NOW } });
	const again = moveRender(failed, 'approved', LATER);
	if (!again.ok) throw new Error(again.message);
	expect(again.render.price).toBeUndefined();
	expect(again.render.settled_at).toBeUndefined();
	expect(again.render.job_id).toBeUndefined();
	expect(again.render.sent_at).toBeUndefined();
	// what went wrong stays readable until the next send
	expect([again.render.answer_code, again.render.error]).toEqual([502, 'Bad gateway']);
	expect(confirmBlockers(again.render)).toEqual(['No price yet']);
});

test('a render refused for its content goes back to approval and loses its approval and price', () => {
	const refused = render({ state: 'refused', status: 'nsfw', settled_at: NOW, approved_at: NOW, price: { amount: 12, unit: 'credits', key: 'k', at: NOW } });
	const back = moveRender(refused, 'to_approve', LATER);
	if (!back.ok) throw new Error(back.message);
	expect([back.render.approved_at, back.render.price, back.render.settled_at]).toEqual([undefined, undefined, undefined]);
});

// ── One open re-render per take ──────────────────────────────────────────

test('every state but done is open, and only what has not been sent can be removed', () => {
	expect(RENDER_STATES.filter(isOpen)).toEqual(['drafting', 'to_approve', 'approved', 'queued', 'rendering', 'failed', 'refused']);
	expect(RENDER_STATES.filter(removable)).toEqual(['drafting', 'to_approve', 'approved', 'failed', 'refused']);
});

test('queueing a re-render for a take that has one open opens that one', () => {
	const first = queueRerender([], { id: 'r1', take: take({ generation: { provider: 'higgsfield', model: 'seedance_2_5', resolution: '720p', prompt: 'Before.', duration_s: 6, generate_audio: false }, job_id: 'job-1' }), requested_change: 'Slower push', now: NOW });
	if (!first.ok) throw new Error(first.message);
	expect(first.created).toBe(true);
	expect(first.render).toMatchObject({
		request_id: 'r1', card_id: 'shot-1', answers_take_id: 'take-1', state: 'drafting', requested_change: 'Slower push',
		provider: 'higgsfield', model: 'seedance_2_5', prompt: 'Before.', prompt_before: 'Before.', duration_s: 6, generate_audio: false,
		reuse_job_id: 'job-1', submitted_at: NOW
	});
	// every entry starts at 480p, whatever the take it answers was made at
	expect(first.render.resolution).toBe('480p');
	const second = queueRerender([first.render], { id: 'r2', take: take({ job_id: 'job-1' }), requested_change: 'Something else', now: LATER });
	if (!second.ok) throw new Error(second.message);
	expect([second.created, second.render.request_id, second.render.requested_change]).toEqual([false, 'r1', 'Slower push']);
	expect(openRerenderFor([{ ...first.render, state: 'done' }], 'take-1')).toBeUndefined();
});

test('"Render again unchanged" needs no change and goes straight to approval', () => {
	const result = queueRerender([], { id: 'r1', take: take({ generation: { provider: 'higgsfield', model: 'seedance_2_5', resolution: '480p', prompt: 'Before.' }, job_id: 'job-1' }), unchanged: true, now: NOW });
	if (!result.ok) throw new Error(result.message);
	expect([result.render.state, result.render.unchanged, result.render.prompt]).toEqual(['to_approve', true, 'Before.']);
});

test('with no requested change, no notes and not "unchanged" there is nothing to go on', () => {
	const t = take({ generation: { provider: 'higgsfield', model: 'seedance_2_5', resolution: '480p', prompt: 'Before.' }, job_id: 'job-1' });
	expect(queueRerender([], { id: 'r1', take: t, requested_change: '  ', now: NOW })).toEqual({ ok: false, message: 'Type what should change, or choose "Render again unchanged"' });
	const withNotes = queueRerender([], { id: 'r1', take: t, notes: [{ text: 'Too fast', at_s: 2.5, author: 'Client' }], now: NOW });
	expect(withNotes.ok).toBe(true);
});

// ── Where the request comes from ─────────────────────────────────────────

test("a re-render's request comes from the app's own record first", () => {
	const made = render({ request_id: 'r0', state: 'done', status: 'completed', take_id: 'take-1', answers_take_id: undefined, still: { url: '/media/still.png' }, references: [{ url: '/media/sheet.png' }] });
	expect(requestSource(take({ job_id: 'job-1' }), [made])).toEqual({ kind: 'record', render: made });
});

test('a take brought in from Higgsfield is read back by its job id', () => {
	expect(requestSource(take({ job_id: 'job-1', generation: { provider: 'higgsfield', model: 'seedance_2_5', resolution: '480p', prompt: 'p' } }), [])).toEqual({ kind: 'job', job_id: 'job-1' });
	// a record that never kept its still is no better than the job id
	const bare = render({ request_id: 'job-1', state: undefined, status: 'completed', take_id: 'take-1', answers_take_id: undefined });
	expect(requestSource(take({ job_id: 'job-1' }), [bare])).toEqual({ kind: 'job', job_id: 'job-1' });
});

test('a take with neither cannot be re-rendered, and says why', () => {
	expect(requestSource(take(), [])).toEqual({ kind: 'none', reason: 'This take has no record of how it was made and no Higgsfield job id, so its request cannot be sent again' });
	expect(requestSource(take({ kind: 'image', mime_type: 'image/png', job_id: 'job-1' }), [])).toEqual({ kind: 'none', reason: 'Only a video take can be re-rendered' });
	expect(requestSource(take({ job_id: 'x', generation: { provider: 'fal', model: 'm', resolution: '480p', prompt: 'p' } }), [])).toEqual({ kind: 'none', reason: 'This take was made on fal, which cannot read an earlier request back' });
	expect(queueRerender([], { id: 'r1', take: take(), requested_change: 'Slower', now: NOW }).ok).toBe(false);
});

// ── Price and Confirm ────────────────────────────────────────────────────

test('a price belongs to exactly the settings it was asked for', () => {
	const base = render();
	const priced = withPrice(base, { amount: 12, unit: 'credits' }, NOW);
	expect(priced.price).toEqual({ amount: 12, unit: 'credits', key: priceKey(base), at: NOW });
	expect(confirmBlockers(priced)).toEqual([]);
	for (const changed of [{ resolution: '720p' }, { duration_s: 6 }, { generate_audio: false }, { provider: 'fal' as const }, { model: 'seedance_2_0' }]) {
		expect(confirmBlockers({ ...priced, ...changed })).toEqual(['The price is for other settings']);
	}
});

test('only an approved render whose check is clean can be confirmed', () => {
	const priced = withPrice(render(), { amount: 12, unit: 'credits' }, NOW);
	expect(confirmBlockers({ ...priced, state: 'to_approve' })).toEqual(['Not approved']);
	expect(confirmBlockers({ ...priced, check: ['Camera move named twice'] })).toEqual(["The prompt's check found 1 thing"]);
	expect(confirmBlockers({ ...priced, check: undefined })).toEqual(['The prompt has not been checked']);
	expect(confirmBlockers(render())).toEqual(['No price yet']);
});

test('changing the provider, model or resolution keeps the approval and drops the price', () => {
	const priced = withPrice(render({ approved_at: NOW }), { amount: 12, unit: 'credits' }, NOW);
	const changed = withSettings(priced, { resolution: '1080p' });
	if (!changed.ok) throw new Error(changed.message);
	expect([changed.render.resolution, changed.render.price, changed.render.state]).toEqual(['1080p', undefined, 'approved']);
	expect(withSettings(render({ state: 'queued' }), { resolution: '1080p' })).toEqual({ ok: false, message: 'A render that is queued cannot be changed' });
});

test('editing the prompt of an approved render sends it back to approval', () => {
	const priced = withPrice(render({ approved_at: NOW }), { amount: 12, unit: 'credits' }, NOW);
	const edited = withPrompt(priced, 'A slower push in.', ['Too long']);
	if (!edited.ok) throw new Error(edited.message);
	expect([edited.render.state, edited.render.prompt, edited.render.check, edited.render.approved_at]).toEqual(['to_approve', 'A slower push in.', ['Too long'], undefined]);
	// the price does not depend on the words
	expect(edited.render.price?.amount).toBe(12);
	expect(withPrompt(render({ state: 'rendering' }), 'x', []).ok).toBe(false);
	// the Agent's draft arriving moves a drafting entry to approval
	const drafted = withPrompt(render({ state: 'drafting' }), 'New.', []);
	if (!drafted.ok) throw new Error(drafted.message);
	expect(drafted.render.state).toBe('to_approve');
});

test('an entry queued unchanged stops saying so once its prompt is edited', () => {
	const unchanged = render({ state: 'to_approve', unchanged: true, prompt: 'Before.', prompt_before: 'Before.' });
	const same = withPrompt(unchanged, 'Before.', []);
	const edited = withPrompt(unchanged, 'After.', []);
	if (!same.ok || !edited.ok) throw new Error('not editable');
	expect([same.render.unchanged, edited.render.unchanged]).toEqual([true, undefined]);
});

test('the total is per render provider, and credits are never added to dollars', () => {
	const a = withPrice(render({ request_id: 'a' }), { amount: 12, unit: 'credits' }, NOW);
	const b = withPrice(render({ request_id: 'b' }), { amount: 30, unit: 'credits' }, NOW);
	const c = withPrice(render({ request_id: 'c', provider: 'fal' }), { amount: 0.84, unit: 'usd' }, NOW);
	const d = withPrice(render({ request_id: 'd', provider: 'fal' }), { amount: 0.21, unit: 'usd' }, NOW);
	const unpriced = render({ request_id: 'e' });
	const waiting = withPrice(render({ request_id: 'f', state: 'to_approve' }), { amount: 99, unit: 'credits' }, NOW);
	expect(totalsByProvider([a, b, c, d, unpriced, waiting])).toEqual([
		{ provider: 'higgsfield', unit: 'credits', amount: 42, count: 2 },
		{ provider: 'fal', unit: 'usd', amount: 1.05, count: 2 }
	]);
});

test('Confirm is refused for any render whose price has risen since it was shown', () => {
	const a = withPrice(render({ request_id: 'a' }), { amount: 12, unit: 'credits' }, NOW);
	const b = withPrice(render({ request_id: 'b' }), { amount: 30, unit: 'credits' }, NOW);
	expect(risenPrices([a, b], { a: { amount: 12, unit: 'credits' }, b: { amount: 10, unit: 'credits' } })).toEqual([]);
	expect(risenPrices([a, b], { a: { amount: 13, unit: 'credits' }, b: { amount: 30, unit: 'credits' } })).toEqual(['a']);
	// a price that cannot be compared (another unit, or none) counts as risen
	expect(risenPrices([a, b], { a: { amount: 1, unit: 'usd' } })).toEqual(['a', 'b']);
});

// ── The answer code ──────────────────────────────────────────────────────

test("an answer code takes the look's colours: teal for 2xx, amber for 4xx, red for 5xx", () => {
	expect([200, 204, 400, 422, 429, 500, 503].map(answerCodeColour)).toEqual(['teal', 'teal', 'amber', 'amber', 'amber', 'red', 'red']);
	expect([undefined, 302, 0].map(answerCodeColour)).toEqual(['none', 'none', 'none']);
});

test('a provider that gives a word instead of a number is coloured the same way', () => {
	expect(['completed', 'COMPLETED', 'ok'].map(answerCodeColour)).toEqual(['teal', 'teal', 'teal']);
	expect(['nsfw', 'canceled', 'cancelled', 'invalid_request'].map(answerCodeColour)).toEqual(['amber', 'amber', 'amber', 'amber']);
	expect(['failed', 'error', 'timeout'].map(answerCodeColour)).toEqual(['red', 'red', 'red']);
	expect(['queued', 'in_progress'].map(answerCodeColour)).toEqual(['none', 'none']);
});
