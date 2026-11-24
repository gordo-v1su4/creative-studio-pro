import { expect, test } from 'bun:test';
import { due, POLL_MS, queued, roomLine, settled, type Outbox } from '../../src/lib/domain/review-poll';

const now = 1_000_000;

test('a check is due every ten seconds while the project is connected and the window is in view', () => {
	expect(POLL_MS).toBe(10_000);
	expect(due({ connected: true, visible: true, checking: false, lastAt: null, now })).toBe(true);
	expect(due({ connected: true, visible: true, checking: false, lastAt: now - 9_000, now })).toBe(false);
	expect(due({ connected: true, visible: true, checking: false, lastAt: now - 10_000, now })).toBe(true);
	expect(due({ connected: false, visible: true, checking: false, lastAt: null, now })).toBe(false);
	expect(due({ connected: true, visible: false, checking: false, lastAt: null, now })).toBe(false);
	expect(due({ connected: true, visible: true, checking: true, lastAt: null, now })).toBe(false);
});

test('coming back to the window checks at once, whatever the clock says', () => {
	expect(due({ connected: true, visible: true, checking: false, lastAt: now - 1_000, now, focused: true })).toBe(true);
	expect(due({ connected: true, visible: true, checking: true, lastAt: now - 1_000, now, focused: true })).toBe(false);
});

test('the top bar says where the two apps stand', () => {
	expect(roomLine({ connected: false, lastAt: null, error: null, waiting: 0, now })).toEqual({ text: 'not connected', tone: 'off' });
	expect(roomLine({ connected: true, lastAt: null, error: null, waiting: 0, now })).toEqual({ text: 'checking', tone: 'ok' });
	expect(roomLine({ connected: true, lastAt: now - 4_200, error: null, waiting: 0, now })).toEqual({ text: 'in step · 4s', tone: 'ok' });
	expect(roomLine({ connected: true, lastAt: now - 4_200, error: 'offline', waiting: 0, now })).toEqual({ text: 'not reached · retrying', tone: 'bad' });
	expect(roomLine({ connected: true, lastAt: now - 4_200, error: null, waiting: 2, now })).toEqual({ text: '2 changes not sent · retrying', tone: 'bad' });
	expect(roomLine({ connected: true, lastAt: now - 4_200, error: null, waiting: 1, now })).toEqual({ text: '1 change not sent · retrying', tone: 'bad' });
});

test('a review that could not be sent is kept per take, and a later decision on the same take replaces the same part', () => {
	let box: Outbox = [];
	box = queued(box, { take_id: 't1', card_id: 'a', status: 'approved' }, 'offline');
	box = queued(box, { take_id: 't2', card_id: 'b', excluded: true }, 'offline');
	box = queued(box, { take_id: 't1', card_id: 'a', excluded: true }, 'offline');
	box = queued(box, { take_id: 't1', card_id: 'a', status: 'needs_changes' }, 'still offline');
	expect(box).toEqual([
		{ take_id: 't1', card_id: 'a', status: 'needs_changes', excluded: true, error: 'still offline' },
		{ take_id: 't2', card_id: 'b', excluded: true, error: 'offline' }
	]);
});

test('once a kept review is sent it leaves the list', () => {
	const box: Outbox = [{ take_id: 't1', card_id: 'a', status: 'approved', error: 'offline' }, { take_id: 't2', card_id: 'b', excluded: true, error: 'offline' }];
	expect(settled(box, 't1')).toEqual([box[1]]);
	expect(settled(box, 'zz')).toEqual(box);
});

test('a review is kept to try again only when Review Room could not be reached, not when the request itself is wrong', async () => {
	const { worthKeeping } = await import('../../src/lib/domain/review-poll');
	expect(worthKeeping({ status: 0, message: 'Failed to fetch' })).toBe(true);
	expect(worthKeeping({ status: 502, message: 'HTTP 502' })).toBe(true);
	expect(worthKeeping({ status: 400, message: 'Review Room PUT /api/v1/assets/x/review-status failed (503)' })).toBe(true);
	expect(worthKeeping({ status: 400, message: 'Project changed; reload before reviewing' })).toBe(true);
	expect(worthKeeping({ status: 400, message: 'Store this take in Review Room before setting its review status' })).toBe(false);
	expect(worthKeeping({ status: 400, message: 'Take not found' })).toBe(false);
	expect(worthKeeping({ status: 400, message: 'Choose a review decision' })).toBe(false);
});

test('a pick that could not be sent is kept like any other review, alongside a status on the same take', () => {
	let box: Outbox = [];
	box = queued(box, { take_id: 't1', card_id: 'a', current: true }, 'offline');
	box = queued(box, { take_id: 't1', card_id: 'a', status: 'approved' }, 'offline');
	expect(box).toEqual([{ take_id: 't1', card_id: 'a', current: true, status: 'approved', error: 'offline' }]);
	// Another take of the same shot becoming the pick replaces the earlier pick: only the last choice is sent.
	box = queued(box, { take_id: 't2', card_id: 'a', current: true }, 'offline');
	expect(box.filter((entry) => entry.current).map((entry) => entry.take_id)).toEqual(['t2']);
	expect(box.find((entry) => entry.take_id === 't1')).toEqual({ take_id: 't1', card_id: 'a', status: 'approved', error: 'offline' });
});
