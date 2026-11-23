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
	expect(styles).toMatch(/\.track b \{[^}]*width: 3px; height: 18px;/);
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
