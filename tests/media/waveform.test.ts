import { expect, test } from 'bun:test';
import { waveColumns, wavePath } from '../../src/lib/media/waveform';

test('peaks reduce to the loudest value in each column', () => {
	expect(waveColumns([0.1, 0.9, 0.2, 0.3, 1, 0], 3)).toEqual([0.9, 0.3, 1]);
	expect(waveColumns([0.5, 0.25], 10)).toEqual([0.5, 0.25]);
	expect(waveColumns([], 10)).toEqual([]);
});

test('the wave is one closed shape mirrored about the middle; silence keeps a hairline', () => {
	expect(wavePath([1, 0])).toBe('M0,0 1,0 1,0.96 2,0.96 L2,1.04 1,1.04 1,2 0,2 Z');
	expect(wavePath([])).toBe('');
});
