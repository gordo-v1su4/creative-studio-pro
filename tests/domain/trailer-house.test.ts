import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { checkTarget, fillMasterPrompt, parseBlueprint, parsePitches, parseSection } from '../../src/lib/domain/trailer-house';

describe('Trailer House', () => {
	test('both Seedance targets, each held to its own limits', () => {
		expect(checkTarget({ model: 'seedance-2.0', seconds: 12, aspect: '16:9' })).toEqual({ ok: true });
		expect(checkTarget({ model: 'seedance-2.0', seconds: 20, aspect: '16:9' }).ok).toBeFalse();
		expect(checkTarget({ model: 'seedance-2.5', seconds: 20, aspect: '16:9' })).toEqual({ ok: true });
		expect(checkTarget({ model: 'seedance-2.5', seconds: 31, aspect: '16:9' }).ok).toBeFalse();
		expect(checkTarget({ model: 'seedance-2.0', seconds: 10, aspect: 'adaptive' }).ok).toBeFalse();
		expect(checkTarget({ model: 'seedance-2.5', seconds: 10, aspect: 'adaptive' }).ok).toBeTrue();
	});

	test('the repo master prompt fills every target field and keeps the parsed headers', () => {
		const file = readFileSync('prompts/trailer-house.md', 'utf8');
		const format = (skill: string) => readFileSync(`.agents/skills/${skill}/format.md`, 'utf8');
		// Seedance 2.0: Higgsfield's plain-prose shots with the shot structure up top.
		const v20 = fillMasterPrompt(file, { model: 'seedance-2.0', seconds: 15, aspect: '9:16' }, format('seedance-2-0-higgsfield'));
		expect(v20).not.toContain('{{');
		expect(v20).toContain('exactly 15 seconds');
		expect(v20).toContain('Total: 15s / N shots / 9:16');
		expect(v20).not.toContain('REFERENCE AND CONTINUITY');
		expect(v20.startsWith('MASTER INSTRUCTIONS')).toBeTrue();
		for (const header of ['TITLE:', 'LOGLINE:', 'HOOK:', 'SEEDANCE PROMPT:']) expect(v20).toContain(header);
		// Seedance 2.5: the opening line and four sections, with dialogue and sound placed in the timeline.
		const v25 = fillMasterPrompt(file, { model: 'seedance-2.5', seconds: 20, aspect: '16:9' }, format('seedance-2-5-higgsfield'));
		expect(v25).not.toContain('{{');
		expect(v25).toContain('Create a 20-second, 16:9');
		for (const section of ['REFERENCE AND CONTINUITY', 'STORY AND TONE', 'VISUALS AND SOUND', '[00:00–00:04] —']) expect(v25).toContain(section);
		expect(v25).toContain('Speak only the <N> scripted lines');
		expect(v25).not.toContain('Total: 15s');
		// The old bracketed-timeline instruction is gone for both.
		for (const filled of [v20, v25]) expect(filled).not.toContain('[00:00–00:03]');
	});

	test('three numbered pitches, each a one-sentence logline and a short description', () => {
		const labelled = parsePitches('1.\nLOGLINE: When a flood cuts the town off, a night nurse must get insulin across the river before dawn, or else her patients die.\nDESCRIPTION: A worn-out nurse and a borrowed boat.\nThe river is rising.\n\n2.\n**LOGLINE:** When her twin vanishes from a locked lab, a chemist must rebuild his last experiment before the board shuts it down, or else he is lost for good.\n**DESCRIPTION:** Grief turned into a race.\n3) LOGLINE: When a blackout hits the stadium, a rookie medic must reach the trapped commentator before the stands give way, or else the crowd panics.\nDESCRIPTION: One night, forty thousand people.');
		expect(labelled.ok).toBeTrue();
		if (labelled.ok) {
			expect(labelled.pitches[0].description).toBe('A worn-out nurse and a borrowed boat. The river is rising.');
			expect(labelled.pitches[1].logline.startsWith('When her twin')).toBeTrue();
		}
		// Unlabelled: first sentence is the logline, the rest the description.
		const plain = parsePitches('1. When A happens, a cook must B before C, or else D. A short paragraph.\n2. When E, a pilot must F before G, or else H. More words.\n3. When I, a judge must J before K, or else L. Even more.');
		expect(plain.ok && plain.pitches[2].description).toBe('Even more.');
		expect(parsePitches('1. LOGLINE: Only one.\nDESCRIPTION: x').ok).toBeFalse();
		expect(parsePitches('1. When A, a cook must B, or else D.\n2. When E, a pilot must F, or else H. Words.\n3. When I, a judge must J, or else L. Words.').ok).toBeFalse();
	});

	test('continue steps read one header', () => {
		expect(parseSection('CHARACTERS:\nMara Vell, 34.\n- Her brother.', 'CHARACTERS')).toEqual({ ok: true, text: 'Mara Vell, 34.\n- Her brother.' });
		expect(parseSection('Here you go', 'OUTLINE').ok).toBeFalse();
		expect(parseSection('OUTLINE:\n1. a\nOUTLINE:\n2. b', 'OUTLINE').ok).toBeFalse();
	});

	test('the blueprint needs the four headers once each, in order, with content', () => {
		const raw = 'TITLE: Last Insulin\nLOGLINE: When a flood cuts the town off, a night nurse must cross before dawn, or else her patients die.\nHOOK: She has one boat and a lie to undo.\nSEEDANCE PROMPT:\nSeedance 2.5, 12 seconds, 16:9.\n[00:00–00:03] Rain on a dark ward.\n[00:03–00:12] She rows.';
		const ok = parseBlueprint(raw);
		expect(ok.ok).toBeTrue();
		if (ok.ok) {
			expect(ok.blueprint.title).toBe('Last Insulin');
			expect(ok.blueprint.seedance_prompt).toContain('[00:03–00:12] She rows.');
		}
		// The original Sora-style header with a length suffix still reads.
		expect(parseBlueprint(raw.replace('SEEDANCE PROMPT:', 'SEEDANCE PROMPT - 12 SECONDS:')).ok).toBeTrue();
		expect(parseBlueprint(raw.replace('HOOK: She has one boat and a lie to undo.\n', '')).ok).toBeFalse();
		expect(parseBlueprint(`${raw}\nTITLE: Again`).ok).toBeFalse();
		expect(parseBlueprint(raw.replace('HOOK: She has one boat and a lie to undo.', 'HOOK:')).ok).toBeFalse();
	});
});
