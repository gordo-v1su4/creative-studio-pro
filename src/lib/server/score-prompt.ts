import { z } from 'zod';
import type { Project } from '$lib/domain/schemas';
import { cutLength } from '$lib/domain/cuts';
import { generateStructured, type AgentModelClient } from './model-provider';
import { readAgentSkill } from './agent-skills';

/**
 * Score prompt (V1S-378, parked: mainly for trailers): the app's copy of `ghostsuno` turns a finished cut into
 * Suno's three fields (Styles, Lyrics as instrumental section tags, Exclude Styles). Suno has no API, so
 * nothing is sent: the operator copies the boxes. No film, character or artist names reach any field.
 */
export interface ScorePrompt { cue: string; styles: string; lyrics: string; exclude: string; advice: string }

const answer = z.object({
	cue: z.string().trim().min(1).max(300),
	styles: z.string().trim().min(1).max(1000),
	lyrics: z.string().trim().min(1).max(4000),
	exclude: z.string().trim().min(1).max(1000),
	advice: z.string().trim().max(400).default('')
});

/** What GhostSuno reads about the cut: its length and its shots in order, by what happens (no names). */
export function cutBrief(project: Project, cutId: string): string | null {
	const cut = project.production.cuts?.find((entry) => entry.cut_id === cutId);
	if (!cut) return null;
	const cards = new Map(project.production.cards.map((card) => [card.card_id, card]));
	let at = 0;
	const lines = cut.entries.map((entry) => {
		const length = Math.max(0, entry.out_s - entry.in_s);
		const line = `${at.toFixed(1)}–${(at + length).toFixed(1)} s: ${cards.get(entry.card_id)?.beat ?? 'a shot'}`;
		at += length;
		return line;
	});
	return [`CUT: ${cut.name}, ${cutLength(cut).toFixed(1)} s, ${cut.entries.length} shots.`, `THE SHOTS IN ORDER:\n${lines.join('\n')}`].join('\n\n');
}

/** Names of people and references in the project, which must never reach a Suno field. */
const namesIn = (project: Project) => [...new Set((project.series?.scenes ?? []).flatMap((scene) => scene.characters).flatMap((name) => name.split(/\s+/)).filter((word) => /^[A-Z][a-z]{2,}/.test(word)))];

export async function scorePrompt(client: AgentModelClient, project: Project, cutId: string): Promise<ScorePrompt | null> {
	const brief = cutBrief(project, cutId);
	if (!brief) return null;
	const names = namesIn(project);
	const ask = `${brief}\n\nWrite the Suno prompt for this cut, the GhostSuno way. Describe the music only: no film, show, character, artist or song names (never ${names.slice(0, 12).join(', ') || 'any names'}). Answer with only JSON: {"cue":"one line naming the cue (scene, mood, length)","styles":"the STYLES line","lyrics":"the LYRICS: instrumental section tags, each with a short music direction, no sung words","exclude":"the EXCLUDE STYLES comma list","advice":"one line of slider advice, or empty"}`;
	return generateStructured(client, { system: await readAgentSkill('ghostsuno'), prompt: ask, maxOutputTokens: 2000, timeoutMs: 120_000 }, (value) => {
		const out = answer.parse(value);
		const leaked = names.filter((name) => new RegExp(`\\b${name}\\b`).test(`${out.styles}\n${out.lyrics}\n${out.exclude}`));
		if (leaked.length) throw new Error(`names in a Suno field: ${leaked.join(', ')}; describe the music instead`);
		return out;
	});
}
