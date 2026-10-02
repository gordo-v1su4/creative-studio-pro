import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Project, TrailerHouse } from '$lib/domain/schemas';
import { SEEDANCE_TARGETS, fillMasterPrompt, parseBlueprint, parsePitches, parseSection, type Pitch, type TeaserBlueprint, type TeaserTarget } from '$lib/domain/trailer-house';
import type { AgentModelClient, ModelImage } from '$lib/server/model-provider';
import { lintPrompt } from '$lib/domain/prompt-lint';

/** The master prompt lives in the repo (`prompts/trailer-house.md`) so the operator can edit it like a doc. */
export const MASTER_PROMPT_PATH = join(process.cwd(), 'prompts', 'trailer-house.md');

/** Each Seedance model's prompt format lives in its skill, so the app and the skills never disagree. */
export const formatPath = (target: TeaserTarget) => join(process.cwd(), '.agents', 'skills', SEEDANCE_TARGETS[target.model].skill, 'format.md');

export async function masterPrompt(target: TeaserTarget, path = MASTER_PROMPT_PATH): Promise<string> {
	return fillMasterPrompt(await readFile(path, 'utf8'), target, await readFile(formatPath(target), 'utf8'));
}

type Parsed<T> = { ok: true; value: T } | { ok: false; issue: string };

/** Ask once; if the answer breaks the format, say how and ask once more. */
async function askTwice<T>(client: AgentModelClient, system: string, prompt: string, parse: (raw: string) => Parsed<T>, maxOutputTokens: number, images?: ModelImage[]): Promise<{ value: T; raw: string }> {
	let raw = await client.generate({ system, prompt, images, maxOutputTokens, timeoutMs: 120_000 });
	let parsed = parse(raw);
	if (parsed.ok) return { value: parsed.value, raw };
	raw = await client.generate({ system, prompt: `${prompt}\n\nYOUR PREVIOUS ANSWER BROKE THE FORMAT: ${parsed.issue}. Answer again, following the format exactly.`, images, maxOutputTokens, timeoutMs: 120_000 });
	parsed = parse(raw);
	if (parsed.ok) return { value: parsed.value, raw };
	throw new Error(`The Agent's answer broke the format twice (${parsed.issue})`);
}

type Source = Pick<Project, 'seed'>;
/** The main character's reference image, when the operator attached one. */
export type CharacterImage = ModelImage & { name: string };
interface Ground { seeds: string; character: string; image?: CharacterImage | null }
const imagesOf = (ground: Ground): ModelImage[] | undefined => (ground.image ? [{ data: ground.image.data, mediaType: ground.image.mediaType }] : undefined);

/** The operator's seeds and, when given, their main character. */
function groundBlock(project: Source, ground: Ground): string {
	const own = ground.seeds.trim();
	const fallback = [project.seed.title, project.seed.brief].map((part) => part.trim()).filter(Boolean).join('\n');
	const seeds = `OPERATOR'S SEEDS (words, images, fragments, ideas; build from these):\n${own || fallback || '(none given: invent freely)'}`;
	const who = ground.character.trim() ? `\n\nOPERATOR'S MAIN CHARACTER (use exactly as described):\n${ground.character.trim()}` : '';
	const look = ground.image ? `\n\nTHE ATTACHED IMAGE (${ground.image.name}) IS THE MAIN CHARACTER'S REFERENCE: that is how they look. Refer to them by role and name and as the character in the reference image; never describe their face, hair, body or clothing in words.` : '';
	return `${seeds}${who}${look}`;
}

const pitchText = (pitch: Pitch) => `${pitch.logline}\n   ${pitch.description}`;

/** Phase one: three pitches, steering clear of every logline already offered for the same seeds. */
export async function pitchThree(client: AgentModelClient, project: Source, input: Ground & { target: TeaserTarget; earlier: string[] }, path?: string): Promise<{ pitches: Pitch[]; raw: string }> {
	const avoid = input.earlier.length ? `\n\nALREADY OFFERED AND PASSED ON. Do not repeat, rephrase or lightly vary these; find different protagonists, threats and objectives:\n${input.earlier.map((logline) => `- ${logline}`).join('\n')}` : '';
	const prompt = `PHASE ONE: three pitches, please. Return exactly three numbered pitches, each with LOGLINE: and DESCRIPTION:, and nothing else.\n\n${groundBlock(project, input)}${avoid}`;
	const { value, raw } = await askTwice(client, await masterPrompt(input.target, path), prompt, (text) => {
		const parsed = parsePitches(text);
		return parsed.ok ? { ok: true, value: parsed.pitches } : parsed;
	}, 2000, imagesOf(input));
	return { pitches: value, raw };
}

