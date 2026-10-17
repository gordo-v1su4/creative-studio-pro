import { describe, expect, test } from 'bun:test';
import {
	codeCandidates, codeProblems, episodeCode, fillEpisodeCodes, formatShotCode, insertShotNumber, isInsert, numberShots,
	parseShotCode, sceneOrder, suggestCode
} from '../../src/lib/domain/shot-codes';

describe('show and scene codes', () => {
	test('a two-word title gives first letter, a consonant of the first word, then the second word', () => {
		expect(suggestCode('Blood Rush')).toBe('BLR');
		expect(codeCandidates('Parking Lot')[0]).toBe('PRL');
	});

	test('three or more words use their initials', () => {
		expect(suggestCode('After School Special')).toBe('ASS');
		expect(suggestCode('The Night of the Hunter')).toBe('NGH');
	});

	test('scene prefixes and asides are ignored unless they are all there is', () => {
		expect(suggestCode('P02 — Morning Quad')).toBe('MRQ');
		expect(suggestCode('P01 — 2:47 AM (Teaser)')).toMatch(/^[A-Z]{3}$/);
	});

	test('a taken code moves to the next candidate, and never repeats', () => {
		const taken = ['BLR'];
		const next = suggestCode('Blood Rush', taken);
		expect(next).not.toBe('BLR');
		expect(next).toMatch(/^B[A-Z]{2}$/);
	});

	test('codeProblems catches bad shapes and duplicate scene codes', () => {
		expect(codeProblems('BLR', [{ title: 'A', code: 'PAR' }, { title: 'B', code: 'QUD' }])).toEqual([]);
		expect(codeProblems('bl', [])).toEqual(['The show code must be three capital letters']);
		expect(codeProblems('BLR', [{ title: 'A', code: 'PAR' }, { title: 'B', code: 'PAR' }])).toEqual(['PAR is used by both A and B']);
		expect(codeProblems('BLR', [{ title: 'A', code: 'pa1' }, { title: 'B' }])).toEqual(['A: "pa1" is not three capital letters', 'B has no scene code']);
	});
});

describe('episode and scene order', () => {
	test('EP + season digit + two-digit episode, season 1 by default', () => {
		expect(episodeCode(1, 1)).toBe('EP101');
		expect(episodeCode(null, 12)).toBe('EP112');
		expect(episodeCode(2, 1)).toBe('EP201');
		expect(() => episodeCode(10, 1)).toThrow();
	});

	test('scenes are 010, 020… in story order', () => {
		expect([0, 1, 13].map(sceneOrder)).toEqual(['010', '020', '140']);
	});
});

describe('shot numbers', () => {
	test('steps of 10 from 0010', () => {
		expect(numberShots(['P01.01', 'P01.02', 'P01.03'])).toEqual([10, 20, 30]);
	});

	test('Notion inserts (P01.01A) take the midpoint between their neighbours', () => {
		expect(isInsert('P01.01A')).toBe(true);
		expect(isInsert('P01.01')).toBe(false);
		expect(numberShots(['P01.01', 'P01.01A', 'P01.02', 'P01.04', 'P01.04A', 'P01.05', 'P01.05A', 'P01.06']))
			.toEqual([10, 15, 20, 30, 35, 40, 45, 50]);
	});

	test('a run of inserts splits the gap evenly', () => {
		expect(numberShots(['P01.01', 'P01.01A', 'P01.01B', 'P01.02'])).toEqual([10, 13, 16, 20]);
	});

	test('an insert at the end takes the half step before the next step', () => {
		expect(numberShots(['P01.01', 'P01.01A'])).toEqual([10, 15]);
	});

	test('a shot added later never renumbers others', () => {
		const taken = [10, 15, 20, 30];
		expect(insertShotNumber(taken, 10)).toBe(12);
		expect(insertShotNumber(taken, 20)).toBe(25);
		expect(insertShotNumber(taken, 30)).toBe(40);
		expect(insertShotNumber(taken, null)).toBe(5);
		expect(insertShotNumber([], null)).toBe(10);
		expect(() => insertShotNumber([10, 11], 10)).toThrow('No free shot number');
	});
});

describe('fillEpisodeCodes', () => {
	const scenes = [
		{ title: 'P01 — Parking Lot', group_id: 'g1' },
		{ title: 'P02 — Party Lights', group_id: 'g2', code: 'PRL' }
	];
	const cards = [
		{ card_id: 'a', title: 'P01.01', order: 0, group_id: 'g1' },
		{ card_id: 'b', title: 'P01.01A', order: 1, group_id: 'g1' },
		{ card_id: 'c', title: 'P01.02', order: 2, group_id: 'g1' },
		{ card_id: 'd', title: 'P02.01', order: 3, group_id: 'g2', shot_number: 10 },
		{ card_id: 'e', title: 'P02.02', order: 4, group_id: 'g2' },
		{ card_id: 'f', title: 'P02.03', order: 5, group_id: 'g2', shot_number: 20 },
		{ card_id: 'g', title: 'P02.04', order: 6, group_id: 'g2' },
		{ card_id: 'm', title: 'Loose', order: 7 }
	];

	test('fills missing scene codes without clashing with set ones', () => {
		const out = fillEpisodeCodes(scenes, cards);
		expect(out.scenes[1].code).toBe('PRL');
		expect(out.scenes[0].code).toMatch(/^P[A-Z]{2}$/);
		expect(out.scenes[0].code).not.toBe('PRL');
	});

	test('numbers an unnumbered scene from its shot names, slots new shots into a numbered one', () => {
		const out = fillEpisodeCodes(scenes, cards);
		const n = Object.fromEntries(out.cards.map((card) => [card.card_id, card.shot_number]));
		expect(n).toEqual({ a: 10, b: 15, c: 20, d: 10, e: 15, f: 20, g: 30, m: undefined });
	});

	test('running it again changes nothing', () => {
		const once = fillEpisodeCodes(scenes, cards);
		expect(fillEpisodeCodes(once.scenes, once.cards)).toEqual(once);
	});
});

describe('formatting and parsing', () => {
	test('BLR_EP101_PAR_0020_v003', () => {
		const parts = { show: 'BLR', episode: 'EP101', scene: 'PAR', shot: 20 };
		expect(formatShotCode(parts)).toBe('BLR_EP101_PAR_0020');
		expect(formatShotCode(parts, 3)).toBe('BLR_EP101_PAR_0020_v003');
		expect(parseShotCode('BLR_EP101_PAR_0020_v003')).toEqual({ ...parts, version: 3 });
		expect(parseShotCode('BLR_EP101_PAR_0020.mp4')).toBeNull();
		expect(parseShotCode('BLR_EP101_PAR_0020')).toEqual({ ...parts, version: null });
		expect(parseShotCode('blr_ep101_par_0020')).toBeNull();
	});
});
