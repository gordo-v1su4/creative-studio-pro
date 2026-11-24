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
