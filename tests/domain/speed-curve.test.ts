import { expect, test } from 'bun:test';
import { fractionAtProgram, isFlat, normalizeSpeed, programElapsed, rateAt } from '../../src/lib/media/speed-curve';

test('no curve means 1x for the whole span', () => {
	expect(isFlat(undefined)).toBe(true);
	expect(rateAt(undefined, 0.4)).toBe(1);
	expect(programElapsed(undefined, 6)).toBe(6);
});

test('normalize pins anchors at both ends and clamps rates to 1-4x', () => {
	expect(normalizeSpeed([{ x: 0.5, rate: 9 }])).toEqual([{ x: 0, rate: 4 }, { x: 0.5, rate: 4 }, { x: 1, rate: 4 }]);
	expect(normalizeSpeed([{ x: 0.2, rate: 0.5 }])[1].rate).toBe(1);
});

test('a constant 2x curve halves the program time', () => {
	const curve = [{ x: 0, rate: 2 }, { x: 1, rate: 2 }];
	expect(programElapsed(curve, 8)).toBeCloseTo(4, 5);
	expect(fractionAtProgram(curve, 8, 2)).toBeCloseTo(0.5, 5);
});

test('a ramp never overshoots its anchors', () => {
	const curve = [{ x: 0, rate: 1 }, { x: 0.5, rate: 3 }, { x: 1, rate: 1 }];
	for (let x = 0; x <= 1; x += 0.01) {
		const rate = rateAt(curve, x);
		expect(rate).toBeGreaterThanOrEqual(1);
		expect(rate).toBeLessThanOrEqual(3 + 1e-9);
	}
	expect(rateAt(curve, 0.5)).toBeCloseTo(3, 9);
	const elapsed = programElapsed(curve, 10);
	expect(elapsed).toBeLessThan(10);
	expect(fractionAtProgram(curve, 10, programElapsed(curve, 10, 0.3))).toBeCloseTo(0.3, 2);
});
