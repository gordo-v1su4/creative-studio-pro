import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Project, StoryCard } from '$lib/domain/schemas';
import { clockOf, type EpisodeOutline } from '$lib/domain/episode-outline';
import { FIT_SHOT_MAX_S, FIT_SHOT_MIN_S, parseFitShots, type FitScene, type FitShot, type FittedShot } from '$lib/domain/episode-fit';
import { compileHandles, type HandleReference } from '$lib/domain/handles';
import { checkDialogue, sceneProblems, strayHandles, type ShotForCheck } from '$lib/domain/scene-check';
import { generateStructured, type AgentModelClient } from '$lib/server/model-provider';
import { lintAndFix, lintTeaser, redactAll, type LintRound } from '$lib/server/trailer-house';

/**
 * Fit to length, the Agent's side: for one scene, write the new shots (one answer, JSON) from the scene's
 * Action, Dialogue, season story beats and References; check them (every scripted line placed once,
 * verbatim; only the scene's references) and let the Agent fix its own misses against a checklist; then put
 * every shot's Seedance prompt, handles compiled, through the operator's linter (`lintAndFix`, shots in
 * parallel). The naming rules come from the Seedance 2.5 skill, so the app and the skill never disagree.
 * Fit only writes text: it never sends anything to an image or video model.
 */

const FORMAT_PATH = join(process.cwd(), '.agents', 'skills', 'seedance-2-5-higgsfield', 'format.md');

/** The skill's naming rules (the part of its format the linter checks). */
async function namingRules(path = FORMAT_PATH): Promise<string> {
	const format = await readFile(path, 'utf8');
	const at = format.indexOf('Naming rules');
	return at >= 0 ? format.slice(at).trim() : '';
}

export async function fitSystemPrompt(path?: string): Promise<string> {
	return [
		'You are the shot writer for a live-action web series. An episode is shorter than its target length, so you extend its scenes with new shots. Each shot is one Seedance 2.5 generation.',
		'',
		`Each shot is ${FIT_SHOT_MIN_S}–${FIT_SHOT_MAX_S} seconds. Its VIDEO PROMPT is plain text, no Markdown:`,
		'- Every character, place and prop that has a reference (the scene lists them with their @handles): write its @handle every time it appears, e.g. "@Kai turns to @Mara". Never write "@Image_…" lines or the full name yourself: the app swaps each handle for the exact name, declares it at the top and attaches the image.',
		'- Every other character and place in the shot: first a declaration line "No image: <exact name> — <one fixed line>", then that exact name every time.',
		'- Then one short paragraph in shot order: framing and angle, the camera move, one concrete action, the light. "Cut to …" before any hard cut inside the shot. Each sound at the moment it happens, as its own short sentence.',
		'- Dialogue: only the scene\'s scripted lines, verbatim, each in exactly one shot. In the prompt, as its own block: one line "<SPEAKER NAME IN CAPITALS>, <where they are or who they speak to, by @handle>, <delivery>:" and the exact words in quotes on the next line. Never invent, change or split a line.',
		'- End with: "Speak only the scripted lines, verbatim. No subtitles. No on-screen text."',
		'',
		await namingRules(path),
		'',
		'Its IMAGE PROMPT is the 16:9 keyframe for the same shot, in the style of the scene\'s existing image prompts; name referenced people, places and props by their @handles there too (the app turns them into image labels).'
	].join('\n');
}

/** Every banned word the linter finds in a text (built-in bans and the project's), for blacking out. */
const bannedIn = (text: string, banned: string[]) => lintTeaser(text, banned).filter((issue) => issue.rule === 'banned-word' || issue.rule === 'project-rule').map((issue) => issue.match);

export interface FitContext {
	story: string;
	series: NonNullable<Project['series']>;
	outline: EpisodeOutline;
	target_min: number;
	scene: FitScene;
	/** The scene's beats now on the board, in order. */
	sceneCards: StoryCard[];
	/** The scene after this one, so the new shots lead into it. */
	nextScene: { title: string; summary: string } | null;
	banned: string[];
	/** V1S-329: the season story beats this scene carries (title + summary). */
	storyBeats?: Array<{ title: string; section: string; summary: string }>;
	/** V1S-329: the scene's references (exact names, handles, kinds). */
	references?: Array<HandleReference & { role: string }>;
	/** Every reference in the series, for compiling handles before lint (defaults to the scene's). */
	allReferences?: HandleReference[];
}

/** A shot's spoken lines: Notion's, else Fit's. */
const dialogueOf = (card: StoryCard) => card.source?.dialogue ?? card.fit?.dialogue ?? '';

