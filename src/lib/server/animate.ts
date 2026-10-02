import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { ProjectCommandGateway } from '$lib/application/gateway';
import type { ProjectStore } from '$lib/adapters/project-store';
import { animateGate, pendingGenerations, seedanceRequest, type AnimateSettings, type SendMode } from '$lib/domain/animate';
import { uuid7ish } from '$lib/domain/ids';
import { pickFor, type Take } from '$lib/domain/takes';
import { draftWindow, finalizeRequest, finalizingIds } from '$lib/domain/finalize';
import type { Project, StoryCard } from '$lib/domain/schemas';
import { SEEDANCE_JOB_TYPE, type VideoGenerator } from './higgsfield';

type Estimate = { credits: number };
import { generateStructured, type AgentModelClient } from './model-provider';
import { lintPrompt } from '$lib/domain/prompt-lint';
import { bannedTerms } from '$lib/domain/brief-rules';
import type { MediaProbe } from './media-probe';

/**
 * Animate flow (V1S-120): prepare (Agent-drafted prompt, gate preview, price),
 * send (gate → submit with the still as start frame → note the pending generation) and poll
 * (settle finished generations: the video is copied into the project and
 * lands as a new take on the beat). Dependencies are injected so the whole
 * flow runs against a fake generator in tests.
 */

export interface AnimateDeps {
	gateway: ProjectCommandGateway;
	store: ProjectStore;
	projectRoot: string;
	generator: VideoGenerator | null;
	probe: (file: string) => Promise<MediaProbe>;
	download: (url: string) => Promise<Uint8Array>;
}

/** YOLO spend per browser session, held by the server so the cap can't be talked around. */
const sessionSpend = new Map<string, number>();
export const spentThisSession = (sessionId: string) => sessionSpend.get(sessionId) ?? 0;
export const resetSessionSpend = () => sessionSpend.clear();

type Failure = { ok: false; status: number; code: string; message: string; reasons?: string[] };
const failure = (status: number, code: string, message: string, reasons?: string[]): Failure => ({ ok: false, status, code, message, ...(reasons ? { reasons } : {}) });

/** The beat's still pick and where it lives in the project folder. */
function stillOf(deps: AnimateDeps, project: Project, cardId: string): { ok: true; card: StoryCard; still: Take; path: string } | Failure {
	const card = project.production.cards.find((entry) => entry.card_id === cardId);
	if (!card) return failure(404, 'NOT_FOUND', `Beat ${cardId} not on this project`);
	const still = pickFor(project.production, card);
	if (!still || still.kind !== 'image') return failure(400, 'INVALID_COMMAND', 'Animate needs a beat whose pick is a still');
	const files = resolve(join(deps.projectRoot, project.project_id, 'files'));
	const prefix = `/api/projects/${project.project_id}/files/`;
	if (!still.url.startsWith(prefix)) return failure(400, 'INVALID_COMMAND', 'Animate needs a still stored in the project folder');
	const path = resolve(join(files, decodeURIComponent(still.url.slice(prefix.length))));
	if (!path.startsWith(files + sep)) return failure(400, 'INVALID_COMMAND', 'Still path escapes the project folder');
	return { ok: true, card, still, path };
}

export async function estimateAnimate(deps: AnimateDeps, settings: AnimateSettings): Promise<{ ok: true; estimate: Estimate } | Failure> {
	if (!deps.generator) return failure(503, 'NOT_CONFIGURED', 'The Higgsfield CLI was not found; install it and run "higgsfield auth login" (see Settings)');
	try {
		// The price depends on length, resolution and audio, not the image, so nothing is uploaded to quote it.
		return { ok: true, estimate: await deps.generator.estimate(seedanceRequest(settings)) };
	} catch (cause) {
		return failure(502, 'PROVIDER_ERROR', cause instanceof Error ? cause.message : 'Price check failed');
	}
}

