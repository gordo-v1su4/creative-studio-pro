import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Project } from '$lib/domain/schemas';
import { writeBriefSection } from '$lib/domain/brief-rules';
import { generateStructured, type AgentModelClient } from '$lib/server/model-provider';

/** The project's rules file: an existing PROMPT-RULES.md (top level or trailer/), else a new one at the top of files/. */
export async function rulesFilePath(projectRoot: string, projectId: string): Promise<string> {
	for (const candidate of ['PROMPT-RULES.md', join('trailer', 'PROMPT-RULES.md')]) {
		const path = join(projectRoot, projectId, 'files', candidate);
		try { if ((await stat(path)).isFile()) return path; } catch { /* next */ }
	}
	return join(projectRoot, projectId, 'files', 'PROMPT-RULES.md');
}

/** Write the brief's tone and must-nots into the rules file's managed section (V1S-132). */
export async function syncBriefToRules(projectRoot: string, projectId: string, brief: { tone_visual_rules: string; must_nots: string[] }): Promise<string> {
	const path = await rulesFilePath(projectRoot, projectId);
	let text = '';
	try { text = await readFile(path, 'utf8'); } catch { /* new file */ }
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, writeBriefSection(text, { tone: brief.tone_visual_rules, mustNots: brief.must_nots }), 'utf8');
	return path;
}

export interface DraftedBrief {
	title: string;
	logline: string;
	format: { type: string; runtime: string; aspect: string; platform: string };
	tone_visual_rules: string;
	must_haves: string[];
	must_nots: string[];
	success_criteria: string[];
}

const lines = (value: unknown, field: string): string[] => {
	if (!Array.isArray(value) || !value.length || !value.every((v) => typeof v === 'string' && v.trim())) throw new Error(`${field} must be a non-empty list of strings`);
	return value.map((v: string) => v.trim()).slice(0, 12);
};
const text = (value: unknown, field: string): string => {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`);
	return value.trim();
};

/** The Agent drafts the owner brief from the seed, the story so far, the media and the rules file. Nothing is saved. */
export async function draftBrief(client: AgentModelClient, project: Project, rules: string | null): Promise<DraftedBrief> {
	const system = [
		'You are the Agent in Creative Studio Pro. Draft the owner brief for this project: what it is, how it should look and feel, and what it must and must not do.',
		'Base it on the seed, the story so far, the media already on the board and the project rules file. Follow the rules file; never contradict a must-not in it.',
		'Keep it short and concrete. In must_nots, quote any single banned word or phrase in double quotes (e.g. Never write "lens flare") so the prompt linter can enforce it.',
		'Return JSON only: {"title": string, "logline": string, "format": {"type": string, "runtime": string, "aspect": string, "platform": string}, "tone_visual_rules": string, "must_haves": string[], "must_nots": string[], "success_criteria": string[]}.'
	].join('\n');
	const prompt = JSON.stringify({
		seed: { title: project.seed.title, brief: project.seed.brief, focus: project.seed.creative_focus },
		story: { title: project.production.title, logline: project.production.logline, premise: project.production.premise, beats: project.production.cards.slice(0, 40).map((card) => card.title) },
		media: project.production.assets.slice(0, 40).map((asset) => `${asset.kind}: ${asset.name}`),
		current_brief: project.brief_state.versions.at(-1) ?? null,
		rules_file: rules ?? '(none)'
	}, null, 2);
	return generateStructured(client, { system, prompt, maxOutputTokens: 2000 }, (value) => {
		const v = value as Record<string, unknown>;
		const format = (v.format ?? {}) as Record<string, unknown>;
		return {
			title: text(v.title, 'title'), logline: text(v.logline, 'logline'),
			format: { type: text(format.type, 'format.type'), runtime: text(format.runtime, 'format.runtime'), aspect: text(format.aspect, 'format.aspect'), platform: text(format.platform, 'format.platform') },
			tone_visual_rules: text(v.tone_visual_rules, 'tone_visual_rules'),
			must_haves: lines(v.must_haves, 'must_haves'), must_nots: lines(v.must_nots, 'must_nots'), success_criteria: lines(v.success_criteria, 'success_criteria')
		};
	});
}
