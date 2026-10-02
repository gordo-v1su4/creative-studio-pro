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
export const imagesFor = (image: CharacterImage | null | undefined): ModelImage[] | undefined => (image ? [{ data: image.data, mediaType: image.mediaType }] : undefined);
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

/** Phase two: the picked pitch as a teaser right away (title, logline, hook, Seedance prompt), before linting. */
export async function teaserFor(client: AgentModelClient, project: Source, input: Ground & { target: TeaserTarget; offered: Pitch[]; pick: Pitch }, path?: string): Promise<{ blueprint: TeaserBlueprint; raw: string; system: string; context: string }> {
	const context = `${groundBlock(project, input)}\n\nYOU PITCHED:\n${input.offered.map((pitch, i) => `${i + 1}. ${pitchText(pitch)}`).join('\n')}\n\nTHE OPERATOR PICKS THIS ONE:\n${pitchText(input.pick)}`;
	const system = await masterPrompt(input.target, path);
	const { value, raw } = await askTwice(client, system, `${context}\n\nPHASE TWO: write its teaser now, the four headers exactly.`, (text) => {
		const parsed = parseBlueprint(text);
		return parsed.ok ? { ok: true, value: parsed.blueprint } : parsed;
	}, 4000, imagesOf(input));
	return { blueprint: value, raw, system, context };
}

/** One lint finding on the Seedance prompt, with where it is (for highlighting in the app). */
export interface TeaserIssue { rule: string; severity: 'error' | 'warning'; index: number; length: number; match: string; message: string }
export interface LintRound { round: number; prompt: string; issues: TeaserIssue[] }

const HIDDEN = new Set(['banned-word', 'project-rule']);
/** Black out every banned word (any case) so the Agent never reads one, even inside its own draft. */
function redactAll(text: string, words: string[]): string {
	let out = text;
	for (const word of [...new Set(words.map((w) => w.toLowerCase()))].filter(Boolean)) out = out.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '▇▇▇');
	return out;
}

/** Every finding of the operator's Seedance linter on this prompt (banned words included, with the project's own bans). */
export function lintTeaser(prompt: string, banned: string[]): TeaserIssue[] {
	return lintPrompt(prompt, 'seedance', banned).issues.map((issue) => ({
		rule: issue.rule, severity: issue.severity as TeaserIssue['severity'], index: issue.index,
		length: issue.match === '(whole prompt)' ? 0 : issue.match.length, match: issue.match, message: issue.message
	}));
}

/** The findings as the Agent sees them. Banned words are blacked out everywhere (naming one primes it). */
function issuesForAgent(prompt: string, issues: TeaserIssue[], hidden: string[]): string {
	return issues.map((issue) => {
		const near = redactAll(prompt.slice(Math.max(0, issue.index - 40), issue.index + issue.length + 40).replace(/\s+/g, ' '), hidden);
		if (HIDDEN.has(issue.rule)) return `- [${issue.rule}] a word the operator bans in prompts (blacked out as ▇▇▇), near "${near}": replace it, describing that thing by its color and source.`;
		return `- [${issue.rule}] "${issue.match}" near "${near}": ${issue.message}`;
	}).join('\n');
}

/** The prompt text out of a fix answer: drop a repeated header and any fences. */
function promptOnly(answer: string): string {
	return answer.replace(/^```\w*\n?|```\s*$/g, '').replace(/^\s*(?:\*\*)?SEEDANCE PROMPT\s*:?(?:\*\*)?\s*/i, '').trim();
}

/**
 * The operator's Seedance linter runs on the teaser's prompt; the Agent fixes every finding and it is linted
 * again, up to `maxRounds` fixes. Each round is reported (draft first) so the app can show the highlights live.
 */
export async function lintAndFix(client: AgentModelClient, input: { system: string; context: string; prompt: string; banned: string[]; images?: ModelImage[] }, onRound: (round: LintRound) => void | Promise<void> = () => {}, maxRounds = 3): Promise<{ prompt: string; rounds: LintRound[] }> {
	let prompt = input.prompt;
	const rounds: LintRound[] = [];
	for (let round = 0; ; round++) {
		const issues = lintTeaser(prompt, input.banned);
		const current = { round, prompt, issues };
		rounds.push(current);
		await onRound(current);
		if (issues.length === 0 || round >= maxRounds) return { prompt, rounds };
		const hidden = issues.filter((issue) => HIDDEN.has(issue.rule)).map((issue) => issue.match);
		const ask = `${redactAll(input.context, hidden)}\n\nYOUR SEEDANCE PROMPT:\n${redactAll(prompt, hidden)}\n\nTHE OPERATOR'S PROMPT LINTER FOUND THESE PROBLEMS:\n${issuesForAgent(prompt, issues, hidden)}\n\nRewrite the SEEDANCE PROMPT so every problem is fixed: declare every character and place, then use only the exact declared names. Keep everything else as it is. Return only the corrected SEEDANCE PROMPT text, with no header before it and nothing after it.`;
		const answer = promptOnly(await client.generate({ system: input.system, prompt: ask, images: input.images, maxOutputTokens: 4000, timeoutMs: 120_000 }));
		if (!answer) return { prompt, rounds };
		prompt = answer;
	}
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
