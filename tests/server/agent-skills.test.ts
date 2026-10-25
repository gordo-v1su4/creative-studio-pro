import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { AGENT_SKILLS, agentSkillPath, readAgentSkill } from '../../src/lib/server/agent-skills';

describe('the Agent reads its own copy of the ONE SHOT skills (ADR 0004)', () => {
	test.each([...AGENT_SKILLS])('%s is in agent-skills/ and reads without its front matter', async (skill) => {
		expect(existsSync(agentSkillPath(skill))).toBeTrue();
		const body = await readAgentSkill(skill);
		expect(body.startsWith('---')).toBeFalse();
		expect(body.length).toBeGreaterThan(500);
	});

	test('the image skill carries its templates, with the straight-on first panel', async () => {
		const templates = await readAgentSkill('oneshot-image-prompts', 'references/templates.md');
		expect(templates).toContain('W3 — LOCATION REFERENCE SHEET');
		expect(templates).toMatch(/PANEL LEFT: tight close-up of the head[\s\S]*straight-on, face square to the camera/);
	});

	test('the old vault-synced copies of the two image skills are gone from .agents/skills', () => {
		expect(existsSync('.agents/skills/oneshot-image-prompts')).toBeFalse();
		expect(existsSync('.agents/skills/live-action-studio')).toBeFalse();
	});
});
