import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const card = readFileSync('src/lib/ui/shots/ShotCard.svelte', 'utf8');
const band = readFileSync('src/lib/ui/shots/TakesBand.svelte', 'utf8');
const workspace = readFileSync('src/lib/ui/ProductionWorkspace.svelte', 'utf8');
const markup = (source: string) => source.slice(source.indexOf('</script>'), source.indexOf('<style>'));

// DESIGN.md hard rule 7: nothing reflows on click.

test('selecting a shot changes only how the card is drawn, never what it contains', () => {
	// `selected` sets the class and aria-pressed; no block that would add or remove rows.
	expect(markup(card)).toContain("selected && 'selected'");
	expect(markup(card)).toContain('aria-pressed={selected}');
	expect(markup(card)).not.toMatch(/\{#if [^}]*selected/);
});

test('the takes band has one fixed height whatever is selected', () => {
	expect(band).toMatch(/\.band \{[^}]*height: 56px;[^}]*flex: none;/);
});

test("the shot's takes and editing live in the band and the dock, not inside the card", () => {
	expect(workspace).toContain('<TakesBand');
	expect(workspace).toContain('use:portal={detailsHost}');
	expect(workspace).not.toContain('card-face');
	expect(markup(card)).not.toContain('<textarea');
});

test('shot cards and the band draw no borders', () => {
	for (const source of [card, band]) expect(source.slice(source.indexOf('<style>'))).not.toMatch(/border(-(top|bottom|left|right))?: [^0;]/);
});

const strip = readFileSync('src/lib/ui/shots/SelectionStrip.svelte', 'utf8');

test('the selection strip has the same fixed height as the takes band, and its buttons never come and go', () => {
	expect(strip).toMatch(/\.strip \{[^}]*height: 56px;/);
	// Every button is always drawn; what is selected only enables or disables it.
	const buttons = markup(strip).slice(markup(strip).indexOf('class="key add"'));
	expect(buttons).not.toContain('{#if');
	expect(strip.slice(strip.indexOf('<style>'))).not.toMatch(/border(-(top|bottom|left|right))?: [^0;]/);
});

test('the bands sit side by side or stacked by the width of the work area, never by what is selected', () => {
	expect(workspace).toContain('@container (max-width: 720px) { .bands { grid-template-columns: minmax(0, 1fr); } }');
	expect(workspace).toContain('<SelectionStrip project={live}');
});

test('a shot joins the selection by shift-click or by being dragged, and auditioning goes through the selection, not the pick', () => {
	expect(card).toContain('onclick={(event) => onselect(event.shiftKey)}');
	expect(card).toContain('setData(SHOT_DRAG, card.card_id)');
	expect(strip).toContain('reviewSequence.audition(');
	expect(strip).not.toContain('set_pick');
	expect(strip).not.toContain('onpick');
});

const sections = readFileSync('src/lib/ui/shots/PromptSections.svelte', 'utf8');
const make = readFileSync('src/lib/ui/shots/MakeTake.svelte', 'utf8');

test('a prompt is one 20px row per section, and choosing a row never adds or removes anything', () => {
	expect(sections).toMatch(/\.row \{[^}]*height: 20px;/);
	// The editor is always there; only its text follows the chosen row.
	expect(markup(sections)).toContain('<textarea rows="5" value={shown}');
	expect(markup(sections)).not.toMatch(/\{#if [^}]*(chosen|current)/);
	expect(workspace).toContain('<PromptSections title="Video prompt" skill="Ghost"');
	expect(workspace).toContain('<PromptSections title="Image prompt" skill="ONE SHOT"');
});

test('Get price and Confirm are two buttons, and only Confirm can spend', () => {
	const buttons = markup(make);
	expect(buttons).toContain('>Get price</button>');
	expect(buttons).toMatch(/class="key go" disabled=\{!open\} onclick=\{\(\) => void confirm\(\)\}/);
	// Asking for a price is the estimate action; sending is the only request that carries a confirmed price.
	expect(make.match(/action: 'estimate'/g)).toHaveLength(1);
	expect(make.match(/action: 'send'/g)).toHaveLength(1);
	expect(make).toContain("mode: { kind: 'confirm', confirmed_credits: credits }");
	expect(make).not.toContain('yolo');
	// The price step never sends.
	const getPrice = make.slice(make.indexOf('async function getPrice'), make.indexOf('async function confirm'));
	expect(getPrice).not.toContain("'send'");
});

test('the make-a-take block keeps its shape: every control is always drawn', () => {
	const steps = markup(make).slice(markup(make).indexOf('class="set"'), markup(make).indexOf('class="why"'));
	expect(steps).not.toContain('{#if');
	expect(make).toMatch(/\.why \{[^}]*min-height: 18px;/);
});

test('asking for a price always shows an outcome, even when the answer is not the app\'s own', () => {
	// The last request's message is shown ahead of what is in the way, and a non-JSON answer becomes a plain message.
	expect(make).toContain("const line = $derived((said?.shot === card.card_id ? said.text : '') || blockers[0] || '');");
	expect(make).toContain('try { return JSON.parse(text) as Answer; }');
	expect(make).toContain('making takes may not be set up here');
});

const outline = readFileSync('src/lib/ui/shell/Outline.svelte', 'utf8');
const page = readFileSync('src/routes/+page.svelte', 'utf8');

test('the grid, the outline and the selection strip all ask the one resolver what a drop means', () => {
	for (const source of [workspace, outline, strip]) expect(source).toContain("from '$lib/domain/drops'");
	expect(workspace).toContain("dropMeaning({ kind: 'files', media: files.map((file) => mediaKind(file.name) ?? 'other') }, target, dropContext)");
	expect(outline).toContain("dropMeaning(dragged, { kind: 'group', groupId }");
	expect(strip).toContain("dropMeaning({ kind: 'shots', cardIds: [id] }, { kind: 'selection', at }");
	// The same drag type is used wherever a shot is picked up.
	expect(card).toContain('setData(SHOT_DRAG, card.card_id)');
	expect(outline).toContain('setData(SHOT_DRAG, shot.id)');
});

test('G makes a group with no dialog, in the grid and on the canvas', () => {
	expect(workspace).toContain('const name = nextGroupName(project.production);');
	expect(workspace).toContain("if (group) { event.preventDefault(); void groupGathered(); return; }");
	expect(page).toContain('<svelte:window onkeydown={canvasKey} />');
	const boxed = page.slice(page.indexOf('function groupBoxed()'), page.indexOf('function canvasKey'));
	expect(boxed).toContain('nextGroupName(activeProject.production)');
	expect(boxed).not.toContain('newGroupName');
});

const node = readFileSync('src/lib/ui/nodes/StoryCardNode.svelte', 'utf8');
const brief = readFileSync('src/lib/ui/shots/ShotBrief.svelte', 'utf8');

test('a shot on the canvas is the grid card, and its actions float beside it instead of changing its size', () => {
	expect(markup(node)).toContain('<ShotCard {card} {facts} pick={shown} {selected}');
	expect(markup(node)).toContain('draggable={false}');
	expect(markup(node)).toContain('<NodeToolbar position={Position.Bottom}');
	// Everything the old card carried is in the bar: takes, bench, hold, animate, finalize, split, exclude, references.
	const bar = markup(node).slice(markup(node).indexOf('<NodeToolbar'), markup(node).indexOf('</NodeToolbar>'));
	for (const action of ['step(-1)', 'onBench', 'openHold', 'onAnimate', 'onFinalize', 'onSplit', 'restore', 'reject', 'onAttachPrevious', 'onRemoveReference']) expect(bar).toContain(action);
	expect(node).not.toContain('face-tab');
});

test('on the canvas the dock shows the selected shot read-only, and canvas drops ask the one resolver', () => {
	expect(page).toContain('<ShotBrief project={activeProject} card={briefCard}');
	expect(brief.match(/readonly/g)!.length).toBeGreaterThanOrEqual(3);
	expect(brief).not.toContain('onedit');
	expect(page).toContain("dropMeaning({ kind: 'shots', cardIds: beats }, { kind: 'group', groupId: target }, dropContext)");
	expect(page).toContain("cardId ? { kind: 'shot', cardId } : { kind: 'space', groupId: space }, dropContext)");
});
