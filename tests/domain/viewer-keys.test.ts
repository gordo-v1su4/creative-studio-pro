import { expect, test } from 'bun:test';
import { step, timecode, viewerAction } from '../../src/lib/domain/viewer-keys';

const key = (k: string, over: Record<string, unknown> = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...over });

test('Space plays and pauses; Escape closes', () => {
	expect(viewerAction(key(' '))).toEqual({ type: 'toggle-play' });
	expect(viewerAction(key('Escape'))).toEqual({ type: 'close' });
});

test('left and right step shots; up and down step takes', () => {
	expect(viewerAction(key('ArrowRight'))).toEqual({ type: 'shot', by: 1 });
	expect(viewerAction(key('ArrowLeft'))).toEqual({ type: 'shot', by: -1 });
	expect(viewerAction(key('ArrowDown'))).toEqual({ type: 'take', by: 1 });
	expect(viewerAction(key('ArrowUp'))).toEqual({ type: 'take', by: -1 });
});

test('J K L shuttle: back a second, pause, play (and faster on a second L)', () => {
	expect(viewerAction(key('j'))).toEqual({ type: 'back' });
	expect(viewerAction(key('k'))).toEqual({ type: 'pause' });
	expect(viewerAction(key('L'))).toEqual({ type: 'forward' });
});

test('P picks, X excludes, 1 to 4 set the review status', () => {
	expect(viewerAction(key('p'))).toEqual({ type: 'pick' });
	expect(viewerAction(key('x'))).toEqual({ type: 'exclude' });
	expect(viewerAction(key('1'))).toEqual({ type: 'status', status: 'awaiting_review' });
	expect(viewerAction(key('2'))).toEqual({ type: 'status', status: 'in_progress' });
	expect(viewerAction(key('3'))).toEqual({ type: 'status', status: 'needs_changes' });
	expect(viewerAction(key('4'))).toEqual({ type: 'status', status: 'approved' });
});

test('keys held with Command, Control or Alt, and keys that mean nothing, are left alone', () => {
	expect(viewerAction(key('p', { metaKey: true }))).toBeNull();
	expect(viewerAction(key('k', { ctrlKey: true }))).toBeNull();
	expect(viewerAction(key('ArrowRight', { altKey: true }))).toBeNull();
	expect(viewerAction(key('q'))).toBeNull();
});

test('stepping stops at either end', () => {
	expect(step(5, 0, -1)).toBe(0);
	expect(step(5, 4, 1)).toBe(4);
	expect(step(5, 2, 1)).toBe(3);
	expect(step(0, 0, 1)).toBe(0);
});

test('timecode reads minutes, seconds and hundredths', () => {
	expect(timecode(0)).toBe('00:00.00');
	expect(timecode(2.1)).toBe('00:02.10');
	expect(timecode(65.432)).toBe('01:05.43');
	expect(timecode(Number.NaN)).toBe('00:00.00');
});