/** The project's prompt rules (e.g. Blood Rush's trailer/PROMPT-RULES.md), if it has a rules file. */
export async function projectRules(projectRoot: string, projectId: string): Promise<string | null> {
	for (const candidate of ['PROMPT-RULES.md', join('trailer', 'PROMPT-RULES.md')]) {
		try { return await readFile(join(projectRoot, projectId, 'files', candidate), 'utf8'); }
		catch { /* next */ }
	}
	return null;
}

/** The Agent drafts a Seedance prompt from the beat, the still and the project's rules. */
export async function draftAnimatePrompt(
	client: AgentModelClient,
	input: { card: StoryCard; still: Uint8Array; stillType: string; rules: string | null }
): Promise<string> {
	const system = [
		'You are the Agent in Narrate. Write one Seedance 2.5 image-to-video prompt that animates the attached still as the start frame of this story beat.',
		'Prompt conventions (a linter enforces them before anything is sent):',
		'- Start with a short declaration line, e.g. "Image_1 is Mara." Declare a name only (one or two words, a person or a named place), never a pose or description; put the action in the shots. Cite it as @Image_1.',
		'- Never use pronouns (he, she, her, him, they, it…); repeat the declared name every time.',
		'- Name places specifically (or by their declared name), never a generic "the room" or "the interior".',
		'- Prefer several hard cuts in one generation when the beat allows.',
		'Follow the project rules exactly; never break a must-not. Return JSON only: {"prompt": string}.'
	].join('\n');
	const context = JSON.stringify({ beat: input.card.title, what_happens: input.card.beat, purpose: input.card.purpose, previous_video_prompt: input.card.video_prompt, duration_s: input.card.duration_ms / 1000, project_rules: input.rules ?? '(none)' }, null, 2);
	const parse = (value: unknown) => {
		const prompt = (value as { prompt?: unknown })?.prompt;
		if (typeof prompt !== 'string' || prompt.trim().length < 10) throw new Error('prompt must be a non-empty string');
		return prompt.trim();
	};
	const images = [{ data: input.still, mediaType: input.stillType }];
	const first = await generateStructured(client, { system, prompt: context, images, maxOutputTokens: 1200 }, parse);
	const errors = lintPrompt(first, 'seedance', bannedTerms(input.rules)).issues.filter((issue) => issue.severity === 'error');
	if (errors.length === 0) return first;
	// One re-ask with the linter's findings; whatever comes back, the operator sees the lint before sending.
	const fixes = errors.map((issue) => `- ${issue.message} (near: ${issue.context})`).join('\n');
	return generateStructured(client, { system, prompt: `${context}\n\nYour draft:\n${first}\n\nThe prompt linter rejected it:\n${fixes}\nRewrite it to pass. Return JSON only: {"prompt": string}.`, images, maxOutputTokens: 1200 }, parse);
}

export async function readStill(deps: AnimateDeps, project: Project, cardId: string) {
	const found = stillOf(deps, project, cardId);
	if (!found.ok) return found;
	return { ...found, bytes: new Uint8Array(await readFile(found.path)) };
}

export interface SendInput {
	project_id: string;
	expected_version: number;
	card_id: string;
	settings: AnimateSettings;
	mode: { kind: 'confirm'; confirmed_credits: number } | { kind: 'yolo'; cap_credits: number; session_id: string };
}

