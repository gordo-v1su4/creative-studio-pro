import { z } from 'zod';
import type { StoryCard } from '$lib/domain/schemas';
import { clockOf } from '$lib/domain/episode-outline';
import { compileHandles, type HandleReference } from '$lib/domain/handles';
import { checkDialogue, sceneProblems, strayHandles, type ShotForCheck } from '$lib/domain/scene-check';
import { shotSpecSchema, SPEC_MAX_S, SPEC_MIN_S, specText, type ShotSpec } from '$lib/domain/shot-spec';
import { ghostQc, GHOST_SECTIONS, MUSIC_CLOSER, MUSIC_OPENER } from '$lib/domain/ghost-qc';
import { generateStructured, type AgentModelClient } from './model-provider';
import { readAgentSkill } from './agent-skills';
import { fitContext, sceneBudget, type FitContext } from './episode-fit';

/**
 * Shots from Ghost (V1S-375, ADR 0003): the app's copy of the Ghost skill turns a scene into coverage. Step one
 * proposes the scene's shots as shot specs (fields, no prompts), checked for dialogue placement and stray
 * references, with the Agent fixing its own misses. The operator approves them. Step two writes each approved
 * shot's video prompt in Ghost's eleven-section format; code swaps the @handles for exact names and Ghost's
 * image tags, and the Ghost QC runs, with up to two repair rounds. Text only: nothing is sent to a model here.
 */

export async function ghostSystem(): Promise<string> {
	return [
		'You are Ghost, the shot writer inside Creative Studio Pro, for a live-action web series. Follow this skill exactly.',
		'',
		await readAgentSkill('ghost'),
		'',
		'# Inside the app (these override the skill where they differ)',
		'- People, places and props that have a reference (the scene lists them with @handles): write the @handle every time, e.g. "@Kai turns to @Mara". Never write their full name or an image number yourself: the app swaps each handle for the exact name and its image tag, and writes the upload list.',
		'- Everyone and everything else: an exact, fixed name, the same every time.',
		'- Dialogue: only the scene\'s scripted lines, verbatim, each in exactly one shot. Never invent, change or split a line.',
		`- Every shot is ${SPEC_MIN_S}–${SPEC_MAX_S} seconds, one clip. Night unless the scene says otherwise. Never use the word "neon".`,
		'- Sound: dialogue and the sounds of what we see, never music (MODE 4 opener and closer, word for word).'
	].join('\n');
}

const shotsAnswer = (n: number) => z.object({ shots: z.array(shotSpecSchema).min(1).max(n + 2) });
const SPEC_FORMAT = `Answer with only a JSON object, no other text:
{"shots":[{"size":"ECU|CU|MCU|MS|WS","angle":"eye level","subjects":["@Kai","@Mara"],"action":"one or two sentences, one action per beat, by @handle","dialogue":"the scripted lines this shot speaks, copied exactly as SPEAKER (delivery): \\"line\\", one per line, or empty","location":"@Handle or the exact place","light":"night, the motivated source","camera_move":"the move and its physical reason","duration_s":6}]}`;

/** The checklist the Agent holds its proposed shots against. */
export const SPEC_CHECK = [
	'1. The ACTION is covered, all of it, in order, with reactions and inserts where a beat needs them.',
	'2. Every DIALOGUE line not already in an existing shot is in exactly one new shot\'s "dialogue", word for word.',
	'3. Each season story beat this scene carries is on screen.',
	'4. Only the scene\'s REFERENCES are used, by @handle; nobody from elsewhere in the series appears.',
	'5. No hero shots, side and back angles preferred, fewest strong shots (Ghost house rules).'
].join('\n');

export function proposeAsk(input: FitContext): string {
	const { scene } = input;
	return `${fitContext(input)}

THE JOB (Ghost IDEAS for coverage, as SHOT SPECS only, no prompts yet): this scene has ${clockOf(Math.max(0, scene.gap_s))} too little. Propose ${scene.shots_wanted} NEW shots, about ${scene.gap_s} s in total (each ${SPEC_MIN_S}–${SPEC_MAX_S} s), that play after the existing shots and cover the scene. Stay inside this scene: same place, same time, only its characters.

${SPEC_FORMAT}`;
}

/** What the app's own check finds wrong with proposed shots (dialogue placement, stray handles). */
export function checkSpecs(input: Pick<FitContext, 'series' | 'scene' | 'sceneCards' | 'references'>, specs: ShotSpec[]): string[] {
	const scene = input.series.scenes.find((entry) => entry.page_id === input.scene.page_id);
	const titled: ShotForCheck[] = specs.map((spec, i) => ({ title: `New shot ${i + 1}`, dialogue: spec.dialogue, video_prompt: specText(spec) }));
	const dialogueOf = (card: StoryCard) => card.source?.dialogue ?? card.fit?.spec?.dialogue ?? card.fit?.dialogue ?? '';
	const placed: ShotForCheck[] = input.sceneCards.map((card) => ({ title: card.title, dialogue: dialogueOf(card), video_prompt: card.video_prompt }));
	const allowed = (input.references ?? []).flatMap((ref) => ref.handles);
	const stray = allowed.length || specs.some((spec) => /@[A-Za-z]/.test(specText(spec))) ? strayHandles(titled, allowed) : [];
	return sceneProblems(checkDialogue(scene?.dialogue ?? '', titled, placed), stray);
}

