import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RequestHandler } from './$types';
import { idSchema, type TrailerHouse } from '$lib/domain/schemas';
import { checkTarget, SEEDANCE_TARGET_IDS, type SeedanceTarget, type TeaserTarget } from '$lib/domain/trailer-house';
import { describeModelChoice } from '$lib/domain/model-provider';
import { bannedTerms } from '$lib/domain/brief-rules';
import { getGateway, getProjectRoot, getProjectStore, resolveProjectModel } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';
import { createOpenAICompatibleClient, type AgentModelClient } from '$lib/server/model-provider';
import { projectRules } from '$lib/server/animate';
import { continueWith, imagesFor, lintAndFix, masterPrompt, offeredFor, pitchThree, teaserFor, type CharacterImage, type LintRound } from '$lib/server/trailer-house';

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : status === 409 ? 'VERSION_CONFLICT' : 'INVALID_COMMAND', message, retryable: status >= 500, source: 'trailer-house' } }, { status });

const targetSchema = z.object({ model: z.enum(SEEDANCE_TARGET_IDS as [SeedanceTarget, ...SeedanceTarget[]]), seconds: z.number().int(), aspect: z.string().min(1).max(20) });
const version = z.number().int().nonnegative();
const bodySchema = z.discriminatedUnion('action', [
	// Three pitches from the seeds (again = three more, different from those already offered for these seeds).
	z.object({ action: z.literal('pitch'), expected_version: version, seeds: z.string().max(5000), character: z.string().max(3000).default(''), target: targetSchema }),
	// The operator picks a pitch: its teaser right away, linted and fixed by the Agent (streamed, so the app shows it live).
	z.object({ action: z.literal('develop'), expected_version: version, round: z.number().int().nonnegative(), index: z.number().int().min(0).max(2), character: z.string().max(3000).optional(), target: targetSchema.optional() }),
	// Lint the current teaser again and let the Agent fix what is left (streamed).
	z.object({ action: z.literal('relint'), expected_version: version }),
	// Continue past the teaser: main character and relationships, or the plot outline.
	z.object({ action: z.literal('continue'), expected_version: version, step: z.enum(['characters', 'outline']) }),
	// Start over: forget the pitches, teaser and continuations (the seeds and renders stay).
	z.object({ action: z.literal('clear'), expected_version: version })
]);

/** A streamed answer: one JSON object per line (status, each lint round, then done or error). */
function stream(run: (send: (event: Record<string, unknown>) => void) => Promise<void>): Response {
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
			try { await run(send); }
			catch (cause) { send({ type: 'error', message: `The Agent couldn't answer: ${cause instanceof Error ? cause.message : 'model error'}` }); }
			finally { controller.close(); }
		}
	});
	return new Response(body, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
}

const lintSummary = (rounds: LintRound[]) => {
	const last = rounds.at(-1)!;
	return {
		rounds: rounds.length - 1,
		fixed: Math.max(0, rounds[0].issues.length - last.issues.length),
		remaining: last.issues.map((issue) => ({ rule: issue.rule, severity: issue.severity, match: ['banned-word', 'project-rule'].includes(issue.rule) ? '(banned word)' : issue.match.slice(0, 400), message: issue.message.slice(0, 400) }))
	};
};