/** What the Agent reads for one scene. Banned words are blacked out everywhere in it. */
export function fitContext(input: FitContext): string {
	const row = input.outline.acts.flatMap((act) => act.scenes).find((scene) => scene.page_id === input.scene.page_id)!;
	const scene = input.series.scenes.find((entry) => entry.page_id === input.scene.page_id)!;
	const detail = (card: StoryCard) => {
		// A Fit shot keeps its details in `fit`; once synced it also has a `source` (its Notion link), so merge field by field.
		const extra = { dialogue: dialogueOf(card), audio: card.source?.audio ?? card.fit?.audio, refs: card.source?.refs ?? card.fit?.refs };
		return [
			`- ${card.title} (${Math.round(card.duration_ms / 1000)} s): ${card.beat}`,
			extra.dialogue ? `  Dialogue: ${extra.dialogue}` : '',
			extra.audio ? `  Audio: ${extra.audio}` : '',
			extra.refs ? `  Refs: ${extra.refs}` : '',
			`  Video prompt: ${card.video_prompt}`
		].filter(Boolean).join('\n');
	};
	const beats = (input.storyBeats ?? []).map((beat) => `- ${beat.title}${beat.section ? ` (${beat.section})` : ''}: ${beat.summary || '—'}`).join('\n');
	const refs = (input.references ?? []).map((ref) => `- ${ref.handles.join(' ') || '(no handle)'} → ${ref.name} (${ref.kind || 'reference'})${ref.role ? ` — ${ref.role}` : ''}`).join('\n');
	const text = [
		input.story ? `THE SEASON STORY (the bible: never contradict it, never reveal its secrets early):\n${input.story}` : '',
		`THIS EPISODE: ${input.series.episode_title}\n${input.series.summary}${input.series.twist ? `\nMid-episode twist: ${input.series.twist}` : ''}${input.series.cliffhanger ? `\nCliffhanger: ${input.series.cliffhanger}` : ''}`,
		`THE EPISODE'S SCENES IN ORDER, shots now against each scene's budget at ${input.target_min} min:\n${input.outline.acts.flatMap((act) => act.scenes.map((s) => `- ${s.title} [${act.act}] ${clockOf(s.shot_s)} of ${clockOf(s.target_s)}`)).join('\n')}`,
		`THE SCENE TO FILL: ${row.title} (${row.act})\nLocation: ${row.location || '—'}\nCharacters: ${row.characters.join(', ') || '—'}\nSummary: ${scene.summary || '—'}`,
		`ACTION (what happens, in order; cover all of it):\n${scene.story_beats || '—'}`,
		`DIALOGUE (the script: every line goes in exactly one shot, verbatim, in this order):\n${scene.dialogue?.trim() || '(none: no one speaks in this scene)'}`,
		`SEASON STORY BEATS THIS SCENE CARRIES (show each one on screen):\n${beats || '(none linked)'}`,
		`REFERENCES (use only these, by @handle; the app writes the exact name and attaches the image):\n${refs || '(none: declare everyone with "No image:")'}`,
		`ITS SHOTS SO FAR, IN ORDER (they stay; yours play after the last one):\n${input.sceneCards.map(detail).join('\n') || '(none yet)'}`,
		input.nextScene ? `THE NEXT SCENE (your last shot leads into it): ${input.nextScene.title}: ${input.nextScene.summary}` : 'This is the episode\'s last scene.'
	].filter(Boolean).join('\n\n');
	return redactAll(text, bannedIn(text, input.banned));
}

const ANSWER_FORMAT = `Answer with only a JSON object, no other text:
{"shots":[{"description":"what we see, one or two sentences","duration_s":6,"dialogue":"the script lines this shot speaks, copied exactly as SPEAKER (delivery): \\"line\\", one per line, or empty","audio":"the sound at this moment","refs":"the @handles it uses","characters":["exact names"],"image_prompt":"the keyframe prompt","video_prompt":"the Seedance prompt"}]}`;

export function fitAsk(input: FitContext): string {
	const { scene } = input;
	return `${fitContext(input)}

THE JOB: this scene has ${clockOf(Math.max(0, scene.gap_s))} too little. Write ${scene.shots_wanted} NEW shots, about ${scene.gap_s} s in total (each ${FIT_SHOT_MIN_S}–${FIT_SHOT_MAX_S} s), that play after the existing shots: cover the ACTION in order, show the season story beats, add reactions, inserts and a breath before the next scene. Never repeat an existing shot. Stay inside this scene: same place, same time, only its characters. Place every DIALOGUE line not already in an existing shot in exactly one new shot, verbatim. Use only the scene's REFERENCES, by @handle.

${ANSWER_FORMAT}`;
}

/** The checklist the Agent holds its own shots against (V1S-329). */
export const SELF_CHECK = [
	'1. The ACTION is covered, all of it, in order.',
	'2. Every DIALOGUE line not already in an existing shot is in exactly one new shot, word for word: in that shot\'s "dialogue" field and quoted in its video prompt. No line is changed, split or invented.',
	'3. Each season story beat this scene carries is shown on screen.',
	'4. Only the scene\'s REFERENCES are used, by @handle; nobody and nothing else from the series appears.'
].join('\n');

