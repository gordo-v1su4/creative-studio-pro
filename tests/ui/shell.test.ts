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

// Slice 3 (ADR 0008): Review Room keeps in step without a button.
const pageSource = readFileSync('src/routes/+page.svelte', 'utf8');
const workspaceSource = readFileSync('src/lib/ui/ProductionWorkspace.svelte', 'utf8');

test('there is no sync button on the Shots grid; a check runs on a timer and on coming back to the window', () => {
	expect(workspaceSource).not.toContain('Sync reviews');
	expect(workspaceSource).not.toContain("action: 'pull'");
	expect(pageSource).toContain("body: JSON.stringify({ action: 'pull' })");
	expect(pageSource).toContain("window.addEventListener('focus', back);");
	expect(pageSource).toContain("document.addEventListener('visibilitychange', back);");
	expect(pageSource).toContain('if (due({ connected: true, visible: document.visibilityState ===');
});

test("the check never holds up the operator's own requests, and a collision is retried once", () => {
	const check = pageSource.slice(pageSource.indexOf('function checkRoom()'), pageSource.indexOf('const roomProjectId'));
	expect(check).not.toContain('takeQueue');
	expect(check).toContain('if (body.data.version > activeProject.version)');
	expect(pageSource).toContain("result.error.code === 'VERSION_CONFLICT'");
});

test('unsaved edits survive an arriving change, and a review that could not be sent is kept and shown', () => {
	expect(workspaceSource).toContain('mergeProduction(loadedProduction!, draft, incoming)');
	expect(workspaceSource).toContain('await roomState.send(project,');
	expect(workspaceSource).toContain("text: 'Not sent', tone: 'bad'");
	expect(pageSource).toContain('for (const entry of [...roomState.outbox])');
});
