/**
 * The prompt skills' source of truth is the Hermes vault (`10-Infrastructure/Agent Skills/skills/`), which
 * Syncthing carries to every machine. This repo keeps a copy because the app reads the Seedance formats and the
 * linter at runtime and cloud sessions have no vault. Never edit the copy: edit in the vault, then
 *   bun run skills:sync           copy the vault's skills (and its linter → src/lib/domain/prompt-lint.ts) here
 *   bun run skills:sync --check   only report what differs; exit 1 if anything does
 * The vault is found at ../hermes-notebook-vault, or CSP_VAULT_DIR.
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const vault = process.env.CSP_VAULT_DIR ?? resolve(root, '..', 'hermes-notebook-vault');
const from = join(vault, '10-Infrastructure', 'Agent Skills', 'skills');
const to = join(root, '.agents', 'skills');
const linter = { vault: join(from, 'seedance-higgsfield', 'scripts', 'prompt-lint.ts'), app: join(root, 'src', 'lib', 'domain', 'prompt-lint.ts') };
export const PROMPT_SKILLS = ['seedance-higgsfield', 'nano-banana-pro', 'seedance-teaser-trailer', 'oneshot-image-prompts', 'live-action-studio'];

const files = (dir: string): string[] =>
	existsSync(dir) ? readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)).map((f) => join(name, f)) : [name])) : [];

function differences(): string[] {
	const out: string[] = [];
	for (const skill of PROMPT_SKILLS) {
		const a = files(join(from, skill));
		const b = files(join(to, skill));
		for (const file of new Set([...a, ...b])) {
			const left = join(from, skill, file);
			const right = join(to, skill, file);
			if (!existsSync(left)) out.push(`only here: ${skill}/${file}`);
			else if (!existsSync(right)) out.push(`only in the vault: ${skill}/${file}`);
			else if (!readFileSync(left).equals(readFileSync(right))) out.push(`differs: ${skill}/${file}`);
		}
	}
	if (!readFileSync(linter.vault).equals(readFileSync(linter.app))) out.push(`differs: ${relative(root, linter.app)}`);
	return out;
}

if (!existsSync(from)) {
	console.error(`skills:sync: no vault skills at ${from} (set CSP_VAULT_DIR).`);
	process.exit(2);
}
const before = differences();
if (process.argv.includes('--check')) {
	console.log(before.length ? before.join('\n') : 'skills:sync: in step with the vault.');
	process.exit(before.length ? 1 : 0);
}
for (const skill of PROMPT_SKILLS) {
	rmSync(join(to, skill), { recursive: true, force: true });
	cpSync(join(from, skill), join(to, skill), { recursive: true });
}
cpSync(linter.vault, linter.app);
console.log(before.length ? `skills:sync: copied from the vault —\n${before.join('\n')}` : 'skills:sync: already in step with the vault.');
