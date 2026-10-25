import { describe, expect, test } from 'bun:test';
import { cutBrief, scorePrompt } from '../../src/lib/server/score-prompt';
import type { AgentModelClient } from '../../src/lib/server/model-provider';
import type { Project } from '../../src/lib/domain/schemas';

const A = '01a0fda5-0000-7000-8000-00000000000a', B = '01a0fda5-0000-7000-8000-00000000000b', CUT = '01a0fda5-0000-7000-8000-0000000000c1';
const project = {
	series: { scenes: [{ characters: ['Kai Santana', 'Mara'] }] },
	production: {
		cards: [{ card_id: A, beat: 'Kai crosses the quad at night.' }, { card_id: B, beat: 'Mara looks up from her notebook.' }],
		cuts: [{ cut_id: CUT, name: 'Teaser', entries: [{ entry_id: A, card_id: A, asset_id: A, in_s: 0, out_s: 4 }, { entry_id: B, card_id: B, asset_id: B, in_s: 1, out_s: 4 }] }]
	}
} as unknown as Project;
const fields = { cue: 'Teaser cue, dread, 7 s', styles: 'dark cinematic score, D Phrygian, 60 bpm, low strings', lyrics: '[Intro]\nlow strings\n[Silence]\n[Drop]\nlow hit', exclude: 'techno, EDM, vocals', advice: '' };

describe('score prompt (V1S-378)', () => {
	test('the brief is the cut in order with timings', () => {
		expect(cutBrief(project, CUT)).toContain('0.0–4.0 s: Kai crosses the quad at night.\n4.0–7.0 s: Mara looks up from her notebook.');
		expect(cutBrief(project, 'nope')).toBeNull();
	});

	test('GhostSuno writes the three fields; a character name in a field is sent back once', async () => {
		const answers = [JSON.stringify({ ...fields, styles: 'Kai\'s theme, dark strings' }), JSON.stringify(fields)];
		const asked: string[] = [];
		const client: AgentModelClient = { choice: { provider: 'kimi', model: 'k3' } as never, generate: async ({ system, prompt }) => { asked.push(system, prompt); return answers.shift() ?? ''; } };
		const score = await scorePrompt(client, project, CUT);
		expect(score).toMatchObject({ styles: fields.styles, exclude: fields.exclude });
		expect(asked[0]).toContain('GHOSTSUNO');
		expect(asked[3]).toContain('names in a Suno field: Kai');
	});
});
