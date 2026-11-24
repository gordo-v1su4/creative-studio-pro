import { expect, test } from 'bun:test';
import { canConfirm, quoteKey, takeBlockers, takeSeconds, type TakeSettings } from '../../src/lib/domain/make-take';

const settings: TakeSettings = { duration_s: 5, resolution: '480p', generate_audio: true };
const still = { kind: 'image', width: 2752, height: 1536 };

test('Confirm opens only after a price was asked for these exact settings', () => {
	const key = quoteKey('shot-1', settings);
	expect(canConfirm({ quote: null, key, blockers: [], busy: false })).toBe(false);
	expect(canConfirm({ quote: { key, credits: 12 }, key, blockers: [], busy: false })).toBe(true);
});

test('changing the length, the resolution, the sound or the shot drops the price', () => {
	const quote = { key: quoteKey('shot-1', settings), credits: 12 };
	for (const changed of [{ ...settings, duration_s: 6 }, { ...settings, resolution: '1080p' as const }, { ...settings, generate_audio: false }]) {
		expect(canConfirm({ quote, key: quoteKey('shot-1', changed), blockers: [], busy: false })).toBe(false);
	}
	expect(canConfirm({ quote, key: quoteKey('shot-2', settings), blockers: [], busy: false })).toBe(false);
});

test('a price never opens Confirm while something is in the way or a request is running', () => {
	const key = quoteKey('shot-1', settings);
	const quote = { key, credits: 12 };
	expect(canConfirm({ quote, key, blockers: ['The pick is a video; a take is made from a still'], busy: false })).toBe(false);
	expect(canConfirm({ quote, key, blockers: [], busy: true })).toBe(false);
});

test('a shot is sent only from a saved still of 2K or more with a prompt', () => {
	expect(takeBlockers({ pick: still, prompt: 'p', unsaved: false })).toEqual([]);
	expect(takeBlockers({ pick: null, prompt: 'p', unsaved: false })).toEqual(['This shot has no take yet; it needs a still as its pick']);
	expect(takeBlockers({ pick: { kind: 'video' }, prompt: 'p', unsaved: false })).toEqual(['The pick is a video; a take is made from a still']);
	expect(takeBlockers({ pick: { kind: 'image', width: 1920, height: 1080 }, prompt: 'p', unsaved: false })).toEqual(['The still is under 2048px on its long edge']);
	expect(takeBlockers({ pick: still, prompt: '  ', unsaved: true })).toEqual(['The video prompt is empty', 'Save the workspace first, so the take is made from what is saved']);
});

test("the length sent is the shot's planned length in whole seconds, inside what the model renders", () => {
	expect(takeSeconds(5400)).toBe(5);
	expect(takeSeconds(1500)).toBe(4);
	expect(takeSeconds(90_000)).toBe(30);
});