/** Phase two: the picked pitch as a teaser right away (title, logline, hook, Seedance prompt). */
export async function teaserFor(client: AgentModelClient, project: Source, input: Ground & { target: TeaserTarget; offered: Pitch[]; pick: Pitch; banned?: string[] }, path?: string): Promise<{ blueprint: TeaserBlueprint; raw: string }> {
	const prompt = `${groundBlock(project, input)}\n\nYOU PITCHED:\n${input.offered.map((pitch, i) => `${i + 1}. ${pitchText(pitch)}`).join('\n')}\n\nTHE OPERATOR PICKS THIS ONE:\n${pitchText(input.pick)}\n\nPHASE TWO: write its teaser now, the four headers exactly.`;
	const { value, raw } = await askTwice(client, await masterPrompt(input.target, path), prompt, (text) => {
		const parsed = parseBlueprint(text);
		if (!parsed.ok) return parsed;
		const broken = teaserLintIssue(parsed.blueprint.seedance_prompt, input.banned ?? []);
		return broken ? { ok: false, issue: broken } : { ok: true, value: parsed.blueprint };
	}, 4000, imagesOf(input));
	return { blueprint: value, raw };
}

/**
 * The teaser's Seedance prompt must pass the operator's Seedance linter on banned words and the
 * reference syntax. The message never repeats a banned word back to the Agent (naming it primes it).
 */
export function teaserLintIssue(prompt: string, banned: string[]): string | null {
	const issues = lintPrompt(prompt, 'seedance', banned).issues;
	if (issues.some((issue) => issue.rule === 'banned-word' || issue.rule === 'project-rule')) return 'the SEEDANCE PROMPT uses a word the operator bans in prompts; describe that light or thing by its color and source instead, and rewrite only what is needed';
	if (issues.some((issue) => issue.rule === 'seedance-underscore')) return 'write references as @Image_1 with an underscore, never "@Image 1"';
	return null;
}

export type ContinueStep = 'characters' | 'outline';
const STEP = {
	characters: { header: 'CHARACTERS', ask: 'PHASE THREE: MAIN CHARACTER AND RELATIONSHIPS. Return the header CHARACTERS: once, then the protagonist and two to four key relationships.' },
	outline: { header: 'OUTLINE', ask: 'PHASE THREE: PLOT OUTLINE. Return the header OUTLINE: once, then the numbered three-act beat outline.' }
} as const;

/** Phase three, when the operator continues: the cast and relationships, or the plot outline, grounded in the teaser. */
export async function continueWith(client: AgentModelClient, project: Source, house: TrailerHouse, step: ContinueStep, path?: string, image?: CharacterImage | null): Promise<string> {
	const bp = house.blueprint;
	if (!bp) throw new Error('Write the teaser first');
	const cast = step === 'outline' && house.characters ? `\n\nCHARACTERS SO FAR:\n${house.characters.text}` : '';
	const prompt = `${groundBlock(project, { ...house, image })}\n\nTHE TEASER SO FAR:\nTITLE: ${bp.title}\nLOGLINE: ${bp.logline}\nHOOK: ${bp.hook}\nSEEDANCE PROMPT:\n${bp.seedance_prompt}${cast}\n\n${STEP[step].ask}`;
	const { value } = await askTwice(client, await masterPrompt(house.target, path), prompt, (text) => {
		const parsed = parseSection(text, STEP[step].header);
		return parsed.ok ? { ok: true, value: parsed.text } : parsed;
	}, 3500, image ? [{ data: image.data, mediaType: image.mediaType }] : undefined);
	return value;
}

/** Loglines already offered for these exact seeds, so "three more" brings new ones. */
export function offeredFor(house: TrailerHouse | null, seeds: string): string[] {
	return (house?.rounds ?? []).filter((round) => round.seeds.trim() === seeds.trim()).flatMap((round) => round.pitches.map((pitch) => pitch.logline));
}
