import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { ProjectCommandGateway } from '$lib/application/gateway';
import type { ProjectStore } from '$lib/adapters/project-store';
import { SEEDANCE_I2V, animateBody, animateGate, pendingGenerations, type AnimateSettings, type SendMode } from '$lib/domain/animate';
import { uuid7ish } from '$lib/domain/ids';
import { pickFor, type Take } from '$lib/domain/takes';
import type { Project, StoryCard } from '$lib/domain/schemas';
import type { Estimate, VideoGenerator } from './higgsfield';
import { generateStructured, type AgentModelClient } from './model-provider';
import { lintPrompt } from '$lib/domain/prompt-lint';
import type { MediaProbe } from './media-probe';

/**
 * Animate flow (V1S-120): prepare (Agent-drafted prompt, gate preview, price),
 * send (gate → upload still → submit → note the pending generation) and poll
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

/** The price is a function of the body, not the image; a stand-in URL prices it without uploading anything. */
const PRICE_PROBE_IMAGE = 'https://example.com/still.png';

export async function estimateAnimate(deps: AnimateDeps, settings: AnimateSettings): Promise<{ ok: true; estimate: Estimate } | Failure> {
	if (!deps.generator) return failure(503, 'NOT_CONFIGURED', 'Add a Higgsfield API key in Settings to price and send Animate');
	try {
		return { ok: true, estimate: await deps.generator.estimate(SEEDANCE_I2V, animateBody(settings, PRICE_PROBE_IMAGE)) };
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
	const errors = lintPrompt(first, 'seedance').issues.filter((issue) => issue.severity === 'error');
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
	mode: { kind: 'confirm'; confirmed_usd: number } | { kind: 'yolo'; cap_usd: number; session_id: string };
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
		: { kind: 'yolo', cap_usd: input.mode.cap_usd, spent_usd: spentThisSession(input.mode.session_id) };
	const reasons = animateGate({ prompt: input.settings.prompt, still: found.still, estimate_usd: priced.estimate.usd, mode });
	if (reasons.length) return failure(422, 'GATE_BLOCKED', 'Blocked before any spend', reasons);

	// Gate passed: from here on money can move.
	const generator = deps.generator!;
	let requestId: string;
	try {
		const imageUrl = await generator.upload(new Uint8Array(await readFile(found.path)), found.still.mime_type.includes('*') ? 'image/png' : found.still.mime_type);
		({ request_id: requestId } = await generator.submit(SEEDANCE_I2V, animateBody(input.settings, imageUrl), uuid7ish()));
	} catch (cause) {
		return failure(502, 'PROVIDER_ERROR', cause instanceof Error ? cause.message : 'Send failed');
	}
	if (input.mode.kind === 'yolo') sessionSpend.set(input.mode.session_id, spentThisSession(input.mode.session_id) + priced.estimate.usd);
	const recorded = await deps.gateway.recordGeneration(input.project_id, project.version, {
		request_id: requestId, card_id: input.card_id, provider: 'higgsfield', model: SEEDANCE_I2V,
		prompt: input.settings.prompt.trim(), duration_s: Number(animateBody(input.settings, '').duration),
		resolution: input.settings.resolution, estimate_usd: priced.estimate.usd, status: 'queued', submitted_at: new Date().toISOString()
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
				asset_id: takeId, kind: 'video' as const, name: `Animate ${generation.resolution} · ${generation.duration_s}s`,
				mime_type: 'video/mp4', url: `/api/projects/${projectId}/files/board/${encodeURIComponent(fileName)}`,
				...(await deps.probe(target)), job_id: generation.request_id,
				generation: { provider: generation.provider, model: generation.model, resolution: generation.resolution, prompt: generation.prompt },
				created_at: new Date().toISOString()
			};
		}
		const settled = await deps.gateway.settleGeneration(projectId, project.version, generation.request_id, { status: status.status, take, error: status.error });
		if (settled.ok) project = settled.data;
	}
	return { ok: true, project };
}
