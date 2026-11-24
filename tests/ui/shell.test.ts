import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/routes/+page.svelte', 'utf8');
const css = readFileSync('src/routes/layout.css', 'utf8');
const chat = readFileSync('src/lib/ui/chat/AgentChat.svelte', 'utf8');
const topbar = page.slice(page.indexOf('<div class="topbar'), page.indexOf('<!-- Work area'));

// DESIGN.md hard rules, checked where the shell is written.

test('the top bar draws no borders', () => {
	expect(topbar).not.toMatch(/\bborder(-[a-z]+)?\b(?!-0)/);
});

test('the top bar never clips, so the menus under it stay reachable', () => {
	expect(topbar.slice(0, topbar.indexOf('>'))).not.toContain('overflow');
});

test('shell controls keep their label on one line and hug it', () => {
	const rule = css.slice(css.indexOf('.cp,\n.stage,'));
	expect(rule).toContain('white-space: nowrap');
	expect(rule).toMatch(/height: 20px/);
	expect(rule).toMatch(/\.stage\[aria-current='page'\],\n\.tg\[aria-pressed='true'\] \{\n\tbackground: var\(--color-selected\)/);
});

test('the stages come from the domain list, not from a list in the page', () => {
	expect(topbar).toContain('{#each STAGES as stage');
	expect(page).not.toContain('workspaceTabs');
});

test('the docked Agent waits to be asked before it calls the model', () => {
	expect(chat).toContain('if (open && !docked && loadedVersion !== project.version && !busy) void start(project);');
});
