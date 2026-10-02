import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema, type TrailerHouse } from '$lib/domain/schemas';
import { checkTarget, SEEDANCE_TARGET_IDS, type SeedanceTarget } from '$lib/domain/trailer-house';
import { describeModelChoice } from '$lib/domain/model-provider';
import { getGateway, getProjectStore, resolveProjectModel } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';
import { createOpenAICompatibleClient } from '$lib/server/model-provider';
import { continueWith, offeredFor, pitchThree, teaserFor, type CharacterImage } from '$lib/server/trailer-house';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getProjectRoot } from '$lib/server/config';
import { projectRules } from '$lib/server/animate';
import { bannedTerms } from '$lib/domain/brief-rules';

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : status === 409 ? 'VERSION_CONFLICT' : 'INVALID_COMMAND', message, retryable: status >= 500, source: 'trailer-house' } }, { status });

const targetSchema = z.object({ model: z.enum(SEEDANCE_TARGET_IDS as [SeedanceTarget, ...SeedanceTarget[]]), seconds: z.number().int(), aspect: z.string().min(1).max(20) });
const version = z.number().int().nonnegative();
const bodySchema = z.discriminatedUnion('action', [
	// Three pitches from the seeds (again = three more, different from those already offered for these seeds).
	z.object({ action: z.literal('pitch'), expected_version: version, seeds: z.string().max(5000), character: z.string().max(3000).default(''), target: targetSchema }),
	// The operator picks a pitch: its teaser right away (title, logline, hook, Seedance prompt).
	z.object({ action: z.literal('develop'), expected_version: version, round: z.number().int().nonnegative(), index: z.number().int().min(0).max(2), character: z.string().max(3000).optional(), target: targetSchema.optional() }),
	// Continue past the teaser: main character and relationships, or the plot outline.
	z.object({ action: z.literal('continue'), expected_version: version, step: z.enum(['characters', 'outline']) }),
	// Start over: forget the pitches, teaser and continuations (the seeds stay).
	z.object({ action: z.literal('clear'), expected_version: version })
]);

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
	const save = async (next: TrailerHouse) => {
		const outcome = await getGateway().setTrailerHouse(projectId.data, body.data.expected_version, next);
		return outcome.ok ? json(outcome) : json(outcome, { status: commandStatus(outcome.error) });
	};
	const action = body.data;

	if (action.action === 'clear') {
		if (!house) return fail(400, 'Nothing to clear');
		return save({ ...house, rounds: [], picked: null, blueprint: null, characters: null, outline: null, updated_at: now });
	}

	const target = action.action === 'pitch' ? action.target : action.action === 'develop' ? action.target ?? house?.target : house?.target;
	if (!target) return fail(400, 'Pick the video model and length first');
	const fits = checkTarget(target);
	if (!fits.ok) return fail(400, fits.message);
	const resolved = await resolveProjectModel(project);
	if (!resolved.ok) return fail(503, `No Agent model: ${resolved.message}`);
	const client = createOpenAICompatibleClient(resolved.connection);
	const model = describeModelChoice(resolved.connection.choice);
	// The main character's reference image, shown to the Agent in every step.
	const ref = house?.character_image;
	let image: CharacterImage | null = null;
	if (ref) {
		try { image = { data: new Uint8Array(await readFile(join(getProjectRoot(), projectId.data, 'files', 'trailer-house', ref.file))), mediaType: ref.mime_type, name: ref.name }; }
		catch { return fail(400, `The character image ${ref.name} is missing from the project files; attach it again`); }
	}

	try {
		if (action.action === 'pitch') {
			const { pitches } = await pitchThree(client, project, { seeds: action.seeds, character: action.character, image, target, earlier: offeredFor(house, action.seeds) });
			return save({
				target, seeds: action.seeds, character: action.character, character_image: house?.character_image ?? null,
				rounds: [...(house?.rounds ?? []), { seeds: action.seeds, pitches, model, created_at: now }],
				picked: house?.picked ?? null, blueprint: house?.blueprint ?? null,
				characters: house?.characters ?? null, outline: house?.outline ?? null, updated_at: now
			});
		}
		if (!house) return fail(400, 'Pitch three loglines first');
		if (action.action === 'develop') {
			const round = house.rounds[action.round];
			const pick = round?.pitches[action.index];
			if (!round || !pick) return fail(400, 'That pitch is not on record');
			const character = action.character ?? house.character;
			const { blueprint, raw } = await teaserFor(client, project, { seeds: round.seeds, character, image, target, offered: round.pitches, pick, banned: bannedTerms((await projectRules(getProjectRoot(), projectId.data)) ?? '') });
			// A new teaser means the old cast and outline no longer fit it.
			return save({ ...house, target, character, picked: { round: action.round, index: action.index }, blueprint: { ...blueprint, raw, model, created_at: now }, characters: null, outline: null, updated_at: now });
		}
		const text = await continueWith(client, project, house, action.step, undefined, image);
		return save({ ...house, [action.step]: { text, model, created_at: now }, ...(action.step === 'characters' ? { outline: null } : {}), updated_at: now });
	} catch (cause) {
		return fail(502, `The Agent couldn't answer: ${cause instanceof Error ? cause.message : 'model error'}`);
	}
};
