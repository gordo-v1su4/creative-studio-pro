import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const plan = read('src/lib/ui/StoryPlan.svelte');
const outline = read('src/lib/ui/shell/Outline.svelte');

test('the story plan says which names will lock before the approve button is pressed (story 16)', () => {
	// The line under the bar carries the notice whenever the open level can be approved, and the button repeats it.
	expect(plan).toContain('<b>Names lock on approve</b> · {lockNotice(level)}');
	expect(plan).toContain('title={allowed.ok ? lockNotice(level) : allowed.why}');
	// A level that cannot be approved yet says why in the same place.
	expect(plan).toContain('{:else if !allowed.ok}{allowed.why}');
});

test('a fixed code is shown, never offered as a field', () => {
	expect(plan).toMatch(/\{#if sceneCodeFixed\(scene\)\}<span class="kept"/);
	expect(plan).toMatch(/\{#if codesFixed\}<span class="kept">\{codes\.show/);
});

test('approving saves what is on screen first, so what is approved is what was read', () => {
	const approve = plan.slice(plan.indexOf('async function approve()'), plan.indexOf('async function draftShots'));
	expect(approve.indexOf("send('save'")).toBeGreaterThan(-1);
	expect(approve.indexOf("send('save'")).toBeLessThan(approve.indexOf("send('approve_level'"));
});

test('the selected row is edited in a pane beside the list, so the list never moves (rule 7)', () => {
	expect(plan).toContain('<aside class="edit" aria-label="Selected row">');
	expect(plan).not.toContain('<details class="shot"');
});

test('the outline lists the five levels, then scenes with their codes, then Unplaced', () => {
	expect(outline).toContain('{#each levels.rows as row, i (row.id)}');
	expect(outline).toContain('{#each placed.scenes as group (group.group_id)}');
	expect(outline.indexOf('placed.scenes as group')).toBeLessThan(outline.indexOf('>Unplaced</p>'));
	expect(outline.indexOf('>Unplaced</p>')).toBeLessThan(outline.indexOf('placed.unplaced as group'));
});

const door = read('src/lib/ui/story/FrontDoor.svelte');
const page = read('src/routes/+page.svelte');

test('the front door is one screen in the work area, not a dialog, and the only way to start a project', () => {
	expect(door).not.toMatch(/<dialog|showModal/);
	expect(page).toContain('<FrontDoor ');
	expect(page).not.toContain('NewProjectFlow');
	// One input; the example phrases come from the two groups the rules define.
	expect(door.match(/<textarea/g)).toHaveLength(1);
	expect(door).toContain('{#each DOOR_EXAMPLES as group (group.title)}');
});

test('what a start means is decided by the rules, not by the screen', () => {
	expect(door).toContain('onStart(doorStart({ ...input, story }), { media, song })');
	expect(page).toContain("ui.agentAsk = { projectId: id, action: start.then }");
});

test('the examples open under the input with a short motion that reduced-motion turns off', () => {
	expect(door).toMatch(/\.ways \{[^}]*transition: grid-template-rows 180ms ease-out, opacity 180ms ease-out/);
	expect(door).toMatch(/prefers-reduced-motion: reduce\) \{ \.ways, \.ask, \.ex \{ transition: none; \} \}/);
	// Closed, the examples are out of reach of the keyboard and of screen readers.
	expect(door).toContain('inert={!opened}');
});

test('a drop on the front door is never drawn with a dashed frame', () => {
	expect(door).not.toMatch(/dashed|dotted/);
	expect(door).toMatch(/\.ask\.over \{ background: var\(--color-selected\); \}/);
});
