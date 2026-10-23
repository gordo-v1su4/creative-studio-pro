/**
 * The prompt skills are self-contained (they travel to claude.ai, ChatGPT, Cursor…), so each carries copies of
 * the shared files. One source each; this copies them out. tests/domain/skills-sync.test.ts fails on drift.
 * Run after changing the linter, the lint rules or a Seedance format: `bun run skills:sync`.
 */
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

const copies: Array<[from: string, to: string[]]> = [
	['src/lib/domain/prompt-lint.ts', ['seedance-higgsfield', 'nano-banana-pro', 'seedance-teaser-trailer'].map((skill) => `.agents/skills/${skill}/scripts/prompt-lint.ts`)],
	['.agents/skills/seedance-higgsfield/scripts/lint-prompt.ts', ['nano-banana-pro', 'seedance-teaser-trailer'].map((skill) => `.agents/skills/${skill}/scripts/lint-prompt.ts`)],
	['.agents/skills/seedance-higgsfield/references/lint-rules.md', ['nano-banana-pro', 'seedance-teaser-trailer'].map((skill) => `.agents/skills/${skill}/references/lint-rules.md`)],
	['.agents/skills/seedance-higgsfield/format-2-0.md', ['.agents/skills/seedance-teaser-trailer/references/format-2-0.md']],
	['.agents/skills/seedance-higgsfield/format-2-5.md', ['.agents/skills/seedance-teaser-trailer/references/format-2-5.md']],
];

for (const [from, targets] of copies) {
	for (const to of targets) await copyFile(join(root, from), join(root, to));
	console.log(`${from} → ${targets.length} cop${targets.length === 1 ? 'y' : 'ies'}`);
}