/** Trailer House (the start of a project): seeds → three pitches → pick one → teaser → continue, by the Agent. */
export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	const body = bodySchema.safeParse(await request.json().catch(() => null));
	if (!body.success) return fail(400, body.error.issues[0]?.message ?? 'Invalid request');
	const project = await getProjectStore().readProject(projectId.data);
	if (!project) return fail(404, 'Project not found');
	if (project.version !== body.data.expected_version) return fail(409, 'The project changed; reload and try again');
	const house = project.trailer_house;
	const now = new Date().toISOString();
	const saveOutcome = (next: TrailerHouse) => getGateway().setTrailerHouse(projectId.data, body.data.expected_version, next);
	const save = async (next: TrailerHouse) => {
		const outcome = await saveOutcome(next);
		return outcome.ok ? json(outcome) : json(outcome, { status: commandStatus(outcome.error) });
	};
	const action = body.data;

	if (action.action === 'clear') {
		if (!house) return fail(400, 'Nothing to clear');
		return save({ ...house, rounds: [], picked: null, blueprint: null, characters: null, outline: null, updated_at: now });
	}

	const target: TeaserTarget | undefined = action.action === 'pitch' ? action.target : action.action === 'develop' ? action.target ?? house?.target : house?.target;
	if (!target) return fail(400, 'Pick the video model and length first');
	const fits = checkTarget(target);
	if (!fits.ok) return fail(400, fits.message);
	const resolved = await resolveProjectModel(project);
	if (!resolved.ok) return fail(503, `No Agent model: ${resolved.message}`);
	const client: AgentModelClient = createOpenAICompatibleClient(resolved.connection);
	const model = describeModelChoice(resolved.connection.choice);
	// Who is working, for the live status line ("Kimi k3 is writing the teaser…").
	const agent = resolved.connection.choice.provider === 'kimi' ? `Kimi ${resolved.connection.choice.model}` : resolved.connection.choice.model;
	// The main character's reference image, shown to the Agent in every step.
	const ref = house?.character_image;
	let image: CharacterImage | null = null;
	if (ref) {
		try { image = { data: new Uint8Array(await readFile(join(getProjectRoot(), projectId.data, 'files', 'trailer-house', ref.file))), mediaType: ref.mime_type, name: ref.name }; }
		catch { return fail(400, `The character image ${ref.name} is missing from the project files; attach it again`); }
	}
	const banned = async () => bannedTerms((await projectRules(getProjectRoot(), projectId.data)) ?? '');

	if (action.action === 'pitch') {
		try {
			const { pitches } = await pitchThree(client, project, { seeds: action.seeds, character: action.character, image, target, earlier: offeredFor(house, action.seeds) });
			return save({
				target, seeds: action.seeds, character: action.character, character_image: house?.character_image ?? null,
				rounds: [...(house?.rounds ?? []), { seeds: action.seeds, pitches, model, created_at: now }],
				picked: house?.picked ?? null, blueprint: house?.blueprint ?? null,
				characters: house?.characters ?? null, outline: house?.outline ?? null, renders: house?.renders ?? [], updated_at: now
			});
		} catch (cause) {
			return fail(502, `The Agent couldn't answer: ${cause instanceof Error ? cause.message : 'model error'}`);
		}
	}
	if (!house) return fail(400, 'Pitch three loglines first');

	if (action.action === 'develop' || action.action === 'relint') {
		return stream(async (send) => {
			let blueprint, raw, system, context, picked = house.picked, character = house.character;
			if (action.action === 'develop') {
				const round = house.rounds[action.round];
				const pick = round?.pitches[action.index];
				if (!round || !pick) { send({ type: 'error', message: 'That pitch is not on record' }); return; }
				character = action.character ?? house.character;
				picked = { round: action.round, index: action.index };
				send({ type: 'status', text: `${agent} is writing the teaser…` });
				({ blueprint, raw, system, context } = await teaserFor(client, project, { seeds: round.seeds, character, image, target, offered: round.pitches, pick }));
				send({ type: 'teaser', blueprint });
			} else {
				if (!house.blueprint) { send({ type: 'error', message: 'Write the teaser first' }); return; }
				({ raw } = house.blueprint);
				blueprint = { title: house.blueprint.title, logline: house.blueprint.logline, hook: house.blueprint.hook, seedance_prompt: house.blueprint.seedance_prompt };
				system = await masterPrompt(target);
				context = `THE TEASER SO FAR:\nTITLE: ${blueprint.title}\nLOGLINE: ${blueprint.logline}\nHOOK: ${blueprint.hook}`;
			}
			send({ type: 'status', text: 'Linting the Seedance prompt…' });
			const linted = await lintAndFix(client, { system, context, prompt: blueprint.seedance_prompt, banned: await banned(), images: imagesFor(image) }, (round) => {
				send({ type: 'lint', ...round });
				if (round.issues.length) send({ type: 'status', text: `${agent} is fixing ${round.issues.length} problem${round.issues.length === 1 ? '' : 's'}…` });
			});
			const lint = lintSummary(linted.rounds);
			const fixed = { ...blueprint, seedance_prompt: linted.prompt, raw, model, created_at: now, lint };
			// A new teaser means the old cast and outline no longer fit it.
			const next: TrailerHouse = action.action === 'develop'
				? { ...house, target, character, picked, blueprint: fixed, characters: null, outline: null, updated_at: now }
				: { ...house, blueprint: { ...house.blueprint!, seedance_prompt: linted.prompt, lint }, updated_at: now };
			const outcome = await saveOutcome(next);
			send(outcome.ok ? { type: 'done', ok: true, data: outcome.data } : { type: 'error', message: outcome.error.message });
		});
	}

	try {
		const text = await continueWith(client, project, house, action.step, undefined, image);
		return save({ ...house, [action.step]: { text, model, created_at: now }, ...(action.step === 'characters' ? { outline: null } : {}), updated_at: now });
	} catch (cause) {
		return fail(502, `The Agent couldn't answer: ${cause instanceof Error ? cause.message : 'model error'}`);
	}
};

