import type { Project, TrailerHouse, Voice } from '$lib/domain/schemas';
/**
 * Trailer House: the start of a project. The Agent (Kimi) reads the operator's
 * idea with the master prompt in `prompts/trailer-house.md`, pitches three
 * loglines, and after the operator picks one, returns a title, logline, hook
 * and a time-coded Seedance teaser prompt. Seedance 2.0 and 2.5 are both
 * targets; each has its own length and aspect-ratio limits.
 */

export const SEEDANCE_TARGETS = {
	'seedance-2.0': {
		label: 'Seedance 2.0',
		/** `.agents/skills/<skill>/format.md` is the prompt format the Agent writes in. */
		skill: 'seedance-2-0-higgsfield',
		min_s: 4,
		max_s: 15,
		aspects: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
		notes: 'Seedance 2.0 renders 4 to 15 seconds per generation, so the whole teaser must land inside one short clip.'
	},
	'seedance-2.5': {
		label: 'Seedance 2.5',
		skill: 'seedance-2-5-higgsfield',
		min_s: 4,
		max_s: 30,
		aspects: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'],
		notes: 'Seedance 2.5 renders 4 to 30 seconds per generation, so a longer arc fits in one render.'
	}
} as const;

export type SeedanceTarget = keyof typeof SEEDANCE_TARGETS;
export const SEEDANCE_TARGET_IDS = Object.keys(SEEDANCE_TARGETS) as SeedanceTarget[];

export interface TeaserTarget { model: SeedanceTarget; seconds: number; aspect: string }
export const DEFAULT_TARGET: TeaserTarget = { model: 'seedance-2.5', seconds: 12, aspect: '16:9' };

/** A target the chosen model can actually render; otherwise why not. */
export function checkTarget(target: TeaserTarget): { ok: true } | { ok: false; message: string } {
	const spec = SEEDANCE_TARGETS[target.model];
	if (!spec) return { ok: false, message: `Unknown video model ${target.model}` };
	if (!Number.isInteger(target.seconds) || target.seconds < spec.min_s || target.seconds > spec.max_s) {
		return { ok: false, message: `${spec.label} renders ${spec.min_s}–${spec.max_s} seconds; ${target.seconds} s won't fit` };
	}
	if (!(spec.aspects as readonly string[]).includes(target.aspect)) return { ok: false, message: `${spec.label} has no ${target.aspect} aspect ratio` };
	return { ok: true };
}

/**
 * The master prompt's instructions (everything after the first `---` line), with the target filled in
 * and the chosen model's prompt format (its skill's `format.md`) in place of `{{FORMAT}}`.
 */
export function fillMasterPrompt(file: string, target: TeaserTarget, format = ''): string {
	const body = file.split(/^---\s*$/m).slice(1).join('---').trim() || file.trim();
	const spec = SEEDANCE_TARGETS[target.model];
	return body
		// The format first, so its own {{SECONDS}} and {{ASPECT}} are filled too.
		.replaceAll('{{FORMAT}}', format.trim())
		.replaceAll('{{MODEL_NOTES}}', spec.notes)
		.replaceAll('{{SKILL}}', spec.skill)
		.replaceAll('{{MODEL}}', spec.label)
		.replaceAll('{{SECONDS}}', String(target.seconds))
		.replaceAll('{{ASPECT}}', target.aspect);
}

export interface Pitch { logline: string; description: string }

const unquote = (text: string) => text.replace(/\*\*/g, '').replace(/^["“]|["”]$/g, '').trim();
const sentences = (text: string) => (text.match(/[.!?](\s|$)/g) ?? []).length;

/**
 * Phase one: exactly three numbered pitches, each a one-sentence LOGLINE and a short
 * DESCRIPTION. Unlabelled entries are read as logline (first sentence) + description (the rest).
 */