/** What the app's own check finds wrong with a scene's new shots (dialogue placement, stray handles). */
export function checkFitShots(input: Pick<FitContext, 'series' | 'scene' | 'sceneCards' | 'references'>, shots: FitShot[]): string[] {
	const scene = input.series.scenes.find((entry) => entry.page_id === input.scene.page_id);
	const titled: ShotForCheck[] = shots.map((shot, i) => ({ title: `New shot ${i + 1}`, dialogue: shot.dialogue, video_prompt: shot.video_prompt }));
	const placed: ShotForCheck[] = input.sceneCards.map((card) => ({ title: card.title, dialogue: dialogueOf(card), video_prompt: card.video_prompt }));
	const allowed = (input.references ?? []).flatMap((ref) => ref.handles);
	// Handles are only checked when the scene lists references; a scene without them declares with "No image:".
	const stray = allowed.length || shots.some((shot) => /@(?!Image[ _]?\d)[A-Za-z]/.test(shot.video_prompt)) ? strayHandles(titled, allowed) : [];
	return sceneProblems(checkDialogue(scene?.dialogue ?? '', titled, placed), stray);
}

/** The Agent reviews its own shots against the checklist and the app's findings, and returns them fixed. */
async function selfCheck(client: AgentModelClient, input: FitContext & { system: string }, shots: FitShot[], problems: string[]): Promise<FitShot[]> {
	const ask = `${fitContext(input)}

YOUR NEW SHOTS:
${JSON.stringify({ shots }, null, 1)}

CHECK YOUR SHOTS AGAINST THIS CHECKLIST and fix every miss:
${SELF_CHECK}

${problems.length ? `THE APP'S CHECK FOUND THESE PROBLEMS (fix all of them):\n${problems.map((problem) => `- ${problem}`).join('\n')}` : 'The app\'s check found no problems with dialogue or references; still check the action and the story beats.'}

Return the corrected shots (all of them, the same format; unchanged ones as they are). ${ANSWER_FORMAT}`;
	return generateStructured(client, { system: input.system, prompt: redactAll(ask, bannedIn(ask, input.banned)), maxOutputTokens: 8000, timeoutMs: 180_000 }, (value) => parseFitShots(value, input.scene));
}

/** A scene whose shots still fail the app's check after the Agent's fixes: nothing is saved for it. */
export class SceneCheckFailed extends Error {
	constructor(readonly problems: string[]) { super(`The scene still fails its check: ${problems.join('; ')}`); }
}

/** Write one scene's new shots, check and fix them, then lint and fix each prompt (in parallel, `concurrency` at a time). */
export async function fitScene(
	client: AgentModelClient,
	input: FitContext & { system: string },
	onShots: (shots: FitShot[]) => void | Promise<void> = () => {},
	onRound: (index: number, round: LintRound) => void | Promise<void> = () => {},
	concurrency = 4,
	onCheck: (round: number, problems: string[]) => void | Promise<void> = () => {},
	maxCheckRounds = 2
): Promise<FittedShot[]> {
	let shots = await generateStructured(client, { system: input.system, prompt: fitAsk(input), maxOutputTokens: 8000, timeoutMs: 180_000 }, (value) => parseFitShots(value, input.scene));
	await onShots(shots);
	// The Agent always checks its own shots once; again only while the app's check still finds problems.
	let problems = checkFitShots(input, shots);
	for (let round = 1; round <= maxCheckRounds && (round === 1 || problems.length); round++) {
		await onCheck(round - 1, problems);
		shots = await selfCheck(client, input, shots, problems);
		problems = checkFitShots(input, shots);
	}
	await onCheck(maxCheckRounds, problems);
	if (problems.length) throw new SceneCheckFailed(problems);

	const context = fitContext(input);
	const all = input.allReferences ?? input.references ?? [];
	const compile = all.length ? (prompt: string) => compileHandles(prompt, all, 'seedance').prompt : undefined;
	const fitted: FittedShot[] = new Array(shots.length);
	let next = 0;
	const worker = async () => {
		for (let i = next++; i < shots.length; i = next++) {
			const shot = shots[i];
			const linted = await lintAndFix(client, { system: input.system, context: `${context}\n\nTHIS SHOT: ${shot.description}`, prompt: shot.video_prompt, banned: input.banned, ignore: ['single-shot'], compile, references: all }, (round) => onRound(i, round));
			const first = linted.rounds[0].issues.length, last = linted.rounds.at(-1)!.issues.length;
			fitted[i] = { ...shot, video_prompt: linted.prompt, lint: { rounds: linted.rounds.length - 1, fixed: Math.max(0, first - last), remaining: last } };
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, shots.length) }, worker));
	return fitted;
}
