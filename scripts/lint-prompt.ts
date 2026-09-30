// Usage: bun scripts/lint-prompt.ts <prompt-file> [--target nano_banana|seedance]
// Exits 1 when any error-level issue is found.
import { lintPrompt, type LintTarget } from '../src/lib/domain/prompt-lint';

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith('--'));
const targetFlag = args.indexOf('--target');
const target = (targetFlag >= 0 ? args[targetFlag + 1] : 'nano_banana') as LintTarget;
if (!file) {
	console.error('usage: bun scripts/lint-prompt.ts <prompt-file> [--target nano_banana|seedance]');
	process.exit(2);
}

const { declarations, issues } = lintPrompt(await Bun.file(file).text(), target);
console.log(`Declared (${declarations.length}):`);
for (const d of declarations) console.log(`  ${d.image === null ? 'no image' : `Image ${d.image}`} → ${d.name}`);
const errors = issues.filter((i) => i.severity === 'error');
console.log(`\n${errors.length} error(s), ${issues.length - errors.length} warning(s)`);
for (const i of issues) console.log(`  ${i.severity === 'error' ? '✗' : '!'} [${i.rule}] "${i.match}" — ${i.message}\n      ${i.context}`);
process.exit(errors.length > 0 ? 1 : 0);