export function parsePitches(raw: string): { ok: true; pitches: Pitch[] } | { ok: false; issue: string } {
	const entries: string[] = [];
	for (const line of raw.replace(/\r/g, '').split('\n')) {
		const numbered = line.match(/^\s*(?:\*\*)?([1-9])[.)](?:\*\*)?\s*(.*)$/);
		if (numbered) entries.push(numbered[2]);
		else if (entries.length) entries[entries.length - 1] += `\n${line}`;
	}
	if (entries.length !== 3) return { ok: false, issue: `Expected exactly three numbered pitches, got ${entries.length}` };
	const pitches: Pitch[] = [];
	for (const [i, entry] of entries.entries()) {
		const labelled = entry.match(/LOGLINE\s*:?\**\s*:?([\s\S]*?)\n\s*(?:\*\*)?DESCRIPTION\s*:?\**\s*:?([\s\S]*)/i);
		let logline: string, description: string;
		if (labelled) {
			logline = unquote(labelled[1].replace(/\s+/g, ' '));
			description = unquote(labelled[2].replace(/\s+/g, ' '));
		} else {
			const flat = unquote(entry.replace(/^\s*(?:\*\*)?LOGLINE\s*:?(?:\*\*)?/i, '').replace(/\s+/g, ' '));
			const cut = flat.search(/[.!?](\s|$)/);
			logline = cut >= 0 ? flat.slice(0, cut + 1).trim() : flat;
			description = cut >= 0 ? flat.slice(cut + 1).trim() : '';
		}
		if (!logline) return { ok: false, issue: `Pitch ${i + 1} has no logline` };
		if (sentences(logline) > 1) return { ok: false, issue: `Pitch ${i + 1}: the logline is more than one sentence` };
		if (!description) return { ok: false, issue: `Pitch ${i + 1} has no description` };
		pitches.push({ logline, description });
	}
	return { ok: true, pitches };
}

/** Phase three: one header (CHARACTERS or OUTLINE) and its content. */
export function parseSection(raw: string, header: 'CHARACTERS' | 'OUTLINE'): { ok: true; text: string } | { ok: false; issue: string } {
	const text = raw.replace(/\r/g, '').replace(/^```\w*\n?|```\s*$/g, '');
	const matches = [...text.matchAll(new RegExp(`^\\s*(?:\\*\\*|#+\\s*)?${header}\\s*:?(?:\\*\\*)?:?`, 'gm'))];
	if (matches.length !== 1) return { ok: false, issue: matches.length ? `${header}: appears more than once` : `${header}: is missing` };
	const content = text.slice(matches[0].index! + matches[0][0].length).trim();
	return content ? { ok: true, text: content } : { ok: false, issue: `${header}: is empty` };
}

export interface TeaserBlueprint { title: string; logline: string; hook: string; seedance_prompt: string }
const HEADERS = [['title', 'TITLE'], ['logline', 'LOGLINE'], ['hook', 'HOOK'], ['seedance_prompt', 'SEEDANCE PROMPT']] as const;

/** Phase two: the four headers once each, in order, each with content. */
export function parseBlueprint(raw: string): { ok: true; blueprint: TeaserBlueprint } | { ok: false; issue: string } {
	const text = raw.replace(/\r/g, '').replace(/^```\w*\n?|```\s*$/g, '');
	const found = HEADERS.map(([, header]) => {
		const matches = [...text.matchAll(new RegExp(`^\\s*(?:\\*\\*|#+\\s*)?${header}(?:\\s*-[^:\\n]*)?:?(?:\\*\\*)?:?`, 'gm'))];
		return { header, matches };
	});
	const missing = found.find((entry) => entry.matches.length !== 1);
	if (missing) return { ok: false, issue: missing.matches.length ? `${missing.header}: appears more than once` : `${missing.header}: is missing` };
	const starts = found.map((entry) => entry.matches[0].index!);
	if (starts.some((start, i) => i > 0 && start <= starts[i - 1])) return { ok: false, issue: 'The four headers are out of order' };
	const blueprint = {} as TeaserBlueprint;
	for (const [i, [key]] of HEADERS.entries()) {
		const from = starts[i] + found[i].matches[0][0].length;
		const content = text.slice(from, starts[i + 1] ?? text.length).trim();
		if (!content) return { ok: false, issue: `${HEADERS[i][1]}: is empty` };
		blueprint[key] = content;
	}
	return { ok: true, blueprint };
}

/** The voice a finished blueprint becomes: the story build reads it like any Creative Room voice. */
export const TRAILER_HOUSE_AGENT = 'Kimi · Trailer House';

/**
 * Save the Trailer House state. A blueprint is also the project's lead voice (replacing an
 * earlier Trailer House voice), so "Build story" grows its six beats from it; clearing the
 * blueprint removes that voice.
 */
export function applyTrailerHouse(project: Project, next: TrailerHouse, voiceId: string, contentHash: (text: string) => string): Project {
	const others = project.voices.filter((voice) => voice.raycast_agent !== TRAILER_HOUSE_AGENT);
	const blueprint = next.blueprint;
	const voice: Voice | null = blueprint ? {
		voice_id: voiceId, label: 'Trailer House', raycast_agent: TRAILER_HOUSE_AGENT, provider: 'kimi',
		job_status: 'succeeded', parse_status: 'valid', raw_text: blueprint.raw, parse_errors: [],
		content_hash: contentHash(blueprint.raw), prompt_hash: null, answer_id: null,
		title: blueprint.title, logline: blueprint.logline, summary: blueprint.hook, error: null
	} : null;
	return { ...project, trailer_house: next, voices: voice ? [voice, ...others] : others };
}