export class SpecCheckFailed extends Error {
	constructor(readonly problems: string[]) { super(`The scene's shots still fail their check: ${problems.join('; ')}`); }
}

/** Step one: the scene's coverage as shot specs, checked, with the Agent fixing its own misses. */
export async function proposeShots(client: AgentModelClient, input: FitContext & { system: string }, onCheck: (round: number, problems: string[]) => void | Promise<void> = () => {}, maxRounds = 2): Promise<ShotSpec[]> {
	const parse = (value: unknown) => shotsAnswer(input.scene.shots_wanted).parse(value).shots;
	const budget = sceneBudget(input.scene.shots_wanted);
	let specs = await generateStructured(client, { system: input.system, prompt: proposeAsk(input), ...budget }, parse);
	let problems = checkSpecs(input, specs);
	for (let round = 1; round <= maxRounds && (round === 1 || problems.length); round++) {
		await onCheck(round - 1, problems);
		const ask = `${fitContext(input)}\n\nYOUR PROPOSED SHOTS:\n${JSON.stringify({ shots: specs }, null, 1)}\n\nCHECK THEM AGAINST THIS CHECKLIST and fix every miss:\n${SPEC_CHECK}\n\n${problems.length ? `THE APP'S CHECK FOUND THESE PROBLEMS (fix all of them):\n${problems.map((p) => `- ${p}`).join('\n')}` : 'The app found no dialogue or reference problems; still check the action and the story beats.'}\n\nReturn all the shots, corrected. ${SPEC_FORMAT}`;
		specs = await generateStructured(client, { system: input.system, prompt: ask, ...budget }, parse);
		problems = checkSpecs(input, specs);
	}
	await onCheck(maxRounds, problems);
	if (problems.length) throw new SpecCheckFailed(problems);
	return specs;
}


export interface WrittenPrompt { video_prompt: string; compiled: string; qc: string[]; rounds: number }

/** Step two: Ghost writes one approved shot's video prompt; compile, QC, and up to `maxRepairs` repair rounds. */
export async function writeShotPrompt(client: AgentModelClient, input: { system: string; context: string; title: string; spec: ShotSpec; references: HandleReference[]; banned: string[] }, maxRepairs = 2): Promise<WrittenPrompt> {
	const compile = (prompt: string) => compileHandles(prompt, input.references, 'ghost');
	const check = (prompt: string) => { const compiled = compile(prompt); return { compiled: compiled.prompt, qc: ghostQc(compiled.prompt, { duration_s: input.spec.duration_s, references: compiled.images.map((image) => image.reference.name), banned: input.banned }) }; };
	const parse = (value: unknown) => { const text = String((value as { video_prompt?: unknown })?.video_prompt ?? '').trim(); if (text.length < 200) throw new Error('video_prompt: too short; write every section in full'); return text; };
	const ask = `${input.context}

THE APPROVED SHOT SPEC for ${input.title} (write from it; change nothing in it):
${JSON.stringify(input.spec, null, 2)}

Write this shot's FINAL VIDEO PROMPT the Ghost way: the first line "${input.spec.duration_s} s. Upload:" (the app fills in the list), then the eleven sections in this exact order, each a dense paragraph headed by its name and a colon: ${GHOST_SECTIONS.join(' · ')}. In TIMELINE, give every shot block its seconds inside ${input.spec.duration_s} s. The SOUND section opens with "${MUSIC_OPENER}" and the prompt ends with "${MUSIC_CLOSER}". Dialogue is exactly the spec's lines. Answer with only JSON: {"video_prompt": "the whole prompt"}`;
	let prompt = await generateStructured(client, { system: input.system, prompt: ask, maxOutputTokens: 4000, timeoutMs: 180_000 }, parse);
	let result = check(prompt);
	let rounds = 0;
	while (result.qc.length && rounds < maxRepairs) {
		rounds++;
		const repair = `${ask}\n\nYOUR PROMPT:\n${prompt}\n\nTHE QC FOUND (fix every one, keep everything else):\n${result.qc.map((issue) => `- ${issue}`).join('\n')}\n\nAnswer with only JSON: {"video_prompt": "the whole corrected prompt"}`;
		prompt = await generateStructured(client, { system: input.system, prompt: repair, maxOutputTokens: 4000, timeoutMs: 180_000 }, parse);
		result = check(prompt);
	}
	return { video_prompt: prompt, compiled: result.compiled, qc: result.qc, rounds };
}
