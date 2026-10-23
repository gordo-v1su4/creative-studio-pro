import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lintPrompt, type LintTarget } from '../../src/lib/domain/prompt-lint';

/**
 * The prompt skills are self-contained (they travel to claude.ai, ChatGPT, Cursor…), so each carries a copy of
 * the linter and lint-clean examples. These checks keep the copies identical to the app and the examples clean.
 */
const skills = '.agents/skills';
const app = readFileSync('src/lib/domain/prompt-lint.ts', 'utf8');
const ruleIds = [...new Set([...app.matchAll(/(?:push\(|rule: )'([a-z-]+)'/g)].map((m) => m[1]))];
/** The prompt between an example file's two `---` rules. */
const promptOf = (file: string) => readFileSync(file, 'utf8').split(/^---\s*$/m)[1];

const promptSkills: Array<{ skill: string; target: LintTarget }> = [
	{ skill: 'seedance-higgsfield', target: 'seedance' },
	{ skill: 'nano-banana-pro', target: 'nano_banana' },
	{ skill: 'seedance-teaser-trailer', target: 'seedance' },
];

describe.each(promptSkills)('the $skill skill', ({ skill, target }) => {
	const dir = join(skills, skill);

	test('carries a byte-identical copy of the linter and its runner (bun run skills:sync)', () => {
		expect(readFileSync(join(dir, 'scripts', 'prompt-lint.ts'), 'utf8')).toBe(app);
		expect(readFileSync(join(dir, 'scripts', 'lint-prompt.ts'), 'utf8')).toBe(readFileSync(join(skills, 'seedance-higgsfield', 'scripts', 'lint-prompt.ts'), 'utf8'));
	});

	test('documents every rule the linter can raise', () => {
		const doc = readFileSync(join(dir, 'references', 'lint-rules.md'), 'utf8');
		for (const id of ruleIds) expect(doc).toContain(`\`${id}\``);
	});

	test('every example passes the linter with no errors or warnings', () => {
		const examples = readdirSync(join(dir, 'examples')).filter((file) => file.endsWith('.md'));
		expect(examples.length).toBeGreaterThan(0);
		for (const file of examples) {
			const prompt = promptOf(join(dir, 'examples', file));
			expect(prompt, file).toBeDefined();
			expect(lintPrompt(prompt, target).issues.map((i) => `${file}: ${i.rule} "${i.match}"`)).toEqual([]);
		}
	});
});

test('both Seedance formats carry the same naming rules', () => {
	const naming = (file: string) => readFileSync(join(skills, 'seedance-higgsfield', file), 'utf8').split('Naming rules')[1];
	expect(naming('format-2-0.md')).toBeDefined();
	expect(naming('format-2-0.md')).toBe(naming('format-2-5.md'));
});

test('the teaser skill carries the Seedance formats unchanged (bun run skills:sync)', () => {
	for (const file of ['format-2-0.md', 'format-2-5.md']) {
		expect(readFileSync(join(skills, 'seedance-teaser-trailer', 'references', file), 'utf8')).toBe(readFileSync(join(skills, 'seedance-higgsfield', file), 'utf8'));
	}
});

test('the lint-rules reference is the same in every prompt skill', () => {
	const docs = promptSkills.map(({ skill }) => readFileSync(join(skills, skill, 'references', 'lint-rules.md'), 'utf8'));
	for (const doc of docs) expect(doc).toBe(docs[0]);
});
