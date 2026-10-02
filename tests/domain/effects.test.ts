import { describe, expect, test } from 'bun:test';
import { checkProposals, classifyEffect, cutMoments, impactMoments } from '../../src/lib/domain/effects';

describe('effects folder index', () => {
	test('effects are told from music by their path (real Splice names)', () => {
		expect(classifyEffect('packs/Aspyer/One_Shots/FX_One_Shots/Risers/DS_ASPYER_fx_riser_alive_lfo_D#min.wav')).toBe('riser');
		expect(classifyEffect('FX/Impacts/Cinematic_Impact_03.wav')).toBe('hit');
		expect(classifyEffect('transitions/whoosh_fast_02.aif')).toBe('whoosh');
		expect(classifyEffect('Loops/FL_HTH_Fx_Loop_Risers_Up_07_125_Fm.wav')).toBeNull(); // a loop
		expect(classifyEffect('Drum_Fills/OLIVER_100_drum_fill_build_feedback_to_impact.wav')).toBeNull(); // drums
		expect(classifyEffect('FL_GTR_Snare_Shots/FL_GTR_Away_Snare_One_Shot_Impactful_Reverb.wav')).toBeNull(); // a snare
		expect(classifyEffect('notes/readme.txt')).toBeNull();
		expect(classifyEffect('KSHMR/Synth_Stabs/KSHMR_sok5_synth_stab_rave_venom_C.wav')).toBeNull(); // a tonal stab, not an impact
		expect(classifyEffect('AU_UKPH/FX/AU_UKPH_fx_impact_deepend.wav')).toBe('hit');
	});
});

describe('moments', () => {
	test('every cut between entries', () => {
		expect(cutMoments([{ title: 'A', length_s: 2 }, { title: 'B', length_s: 1.5 }, { title: 'C', length_s: 3 }])).toEqual([
			{ at_s: 2, kind: 'cut', note: 'A → B' },
			{ at_s: 3.5, kind: 'cut', note: 'B → C' }
		]);
	});
	test('impacts are sharp jumps in the take audio, at most one per half second', () => {
		const level = Array.from({ length: 400 }, (_, f) => (f === 120 || f === 140 || f === 300 ? -8 : -40));
		expect(impactMoments(level, 100).map((m) => m.at_s)).toEqual([1.2, 3]);
	});
});

describe('checking the Agent\'s proposals (fake provider answer)', () => {
	const moments = [{ at_s: 2, kind: 'cut' as const, note: 'A → B' }, { at_s: 5.25, kind: 'impact' as const, note: 'jump' }];
	const index = [{ id: 'Risers/up.wav', name: 'up.wav', kind: 'riser' as const }, { id: 'Impacts/boom.wav', name: 'boom.wav', kind: 'hit' as const }, { id: 'Whooshes/swish.wav', name: 'swish.wav', kind: 'whoosh' as const }];
	test('placements land on real moments with real files; risers end on their moment; generate becomes an offer', () => {
		const answer = { effects: [
			{ moment_s: 2, sfx_id: 'Risers/up.wav', reason: 'build into the cut' },
			{ moment_s: 2, sfx_id: 'Whooshes/swish.wav', reason: 'carry the cut' },
			{ moment_s: 5.25, sfx_id: 'Impacts/boom.wav', reason: 'the landing' },
			{ moment_s: 5.25, generate: 'a bone-crunching rooftop landing impact', duration_s: 1.5, reason: 'nothing in the folder fits' },
			{ moment_s: 9, sfx_id: 'Impacts/boom.wav', reason: 'made-up moment' },
			{ moment_s: 2, sfx_id: 'Nope/missing.wav', reason: 'made-up file' }
		] };
		const { placed, offers, dropped } = checkProposals(answer, moments, index, { 'Risers/up.wav': 1.6, 'Whooshes/swish.wav': 0.8 });
		expect(placed).toEqual([
			{ at_s: 0.4, moment_s: 2, sfx_id: 'Risers/up.wav', reason: 'build into the cut' },
			{ at_s: 1.7, moment_s: 2, sfx_id: 'Whooshes/swish.wav', reason: 'carry the cut' },
			{ at_s: 5.25, moment_s: 5.25, sfx_id: 'Impacts/boom.wav', reason: 'the landing' }
		]);
		expect(offers).toEqual([{ moment_s: 5.25, prompt: 'a bone-crunching rooftop landing impact', duration_s: 1.5, at_s: 5.25, reason: 'nothing in the folder fits' }]);
		expect(dropped).toEqual(['no moment at 9s', 'not in the effects folder: Nope/missing.wav']);
	});
	test('a riser longer than the time before its cut starts into the file, so it still ends on the cut', () => {
		const { placed } = checkProposals({ effects: [{ moment_s: 2, sfx_id: 'Risers/up.wav', reason: 'r' }] }, moments, index, { 'Risers/up.wav': 7.68 });
		expect(placed[0]).toMatchObject({ at_s: 0, from_s: 5.68 });
	});
	test('a malformed answer is refused', () => {
		expect(() => checkProposals({ nope: 1 }, moments, index, {})).toThrow('effects must be an array');
	});
});