export async function sendAnimate(deps: AnimateDeps, input: SendInput): Promise<{ ok: true; project: Project; estimate: Estimate } | Failure> {
	const project = await deps.store.readProject(input.project_id);
	if (!project) return failure(404, 'NOT_FOUND', 'Project not found');
	if (project.version !== input.expected_version) return failure(409, 'VERSION_CONFLICT', `Version conflict: expected ${input.expected_version}, current ${project.version}`);
	const found = stillOf(deps, project, input.card_id);
	if (!found.ok) return found;
	const priced = await estimateAnimate(deps, input.settings);
	if (!priced.ok) return priced;
	const mode: SendMode = input.mode.kind === 'confirm'
		? input.mode
		: { kind: 'yolo', cap_credits: input.mode.cap_credits, spent_credits: spentThisSession(input.mode.session_id) };
	const banned = bannedTerms(await projectRules(deps.projectRoot, input.project_id));
	const reasons = animateGate({ prompt: input.settings.prompt, still: found.still, estimate_credits: priced.estimate.credits, mode, banned });
	if (reasons.length) return failure(422, 'GATE_BLOCKED', 'Blocked before any spend', reasons);

	// Gate passed: from here on money can move.
	const request = seedanceRequest(input.settings, found.path);
	let requestId: string;
	try {
		({ job_id: requestId } = await deps.generator!.submit(request));
	} catch (cause) {
		return failure(502, 'PROVIDER_ERROR', cause instanceof Error ? cause.message : 'Send failed');
	}
	if (input.mode.kind === 'yolo') sessionSpend.set(input.mode.session_id, spentThisSession(input.mode.session_id) + priced.estimate.credits);
	const recorded = await deps.gateway.recordGeneration(input.project_id, project.version, {
		request_id: requestId, card_id: input.card_id, provider: 'higgsfield', model: SEEDANCE_JOB_TYPE,
		prompt: request.prompt, duration_s: request.duration, resolution: request.resolution, draft: Boolean(request.draft),
		estimate_credits: priced.estimate.credits, status: 'queued', submitted_at: new Date().toISOString()
	});
	if (!recorded.ok) return failure(409, recorded.error.code, `Sent as ${requestId}, but noting it failed: ${recorded.error.message}`);
	return { ok: true, project: recorded.data, estimate: priced.estimate };
}

/** Check every pending generation once; finished ones land as takes. Returns the latest project. */
export async function pollGenerations(deps: AnimateDeps, projectId: string): Promise<{ ok: true; project: Project } | Failure> {
	let project = await deps.store.readProject(projectId);
	if (!project) return failure(404, 'NOT_FOUND', 'Project not found');
	if (!deps.generator) return { ok: true, project };
	for (const generation of pendingGenerations(project.production)) {
		let status;
		try { status = await deps.generator.status(generation.request_id); }
		catch { continue; }
		if (status.status === generation.status && status.status !== 'completed') continue;
		let take;
		if (status.status === 'completed') {
			if (!status.video_url) continue;
			const takeId = uuid7ish();
			const fileName = `${takeId.slice(-8)}-animate-${generation.card_id.slice(-12)}.mp4`;
			const folder = join(deps.projectRoot, projectId, 'files', 'board');
			const target = join(folder, fileName);
			await mkdir(folder, { recursive: true });
			try { await writeFile(target, await deps.download(status.video_url)); }
			catch { await rm(target, { force: true }); continue; }
			take = {
				asset_id: takeId, kind: 'video' as const, name: `Animate ${generation.draft ? 'draft ' : ''}${generation.resolution} · ${generation.duration_s}s`,
				mime_type: 'video/mp4', url: `/api/projects/${projectId}/files/board/${encodeURIComponent(fileName)}`,
				...(await deps.probe(target)), job_id: generation.request_id,
				generation: { provider: generation.provider, model: generation.model, resolution: generation.resolution, prompt: generation.prompt, duration_s: generation.duration_s, draft: generation.draft },
				created_at: new Date().toISOString()
			};
		}
		const settled = await deps.gateway.settleGeneration(projectId, project.version, generation.request_id, { status: status.status, take, error: status.error });
		if (settled.ok) project = settled.data;
	}
	return { ok: true, project };
}

// --- Finalize (V1S-124): price a set of draft takes, then send them after an explicit confirm of that price.

export interface FinalizeQuote {
	items: Array<{ take_id: string; card_id: string; name: string; credits: number; closes_at: string }>;
	total_credits: number;
	balance: { credits: number; plan: string | null } | null;
}

