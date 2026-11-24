import { expect, test } from 'bun:test';
import { isStillUrl, STILL_SECONDS } from '../../src/lib/media/stills';

test('pictures are stills, whatever follows the file name', () => {
	expect(isStillUrl('/api/projects/p/files/grid/run02B/P01-01.jpg')).toBe(true);
	expect(isStillUrl('/api/projects/p/files/a.JPEG?variant=medium')).toBe(true);
	expect(isStillUrl('https://host/x/still.png#t=1')).toBe(true);
	expect(isStillUrl('/files/a.webp')).toBe(true);
});

test('videos and names that only contain a picture word are not stills', () => {
	expect(isStillUrl('/api/projects/p/files/hf_20260914.mp4')).toBe(false);
	expect(isStillUrl('/api/projects/p/files/clip.mov?proxy=1')).toBe(false);
	expect(isStillUrl('/api/projects/p/files/jpg-test/clip.webm')).toBe(false);
	expect(isStillUrl('/api/projects/p/slate/card')).toBe(false);
});

test('a still outlasts any hold a cut will ask for', () => {
	expect(STILL_SECONDS).toBeGreaterThanOrEqual(600);
});
