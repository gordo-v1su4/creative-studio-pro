import { describe, expect, test } from 'bun:test';
import { cutBar, cutNext, openCutOf, shownVersion, stepBlocked, stepOfTab, versionLabel, versionRows } from '../../src/lib/domain/cut-stage';
import type { Cut, CutEntry, SoundPlan } from '../../src/lib/domain/schemas';
import { defaultSoundPlan } from '../../src/lib/domain/sound';

const entry = (id: string, out_s: number): CutEntry => ({ entry_id: id, card_id: `c${id}`, asset_id: `a${id}`, in_s: 0, out_s });
const mixed = (plan: Partial<SoundPlan> = {}): SoundPlan => ({ ...defaultSoundPlan(), mix: { url: '/mix.wav', built_at: '2026-11-23T21:14:00.000Z', report: [] }, ...plan });
const exported = (): SoundPlan => mixed({ export: { built_at: '2026-11-23T21:40:00.000Z', folder: 'exports/x', mp4: '/x.mp4', fcpxml: '/x.fcpxml', files: [], drafts: [] } as unknown as SoundPlan['export'] });

/** v1 locked, v2 locked mixed and exported, v3 being edited. */
const cut = (over: Partial<Cut> = {}): Cut => ({
	cut_id: 'k1', name: 'Teaser · rough', version: 3, locked: false,
	versions: [
		{ version: 1, entries: [entry('1', 4), entry('2', 3)], locked_at: '2026-11-20T10:00:00.000Z' },
		{ version: 2, entries: [entry('1', 4)], locked_at: '2026-11-22T10:00:00.000Z', sound: exported() }
	],
	entries: [entry('1', 4), entry('2', 2), entry('3', 1.5)],
	created_at: '2026-11-19T10:00:00.000Z', updated_at: '2026-11-24T10:00:00.000Z', ...over
});

describe('the steps of the Cut stage', () => {
	test('each Cut view is a step', () => {
		expect(stepOfTab('cuts')).toBe('picture');
		expect(stepOfTab('sound')).toBe('sound');
		expect(stepOfTab('export')).toBe('export');
	});
});

describe('versions in the outline', () => {
	test('newest first: the version being edited, then each locked one with what was done to it', () => {
		const rows = versionRows(cut());
		expect(rows.map((row) => [row.version, versionLabel(row)])).toEqual([[3, 'Editing'], [2, 'Locked · mixed · exported'], [1, 'Locked']]);
		expect(rows[0].entries).toBe(3);
		expect(rows[0].length).toBeCloseTo(7.5);
		expect(rows[2].length).toBeCloseTo(7);
	});

	test('a locked current version is listed once, as locked', () => {
		const locked = cut({ version: 2, locked: true, versions: cut().versions });
		expect(versionRows(locked).map((row) => [row.version, versionLabel(row)])).toEqual([[2, 'Locked · mixed · exported'], [1, 'Locked']]);
	});

	test('mixed without an export', () => {
		const one = cut({ versions: [{ version: 1, entries: [entry('1', 4)], locked_at: '2026-11-20T10:00:00.000Z', sound: mixed() }] });
		expect(versionLabel(versionRows(one)[1])).toBe('Locked · mixed');
	});
});

describe('which cut and version a step shows', () => {
	const cuts = [cut(), cut({ cut_id: 'k2', name: 'Alt', updated_at: '2026-11-25T10:00:00.000Z' })];
	test('the chosen cut, else the one changed last', () => {
		expect(openCutOf(cuts, 'k1')?.cut_id).toBe('k1');
		expect(openCutOf(cuts, 'gone')?.cut_id).toBe('k2');
		expect(openCutOf(cuts, null)?.cut_id).toBe('k2');
		expect(openCutOf([], null)).toBeNull();
	});

	test('Picture shows the chosen version, else the current one', () => {
		expect(shownVersion(cut(), null, 'picture')).toBe(3);
		expect(shownVersion(cut(), 1, 'picture')).toBe(1);
		expect(shownVersion(cut(), 9, 'picture')).toBe(3);
	});

	test('Sound and Export need a locked version: the chosen one when locked, else the newest locked', () => {
		expect(shownVersion(cut(), 1, 'sound')).toBe(1);
		expect(shownVersion(cut(), 3, 'sound')).toBe(2);
		expect(shownVersion(cut(), null, 'export')).toBe(2);
		expect(shownVersion(cut({ versions: [] }), null, 'sound')).toBeNull();
	});
});

describe('what stops a step', () => {
	test('Sound needs a locked version, Export a built mix', () => {
		expect(stepBlocked(cut({ versions: [] }), null, 'sound')).toBe('Nothing of Teaser · rough is locked yet. Lock v3 in Picture to lay sound against it.');
		expect(stepBlocked(cut(), 1, 'sound')).toBeNull();
		expect(stepBlocked(cut(), 1, 'export')).toBe('v1 has no mix yet. Build it in Sound first.');
		expect(stepBlocked(cut(), 2, 'export')).toBeNull();
		expect(stepBlocked(cut(), null, 'picture')).toBeNull();
	});
});

describe('the work area header', () => {
	test('one line of facts per step', () => {
		expect(cutBar(cut(), 3, 'picture')).toBe('3 entries · 7.5s · edits save to this cut');
		expect(cutBar(cut(), 2, 'picture')).toBe('1 entry · 4.0s · picture locked · read-only');
		expect(cutBar(cut(), 2, 'sound')).toBe('Picture locked 22 Nov · 4.0s');
		expect(cutBar(cut(), 2, 'export')).toBe('Picture locked 22 Nov · mix built 23 Nov · 4.0s');
		expect(cutBar(cut(), 1, 'export')).toBe('Picture locked 20 Nov · no mix · 7.0s');
	});
});

describe('the Next line on the Cut stage', () => {
	test('says what the shown version waits on', () => {
		expect(cutNext(null, null, 'picture')).toBe('No cuts yet · push a selection from Shots');
		expect(cutNext(cut(), 3, 'picture')).toBe('Lock v3 to lay sound against it');
		expect(cutNext(cut(), 1, 'sound')).toBe('Build the mix of v1');
		expect(cutNext(cut(), 1, 'export')).toBe('Build the mix of v1 in Sound');
		expect(cutNext(cut(), 2, 'export')).toBe('v2 is exported');
		const mixedOnly = cut({ versions: [{ version: 1, entries: [entry('1', 4)], locked_at: '2026-11-20T10:00:00.000Z', sound: mixed() }] });
		expect(cutNext(mixedOnly, 1, 'sound')).toBe('Export v1');
	});
});
