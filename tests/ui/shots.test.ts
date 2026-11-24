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
