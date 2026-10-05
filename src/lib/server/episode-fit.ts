import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Project, StoryCard } from '$lib/domain/schemas';
import { clockOf, type EpisodeOutline } from '$lib/domain/episode-outline';
import { FIT_SHOT_MAX_S, FIT_SHOT_MIN_S, parseFitShots, type FitScene, type FitShot, type FittedShot } from '$lib/domain/episode-fit';
import { generateStructured, type AgentModelClient } from '$lib/server/model-provider';
import { lintAndFix, lintTeaser, redactAll, type LintRound } from '$lib/server/trailer-house';

/**
 * Fit to length, the Agent's side: for one scene, write the new shots (one answer, JSON), then put every
 * shot's Seedance prompt through the operator's linter and let the Agent fix it (`lintAndFix`, shots in
 * parallel). The naming rules come from the Seedance 2.5 skill, so the app and the skill never disagree.
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
		'- First the declarations, one per line: "@Image_1 = <exact full name> — definitive identity lock" for each reference image the shot uses, numbered in the order its refs list them; "No image: <exact name> — <one fixed line>" for every other character and place in the shot.',
		'- Then one short paragraph in shot order: framing and angle, the camera move, one concrete action, the light. "Cut to …" before any hard cut inside the shot. Each sound at the moment it happens, as its own short sentence.',
		'- Dialogue, if any, as its own block: one line "<SPEAKER NAME>, <where they are or who they speak to>, <delivery>:" and the words in quotes on the next line.',
		'- End with: "Speak only the scripted lines, verbatim. No subtitles. No on-screen text."',
		'',
		await namingRules(path),
		'',
		'Its IMAGE PROMPT is the 16:9 keyframe for the same shot, in the style of the scene\'s existing image prompts (cite reference images as "Image 1", never with @).'
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
}

/** What the Agent reads for one scene. Banned words are blacked out everywhere in it. */
export function fitContext(input: FitContext): string {
	const row = input.outline.acts.flatMap((act) => act.scenes).find((scene) => scene.page_id === input.scene.page_id)!;
	const scene = input.series.scenes.find((entry) => entry.page_id === input.scene.page_id)!;
	const detail = (card: StoryCard) => {
		const extra = card.source ?? card.fit;
		return [
			`- ${card.title} (${Math.round(card.duration_ms / 1000)} s): ${card.beat}`,
			extra?.dialogue ? `  Dialogue: ${extra.dialogue}` : '',
			extra?.audio ? `  Audio: ${extra.audio}` : '',
			extra?.refs ? `  Refs: ${extra.refs}` : '',
			`  Video prompt: ${card.video_prompt}`
		].filter(Boolean).join('\n');
	};
	const text = [
		input.story ? `THE SEASON STORY (the bible: never contradict it, never reveal its secrets early):\n${input.story}` : '',
		`THIS EPISODE: ${input.series.episode_title}\n${input.series.summary}${input.series.twist ? `\nMid-episode twist: ${input.series.twist}` : ''}${input.series.cliffhanger ? `\nCliffhanger: ${input.series.cliffhanger}` : ''}`,
		`THE EPISODE'S SCENES IN ORDER, shots now against each scene's budget at ${input.target_min} min:\n${input.outline.acts.flatMap((act) => act.scenes.map((s) => `- ${s.title} [${act.act}] ${clockOf(s.shot_s)} of ${clockOf(s.target_s)}`)).join('\n')}`,
		`THE SCENE TO FILL: ${row.title} (${row.act})\nLocation: ${row.location || '—'}\nCharacters: ${row.characters.join(', ') || '—'}\nSummary: ${scene.summary || '—'}\nStory beats:\n${scene.story_beats || '—'}`,
		`ITS SHOTS SO FAR, IN ORDER (they stay; yours play after the last one):\n${input.sceneCards.map(detail).join('\n') || '(none yet)'}`,
		input.nextScene ? `THE NEXT SCENE (your last shot leads into it): ${input.nextScene.title}: ${input.nextScene.summary}` : 'This is the episode\'s last scene.'
	].filter(Boolean).join('\n\n');
	return redactAll(text, bannedIn(text, input.banned));
}

export function fitAsk(input: FitContext): string {
	const { scene } = input;
	return `${fitContext(input)}

THE JOB: this scene has ${clockOf(Math.max(0, scene.gap_s))} too little. Write ${scene.shots_wanted} NEW shots, about ${scene.gap_s} s in total (each ${FIT_SHOT_MIN_S}–${FIT_SHOT_MAX_S} s), that play after the existing shots: coverage of story beats the existing shots skip, reactions, inserts, a breath before the next scene. Never repeat an existing shot. Stay inside this scene: same place, same time, only its characters, called by the exact names the existing shots use. Reuse the existing shots' reference images (their refs) the same way.

Answer with only a JSON object, no other text:
{"shots":[{"description":"what we see, one or two sentences","duration_s":6,"dialogue":"","audio":"the sound at this moment","refs":"the reference images it needs, written like the existing refs","characters":["exact names"],"image_prompt":"the keyframe prompt","video_prompt":"the Seedance prompt"}]}`;
}

/** Write one scene's new shots, then lint and fix each prompt (in parallel, `concurrency` at a time). */
export async function fitScene(
	client: AgentModelClient,
	input: FitContext & { system: string },
	onShots: (shots: FitShot[]) => void | Promise<void> = () => {},
	onRound: (index: number, round: LintRound) => void | Promise<void> = () => {},
	concurrency = 4
): Promise<FittedShot[]> {
	const shots = await generateStructured(client, { system: input.system, prompt: fitAsk(input), maxOutputTokens: 8000, timeoutMs: 180_000 }, (value) => parseFitShots(value, input.scene));
	await onShots(shots);
	const context = fitContext(input);
	const fitted: FittedShot[] = new Array(shots.length);
	let next = 0;
	const worker = async () => {
		for (let i = next++; i < shots.length; i = next++) {
			const shot = shots[i];
			const linted = await lintAndFix(client, { system: input.system, context: `${context}\n\nTHIS SHOT: ${shot.description}`, prompt: shot.video_prompt, banned: input.banned, ignore: ['single-shot'] }, (round) => onRound(i, round));
			const first = linted.rounds[0].issues.length, last = linted.rounds.at(-1)!.issues.length;
			fitted[i] = { ...shot, video_prompt: linted.prompt, lint: { rounds: linted.rounds.length - 1, fixed: Math.max(0, first - last), remaining: last } };
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, shots.length) }, worker));
	return fitted;
}
