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

const work = read('src/lib/ui/story/agent-work.svelte.ts');
const pitch = read('src/lib/ui/story/Pitch.svelte');
const sheet = read('src/lib/ui/story/BriefSheet.svelte');
const dock = read('src/lib/ui/story/AgentActions.svelte');
const chat = read('src/lib/ui/chat/AgentChat.svelte');

test('every Agent action says what it is doing and what came of it (story 6)', () => {
	// Each public action goes through `run`, which adds the line before the work and settles it after.
	for (const action of ['draftBrief', 'pitch', 'teaserFor', 'propose']) expect(work).toMatch(new RegExp(`\\n\\t${action}\\([^)]*\\)[^{]*\\{[\\s\\S]{0,700}?return this\\.run\\(`));
	expect(work).toMatch(/const picked = await this\.run\(project, 'pick'/);
	expect(work).toContain("this.settle(line, said, 'done')");
	expect(work).toContain("'failed')");
});

test('the Agent prepares and never confirms a spend (decision 17): its actions do not reach the render or animate routes', () => {
	expect(work).not.toMatch(/\/render|\/animate|confirmed_credits/);
	// Price and Confirm are the operator's two separate steps on the pitch.
	expect(pitch).toContain("action: 'quote'");
	expect(pitch).toMatch(/disabled=\{!priced \|\|/);
	expect(pitch).toContain('confirmed_credits: credits');
});

test('the same actions are offered in the dock and in place', () => {
	for (const call of ['agentWork.pitch(project)', 'agentWork.teaserFor(project', 'agentWork.draftBrief(project)', 'agentWork.propose(project']) expect(dock).toContain(call);
	expect(chat).toContain('<AgentActions {project} buttons={more} />');
	expect(pitch).toContain('agentWork.pick(project, at, i)');
	expect(plan).toContain('agentWork.propose(project, proposable');
	expect(sheet).toContain('agentWork.draftBrief(project)');
});

test('the Agent leads only once, for a project just started at the front door', () => {
	// The ask is taken (cleared) before it is acted on, so a reload or a project switch never repeats a model call.
	expect(sheet).toMatch(/ui\.agentAsk = null;\n\t\tif \(!project\.brief_state\.versions\.length\) void draft\(\);/);
	expect(plan).toMatch(/ui\.agentAsk = null;\n\t\tif \(!project\.trailer_house\?\.rounds\.length\) void agentWork\.pitch\(project\);/);
});

test('the idea tools are Agent actions now: the panels they lived in are gone (decision 18)', () => {
	const workspace = read('src/lib/ui/ProductionWorkspace.svelte');
	expect(workspace).not.toMatch(/TrailerHousePanel|BriefPanel/);
	expect(() => read('src/lib/ui/TrailerHousePanel.svelte')).toThrow();
	expect(() => read('src/lib/ui/BriefPanel.svelte')).toThrow();
});
