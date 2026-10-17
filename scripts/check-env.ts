/**
 * Env check (docs/planning/series-production-v3.md, Q24): every env variable the code reads must be listed
 * in .env.example, and every secret-like one (KEY / TOKEN / PIN / SECRET / PASSWORD) must appear in the
 * Hermes vault note's env-name → BWS-name table. Names only; values are never read. Runs as a git
 * pre-commit hook and as a Claude Code Stop hook. Exit 1 lists what is missing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const SCAN = ['src', 'scripts', 'trigger'];
/** Set by the OS or the host, never by us. */
const PLATFORM = new Set(['APPDATA', 'VERCEL', 'NODE_ENV', 'HOME', 'PATH', 'USERPROFILE', 'CI']);
const SECRET = /(KEY|TOKEN|PIN|SECRET|PASSWORD)$/;
const VAULT_NOTE = process.env.CSP_VAULT_NOTE ?? resolve(root, '..', 'hermes-notebook-vault', '04-Projects', 'Creative Studio Pro', 'README.md');

function files(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (name === 'node_modules' || name.startsWith('.')) return [];
		return statSync(path).isDirectory() ? files(path) : /\.(ts|js|svelte)$/.test(name) ? [path] : [];
	});
}

/** Env names the code reads: `env.X` from $env/*, and `process.env.X`. */
export function namesInCode(source: string): string[] {
	const names = new Set<string>();
	const usesSvelteEnv = /\$env\/(static|dynamic)\/(private|public)/.test(source);
	for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) names.add(match[1]);
	if (usesSvelteEnv) for (const match of source.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)) names.add(match[1]);
	for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]\$env\/static\/(?:private|public)['"]/g))
		for (const name of match[1].split(',').map((part) => part.trim())) if (/^[A-Z][A-Z0-9_]+$/.test(name)) names.add(name);
	return [...names];
}

const namesIn = (text: string, pattern: RegExp) => new Set([...text.matchAll(pattern)].map((match) => match[1]));

const used = new Map<string, string>();
for (const dir of SCAN) for (const file of files(join(root, dir)))
	for (const name of namesInCode(readFileSync(file, 'utf8'))) if (!PLATFORM.has(name) && !used.has(name)) used.set(name, file.slice(root.length + 1));

const example = namesIn(readFileSync(join(root, '.env.example'), 'utf8'), /^([A-Z][A-Z0-9_]+)=/gm);
const problems: string[] = [];
for (const [name, file] of used) if (!example.has(name)) problems.push(`${name} (read in ${file}) is missing from .env.example`);

if (existsSync(VAULT_NOTE)) {
	const vault = namesIn(readFileSync(VAULT_NOTE, 'utf8'), /`([A-Z][A-Z0-9_]+)`/g);
	for (const name of used.keys()) if (SECRET.test(name) && !vault.has(name)) problems.push(`${name} is a secret but is not in the vault note's env → BWS table (${VAULT_NOTE})`);
} else {
	console.warn(`check:env: vault note not found at ${VAULT_NOTE}; skipped the BWS-table check (set CSP_VAULT_NOTE to point at it).`);
}

if (problems.length) {
	console.error('check:env failed. Document each variable: value in BWS hermes_keys + .env.local, name in .env.example, the env → BWS row in the vault note, the full entry in proxmox-home.');
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}
console.log(`check:env ok: ${used.size} variables documented.`);
