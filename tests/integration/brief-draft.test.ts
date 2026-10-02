import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { draftBrief, rulesFilePath, syncBriefToRules } from '../../src/lib/server/brief';
import { bannedTerms } from '../../src/lib/domain/brief-rules';
import type { AgentModelClient } from '../../src/lib/server/model-provider';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const answer = {
	title: 'Blood Rush', logline: 'A crew of students fights through one night.',
	format: { type: 'trailer', runtime: '30s', aspect: '16:9', platform: 'web' },
	tone_visual_rules: 'Wet night streets, full colour.',
	must_haves: ['Kai on the rooftop'], must_nots: ['Never write "glitter"', 'No letterbox'], success_criteria: ['Reads as one place']
};
const fakeAgent = (reply: unknown): AgentModelClient & { prompts: string[] } => {
	const prompts: string[] = [];
	return { choice: { provider: 'custom', model: 'fake' } as AgentModelClient['choice'], prompts, async generate(input) { prompts.push(input.prompt); return JSON.stringify(reply); } };
};

describe('owner brief: Agent draft and the rules file', () => {
	test('the Agent drafts the fields from the seed, story, media and rules; a bad answer is refused', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-brief-')); roots.push(root);
		const gateway = new ProjectCommandGateway(new ProjectStore({ root }));
		const created = await gateway.createProject({ command: 'create_project', title: 'Blood Rush', brief: 'Vampire-free college action trailer', creative_focus: 'full room', created_by: 'gordo' });
		if (!created.ok) throw new Error(created.error.message);
		const agent = fakeAgent(answer);
		const draft = await draftBrief(agent, created.data, '# Rules\n- No black and white');
		expect(draft).toMatchObject({ title: 'Blood Rush', must_nots: ['Never write "glitter"', 'No letterbox'] });
		expect(agent.prompts[0]).toContain('No black and white');
		expect(agent.prompts[0]).toContain('college action trailer');
		await expect(draftBrief(fakeAgent({ ...answer, must_nots: [] }), created.data, null)).rejects.toThrow();
	});

	test('saving writes tone and must-nots into the existing rules file, keeping the rest; quoted words become bans', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-rules-')); roots.push(root);
		await mkdir(join(root, 'p1', 'files', 'trailer'), { recursive: true });
		await writeFile(join(root, 'p1', 'files', 'trailer', 'PROMPT-RULES.md'), '# Trailer rules\n\n- Full colour, 16:9\n');
		const path = await syncBriefToRules(root, 'p1', { tone_visual_rules: answer.tone_visual_rules, must_nots: answer.must_nots });
		expect(path).toBe(await rulesFilePath(root, 'p1'));
		expect(path.endsWith(join('trailer', 'PROMPT-RULES.md'))).toBeTrue();
		const text = await readFile(path, 'utf8');
		expect(text).toContain('- Full colour, 16:9');
		expect(bannedTerms(text)).toEqual(['glitter']);
		// No rules file yet: one is made at the top of files/.
		expect((await syncBriefToRules(root, 'p2', { tone_visual_rules: 't', must_nots: ['n'] })).endsWith(join('p2', 'files', 'PROMPT-RULES.md'))).toBeTrue();
	});
});
