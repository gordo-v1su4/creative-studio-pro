/**
 * Lint a prompt file with the operator's linter (./prompt-lint.ts, the same file Creative Studio Pro's
 * app runs; its source is the Hermes vault). Runs on bun or node 22.18+, no install.
 *   lint-prompt.ts <file> [--target seedance|nano_banana] [--pack blood-rush] [--ban "word"]…
 * A Markdown example file is linted between its two `---` rules. Exit code 1 on any error.
 */
import { readFileSync } from 'node:fs';
import { lintPrompt, type LintTarget } from './prompt-lint.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.flatMap((arg, i) => (arg === `--${name}` && args[i + 1] ? [args[i + 1]] : []));
const file = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!file) {
	console.error('usage: lint-prompt.ts <file> [--target seedance|nano_banana] [--pack <id>] [--ban "word"]');
	process.exit(2);
}
const target = (flag('target')[0] ?? 'seedance') as LintTarget;
const banned = [...flag('pack').map((id) => `pack:${id}`), ...flag('ban')];

let text = readFileSync(file, 'utf8');
const parts = text.split(/^---\s*$/m);
if (file.endsWith('.md') && parts.length >= 3) text = parts[1];

const { declarations, issues } = lintPrompt(text, target, banned);
console.log(`declared: ${declarations.map((d) => (d.image === null ? d.name : `Image ${d.image} = ${d.name}`)).join(' | ') || '(nothing)'}`);
for (const issue of issues) console.log(`${issue.severity} ${issue.rule}: "${issue.match}" — ${issue.message}\n    …${issue.context}`);
const errors = issues.filter((issue) => issue.severity === 'error').length;
console.log(`${errors} error${errors === 1 ? '' : 's'}, ${issues.length - errors} warning${issues.length - errors === 1 ? '' : 's'}`);
process.exit(errors ? 1 : 0);
