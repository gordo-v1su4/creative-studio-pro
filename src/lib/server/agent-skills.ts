import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The Agent's own skills (ADR 0004): the five ONE SHOT Community Edition skills, copied into `agent-skills/`.
 * They are the app's logic for references, image prompts, keyframes, video prompts, fresh ideas and score
 * prompts (ADR 0003). The app's copy is its own: edit it here when the app needs it to change; it is not synced
 * from the Hermes vault.
 */
export const AGENT_SKILLS = ['live-action-studio', 'oneshot-image-prompts', 'ghost', 'fresh-idea-community', 'ghostsuno'] as const;
export type AgentSkill = (typeof AGENT_SKILLS)[number];

export const agentSkillPath = (skill: AgentSkill, file = 'SKILL.md') => join(process.cwd(), 'agent-skills', skill, file);

/** The prompting guide condensed from the CodeOneshot blog: the reasoning behind the skills, read with them. */
export const readPromptingGuide = async () => (await readFile(join(process.cwd(), 'agent-skills', 'PROMPTING-GUIDE.md'), 'utf8')).replace(/\r\n/g, '\n');

/** A skill file without its YAML front matter (the Agent reads the body). */
export async function readAgentSkill(skill: AgentSkill, file = 'SKILL.md'): Promise<string> {
	const text = (await readFile(agentSkillPath(skill, file), 'utf8')).replace(/\r\n/g, '\n');
	return text.startsWith('---\n') ? text.slice(text.indexOf('\n---', 4) + 4).trimStart() : text;
}