export async function quoteFinalize(deps: AnimateDeps, project: Project, takeIds: string[], now = Date.now()): Promise<{ ok: true; quote: FinalizeQuote } | Failure> {
	if (!deps.generator) return failure(503, 'NOT_CONFIGURED', 'The Higgsfield CLI was not found; install it and run "higgsfield auth login" (see Settings)');
	const items: FinalizeQuote['items'] = [];
	const sent = finalizingIds(project.production);
	const jobs = new Map<string, string>();
	for (const takeId of [...new Set(takeIds)]) {
		const take = project.production.assets.find((asset) => asset.asset_id === takeId);
		if (!take) return failure(404, 'NOT_FOUND', `Take ${takeId} not found`);
		const window = draftWindow(take, now);
		if (window.state !== 'open' && window.state !== 'closing') return failure(400, 'INVALID_COMMAND', `${take.name} is not a draft that can still be finalized`);
		if (sent.has(take.asset_id)) return failure(409, 'INVALID_COMMAND', `${take.name} is already being finalized`);
		const twin = jobs.get(take.job_id!);
		if (twin) return failure(400, 'INVALID_COMMAND', `${take.name} and ${twin} come from the same draft; finalize one of them`);
		jobs.set(take.job_id!, take.name);
		const request = finalizeRequest(take)!;
		try {
			const { credits } = await deps.generator.estimate(request);
			items.push({ take_id: take.asset_id, card_id: take.card_id, name: take.name, credits, closes_at: window.closes_at });
		} catch (cause) {
			return failure(502, 'PROVIDER_ERROR', cause instanceof Error ? cause.message : 'Price check failed');
		}
	}
	return { ok: true, quote: { items, total_credits: items.reduce((sum, item) => sum + item.credits, 0), balance: await deps.generator.balance() } };
}

/** Re-quote, refuse on a higher price or a short balance, then submit each finalize and note them as pending. */
export async function sendFinalize(
	deps: AnimateDeps,
	input: { project_id: string; expected_version: number; take_ids: string[]; confirmed_credits: number }
): Promise<{ ok: true; project: Project; quote: FinalizeQuote } | Failure> {
	const project = await deps.store.readProject(input.project_id);
	if (!project) return failure(404, 'NOT_FOUND', 'Project not found');
	if (project.version !== input.expected_version) return failure(409, 'VERSION_CONFLICT', `Version conflict: expected ${input.expected_version}, current ${project.version}`);
	const quoted = await quoteFinalize(deps, project, input.take_ids);
	if (!quoted.ok) return quoted;
	const { quote } = quoted;
	const reasons: string[] = [];
	if (quote.total_credits > input.confirmed_credits + 1e-6) reasons.push(`The price is now ${quote.total_credits} credits, above the ${input.confirmed_credits} you confirmed`);
	if (quote.balance && quote.balance.credits < quote.total_credits) reasons.push(`Not enough credits: ${quote.total_credits} needed, ${quote.balance.credits} left`);
	if (reasons.length) return failure(422, 'GATE_BLOCKED', 'Blocked before any spend', reasons);

	const generations = [];
	for (const item of quote.items) {
		const take = project.production.assets.find((asset) => asset.asset_id === item.take_id)!;
		const request = finalizeRequest(take)!;
		try {
			const { job_id } = await deps.generator!.submit(request);
			generations.push({
				request_id: job_id, card_id: take.card_id, provider: 'higgsfield' as const, model: SEEDANCE_JOB_TYPE, prompt: request.prompt,
				duration_s: request.duration, resolution: '1080p', draft: false, estimate_credits: item.credits,
				status: 'queued' as const, submitted_at: new Date().toISOString(), finalizes: take.asset_id
			});
		} catch (cause) {
			// Note what was already sent before reporting, so nothing in flight is lost.
			if (generations.length) await deps.gateway.recordFinalizes(input.project_id, project.version, generations);
			return failure(502, 'PROVIDER_ERROR', `${cause instanceof Error ? cause.message : 'Send failed'} (${generations.length} of ${quote.items.length} sent)`);
		}
	}
	const recorded = await deps.gateway.recordFinalizes(input.project_id, project.version, generations);
	if (!recorded.ok) return failure(409, recorded.error.code, `Sent, but noting them failed: ${recorded.error.message}`);
	return { ok: true, project: recorded.data, quote };
}
