import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const viewer = readFileSync('src/lib/ui/shots/Viewer.svelte', 'utf8');
const player = readFileSync('src/lib/ui/SequencePlayer.svelte', 'utf8');
const banks = readFileSync('src/lib/media/gpu/clipBanks.ts', 'utf8');
const styles = viewer.slice(viewer.indexOf('<style>'));

test('the viewer plays a take from its proxy in a plain video element, not a frame bank', () => {
	expect(viewer).toContain('<video bind:this={video} src={proxyUrl(shown.url)}');
	expect(viewer).not.toContain('loadBank');
});

test('the playhead is a tall rectangle and nothing in the viewer is round or bordered', () => {
	expect(styles).toMatch(/\.head \{[^}]*top: 2px; bottom: 4px; width: 3px;/);
	expect(styles).not.toContain('border-radius: 50%');
	expect(styles).not.toContain('border-radius: 999px');
	expect(styles).not.toMatch(/border(-(top|bottom|left|right))?: [^0;]/);
});

test('the scrub bar thickens under the pointer', () => {
	expect(styles).toMatch(/\.scrub:hover \.track \{ height: 8px;/);
});

test('a still is held as a clip, and one unreadable clip does not stop a timeline', () => {
	expect(banks).toContain('if (!pending && isStillUrl(url))');
	expect(banks).toContain('bank.loadStill(image, STILL_SECONDS, STILL_FPS, maxHeight)');
	expect(player).toContain('loadClipMetadata(item.src).catch(() => null)');
	expect(player).toContain('playing the rest, edits are not saved');
});

test('frames, scrub bar and sound are lanes of one bar under one playhead, each with a fixed height', () => {
	const lanes = viewer.slice(viewer.indexOf('<div class="scrub"'), viewer.indexOf('<div class="transport">'));
	expect(lanes.indexOf('class="frames"')).toBeLessThan(lanes.indexOf('class="track"'));
	expect(lanes.indexOf('class="track"')).toBeLessThan(lanes.indexOf('class="wave"'));
	expect(lanes.match(/class="head"/g)).toHaveLength(1);
	expect(styles).toMatch(/\.wave \{[^}]*height: 22px; flex: none;/);
	expect(viewer).toContain("const FRAME_LANE = 30;");
});

test('the frame under the pointer comes from the strip, not from seeking the video', () => {
	expect(viewer).toContain('stripFrameStyle(strip, stripIndex(hover, length))');
	const card = readFileSync('src/lib/ui/shots/ShotCard.svelte', 'utf8');
	expect(card).toContain('stripFrameStyle(strip, stripIndexInSpan(along, pick.duration_s, pick.in_s, pick.out_s))');
	expect(card).toContain('warmStrip(strip)');
});
