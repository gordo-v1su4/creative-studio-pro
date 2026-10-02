import { describe, expect, test } from 'bun:test';
import { readingOrder } from '../../src/lib/domain/board-order';

describe('board reading order', () => {
	test('row by row, left to right, tolerating a slightly dragged card', () => {
		const items = [
			{ id: 'b2', x: 360, y: 300 },
			{ id: 'a3', x: 720, y: 12 },
			{ id: 'a1', x: 0, y: 0 },
			{ id: 'b1', x: 0, y: 310 },
			{ id: 'a2', x: 360, y: -20 }
		];
		expect(readingOrder(items).map((item) => item.id)).toEqual(['a1', 'a2', 'a3', 'b1', 'b2']);
	});

	test('empty and single selections', () => {
		expect(readingOrder([])).toEqual([]);
		expect(readingOrder([{ id: 'x', x: 5, y: 5 }]).map((item) => item.id)).toEqual(['x']);
	});
});
