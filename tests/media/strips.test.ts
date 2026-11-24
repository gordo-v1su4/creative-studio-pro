import { expect, test } from 'bun:test';
import { laneFrames, stripFrameStyle, stripIndex, STRIP_FRAMES } from '../../src/lib/media/strips';
import { stripUrl } from '../../src/lib/media/gpu/clipBanks';

test('a time maps to the frame that covers it, and never past either end', () => {
	expect(stripIndex(0, 10)).toBe(0);
	expect(stripIndex(5, 10)).toBe(STRIP_FRAMES / 2);
	expect(stripIndex(9.99, 10)).toBe(STRIP_FRAMES - 1);
	expect(stripIndex(12, 10)).toBe(STRIP_FRAMES - 1);
	expect(stripIndex(-1, 10)).toBe(0);
	expect(stripIndex(3, 0)).toBe(0);
});

test('one frame of the strip fills its element', () => {
	expect(stripFrameStyle('/s.jpg', 0)).toBe(`background-image: url("/s.jpg"); background-size: ${STRIP_FRAMES * 100}% 100%; background-position: 0% 0;`);
	expect(stripFrameStyle('/s.jpg', STRIP_FRAMES - 1)).toContain('background-position: 100% 0;');
	expect(stripFrameStyle('/s.jpg', 99)).toContain('background-position: 100% 0;');
});

test('a lane shows as many frames as fit, spread from the first to the last', () => {
	expect(laneFrames(1)).toEqual([0]);
	expect(laneFrames(3)).toEqual([0, 12, STRIP_FRAMES - 1]);
	expect(laneFrames(500)).toHaveLength(STRIP_FRAMES);
	expect(laneFrames(0)).toEqual([0]);
});

test('only project video files have a strip', () => {
	expect(stripUrl('/api/projects/p1/files/board/a.mp4')).toBe('/api/projects/p1/files/board/a.mp4?strip=1');
	expect(stripUrl('/api/projects/p1/files/board/a.png')).toBeNull();
	expect(stripUrl('blob:abc')).toBeNull();
});

test('hovering across a card walks the kept span of a trimmed take', async () => {
	const { stripIndexInSpan } = await import('../../src/lib/media/strips');
	expect(stripIndexInSpan(0, 10)).toBe(0);
	expect(stripIndexInSpan(1, 10)).toBe(STRIP_FRAMES - 1);
	expect(stripIndexInSpan(0, 10, 5, 10)).toBe(STRIP_FRAMES / 2);
	expect(stripIndexInSpan(1, 10, 0, 5)).toBe(STRIP_FRAMES / 2);
	expect(stripIndexInSpan(0.5, null)).toBe(STRIP_FRAMES / 2);
	expect(stripIndexInSpan(2, 10, 2, 4)).toBe(stripIndexInSpan(1, 10, 2, 4));
});
