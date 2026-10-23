/**
 * Make the prompt skills global on this machine: link each one from this repo into every agent tool's
 * user-level skills folder, so Claude Code, Cursor, OpenCode, Pi and anything reading ~/.agents/skills all
 * read the same copy. A `git pull` here updates them everywhere. Safe to re-run.
 *
 *   bun run skills:global                 link the skills; list stale old copies
 *   bun run skills:global --remove-stale  also delete the stale copies it lists
 *   bun run skills:global --pack          also write upload zips to dist/skills/ (claude.ai, ChatGPT, Grok)
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, rm, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');
const source = join(repoRoot, '.agents', 'skills');

/** The skills that are global: everything else in .agents/skills is for this repo only. */
export const GLOBAL_SKILLS = ['seedance-higgsfield', 'nano-banana-pro', 'seedance-teaser-trailer', 'oneshot-image-prompts', 'live-action-studio'];

/** Old skills these replace. A copy of one anywhere is a second, contradicting rulebook. */
export const STALE_SKILLS = [
	'seedance-2-0-higgsfield',
	'seedance-2-5-higgsfield',
	'seedance-2.5-prompt-format',
	'seedance-director',
	'nano-banana-anamorphic-plates',
	'nano-banana-pro-anamorphic',
];

const home = homedir();
/** Each tool's user-level skills folder, used when that tool is installed (its config folder exists). */
const TOOLS: Array<{ tool: string; config: string; skills: string }> = [
	{ tool: 'Claude Code', config: join(home, '.claude'), skills: join(home, '.claude', 'skills') },
	{ tool: 'Cursor', config: join(home, '.cursor'), skills: join(home, '.cursor', 'skills') },
	{ tool: 'OpenCode', config: join(home, '.config', 'opencode'), skills: join(home, '.config', 'opencode', 'skills') },
	{ tool: 'Pi', config: join(home, '.pi', 'agent'), skills: join(home, '.pi', 'agent', 'skills') },
	{ tool: 'shared (~/.agents)', config: home, skills: join(home, '.agents', 'skills') },
];

const args = new Set(process.argv.slice(2));

async function exists(path: string): Promise<'link' | 'dir' | null> {
	try {
		return (await lstat(path)).isSymbolicLink() ? 'link' : 'dir';
	} catch {
		return null;
	}
}

async function main(): Promise<void> {
	for (const name of GLOBAL_SKILLS) if (!existsSync(join(source, name, 'SKILL.md'))) throw new Error(`missing ${name} in .agents/skills`);
	const stale: string[] = [];
	for (const { tool, config, skills } of TOOLS) {
		if (!existsSync(config)) continue;
		await mkdir(skills, { recursive: true });
		for (const name of GLOBAL_SKILLS) {
			const link = join(skills, name);
			const found = await exists(link);
			if (found === 'dir') {
				// A real folder here is an old copy someone installed by hand: it would shadow the repo's.
				stale.push(link);
				continue;
			}
			if (found === 'link') await rm(link, { recursive: true });
			await symlink(join(source, name), link, process.platform === 'win32' ? 'junction' : 'dir');
		}
		for (const name of STALE_SKILLS) if (await exists(join(skills, name))) stale.push(join(skills, name));
		console.log(`${tool}: ${GLOBAL_SKILLS.length} skills linked in ${skills}`);
	}
	if (stale.length) {
		console.log(`\nStale copies (old rules):\n${stale.map((path) => `  ${path}`).join('\n')}`);
		if (args.has('--remove-stale')) {
			for (const path of stale) await rm(path, { recursive: true, force: true });
			console.log('Removed. Re-run without flags to link the current skills where an old copy stood.');
		} else console.log('Re-run with --remove-stale to delete them.');
	}
	if (args.has('--pack')) {
		const out = join(repoRoot, 'dist', 'skills');
		await mkdir(out, { recursive: true });
		for (const name of GLOBAL_SKILLS) {
			const zip = join(out, `${name}.zip`);
			await rm(zip, { force: true });
			// Each zip holds one top-level folder named after the skill, the shape claude.ai and ChatGPT expect.
			const run = process.platform === 'win32'
				? spawnSync('tar', ['-a', '-c', '-f', zip, name], { cwd: source })
				: spawnSync('zip', ['-qr', zip, name], { cwd: source });
			if (run.status !== 0) throw new Error(`zipping ${name} failed: ${run.stderr}`);
		}
		console.log(`\nUpload zips: ${out}`);
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
