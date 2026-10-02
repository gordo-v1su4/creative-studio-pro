import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { continueWith, offeredFor, pitchThree, teaserFor, teaserLintIssue } from '../../src/lib/server/trailer-house';
import { TRAILER_HOUSE_AGENT } from '../../src/lib/domain/trailer-house';
import type { AgentModelClient } from '../../src/lib/server/model-provider';
import type { TrailerHouse } from '../../src/lib/domain/schemas';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

/** A stand-in Agent that answers from a queue and records what it was asked. */
const scripted = (answers: string[]) => {
	const asked: { system: string; prompt: string }[] = [];
	const client: AgentModelClient = { choice: { provider: 'kimi', model: 'k3' } as AgentModelClient['choice'], async generate(input) { asked.push(input); return answers.shift() ?? ''; } };
	return { client, asked };
};
const round1 = '1.\nLOGLINE: When a flood cuts the town off, a night nurse must get insulin across the river before dawn, or else her patients die.\nDESCRIPTION: A worn-out nurse, a borrowed boat, a rising river.\n2.\nLOGLINE: When her twin vanishes from a locked lab, a chemist must rebuild his last experiment before the board shuts it down, or else he is lost for good.\nDESCRIPTION: Grief turned into a race.\n3.\nLOGLINE: When a blackout hits the stadium, a rookie medic must reach the trapped commentator before the stands give way, or else the crowd panics.\nDESCRIPTION: One night, forty thousand people.';
const round2 = round1.replaceAll('When', 'After');
const blueprint = 'TITLE: Last Insulin\nLOGLINE: When a flood cuts the town off, a night nurse must cross before dawn, or else her patients die.\nHOOK: One boat, one lie to undo.\nSEEDANCE PROMPT:\nSeedance 2.5 · 12 seconds · 16:9\n[00:00–00:04] Rain on a dark ward.\n[00:04–00:12] She rows.';

describe('Trailer House: seeds → loglines → three more → develop', () => {
	test('the whole flow, saved on the project, with the blueprint as its lead voice', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-th-')); roots.push(root);
		const gateway = new ProjectCommandGateway(new ProjectStore({ root }));
		const created = await gateway.createProject({ command: 'create_project', title: 'Flood night', brief: '', creative_focus: 'full room', created_by: 'gordo' });
		if (!created.ok) throw new Error(created.error.message);
		let project = created.data;
		const target = { model: 'seedance-2.5' as const, seconds: 12, aspect: '16:9' };
		const seeds = 'flood, insulin, a rowing boat, a lie';

		// A broken first answer gets one correction, then three pitches.
		const agent = scripted(['Here are some ideas!', round1, round2, blueprint, 'CHARACTERS:\nMara Vell, 34, night nurse.', 'OUTLINE:\n1. The flood.\n2. The boat.']);
		const first = await pitchThree(agent.client, project, { seeds, character: '', target, earlier: [] });
		expect(first.pitches).toHaveLength(3);
		expect(first.pitches[0].description).toContain('borrowed boat');
		expect(agent.asked[0].system).toContain('Seedance 2.5');
		expect(agent.asked[0].prompt).toContain('flood, insulin');
		expect(agent.asked[1].prompt).toContain('BROKE THE FORMAT');
		const now = new Date().toISOString();
		let house: TrailerHouse = { target, seeds, character: '', character_image: null, rounds: [{ seeds, pitches: first.pitches, model: 'kimi · k3', created_at: now }], picked: null, blueprint: null, characters: null, outline: null, updated_at: now };
		let saved = await gateway.setTrailerHouse(project.project_id, project.version, house);
		if (!saved.ok) throw new Error(saved.error.message);
		project = saved.data;

		// Three more: the Agent is told what it already offered for these seeds; a main character is passed through.
		const more = await pitchThree(agent.client, project, { seeds, character: 'Mara Vell, 34, a night nurse', target, earlier: offeredFor(project.trailer_house, seeds) });
		expect(agent.asked[2].prompt).toContain('ALREADY OFFERED');
		expect(agent.asked[2].prompt).toContain('night nurse must get insulin');
		expect(agent.asked[2].prompt).toContain("OPERATOR'S MAIN CHARACTER");
		expect(offeredFor(project.trailer_house, 'other seeds')).toEqual([]);
		house = { ...house, rounds: [...house.rounds, { seeds, pitches: more.pitches, model: 'kimi · k3', created_at: now }] };

		// With a reference image, the image goes to the Agent and the prompt says not to describe the look.
		const withImage = scripted([round1]);
		await pitchThree(withImage.client, project, { seeds, character: 'Mara', image: { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png', name: 'mara-sheet.png' }, target, earlier: [] });
		expect((withImage.asked[0] as { images?: unknown[] }).images).toHaveLength(1);
		expect(withImage.asked[0].prompt).toContain('mara-sheet.png');
		expect(withImage.asked[0].prompt).toContain('never describe their face');

		// Pick round 1, pitch 1: its teaser right away, saved and turned into the lead voice.
		const teaser = await teaserFor(agent.client, project, { seeds, character: '', target, offered: house.rounds[0].pitches, pick: house.rounds[0].pitches[0] });
		expect(agent.asked[3].prompt).toContain('THE OPERATOR PICKS THIS ONE');
		house = { ...house, picked: { round: 0, index: 0 }, blueprint: { ...teaser.blueprint, raw: teaser.raw, model: 'kimi · k3', created_at: now } };

		// Keep going: characters, then an outline that sees them.
		house = { ...house, characters: { text: await continueWith(agent.client, project, house, 'characters'), model: 'kimi · k3', created_at: now } };
		expect(agent.asked[4].prompt).toContain('THE TEASER SO FAR');
		house = { ...house, outline: { text: await continueWith(agent.client, project, house, 'outline'), model: 'kimi · k3', created_at: now } };
		expect(agent.asked[5].prompt).toContain('CHARACTERS SO FAR');
		expect(house.outline?.text).toBe('1. The flood.\n2. The boat.');

		saved = await gateway.setTrailerHouse(project.project_id, project.version, house);
		if (!saved.ok) throw new Error(saved.error.message);
		expect(saved.data.trailer_house?.rounds).toHaveLength(2);
		expect(saved.data.trailer_house?.blueprint?.title).toBe('Last Insulin');
		expect(saved.data.trailer_house?.characters?.text).toContain('Mara Vell');
		const voice = saved.data.voices[0];
		expect(voice).toMatchObject({ raycast_agent: TRAILER_HOUSE_AGENT, parse_status: 'valid', title: 'Last Insulin', summary: 'One boat, one lie to undo.' });

		// Start over: the voice goes with the blueprint.
		const cleared = await gateway.setTrailerHouse(project.project_id, saved.data.version, { ...house, rounds: [], picked: null, blueprint: null, characters: null, outline: null });
		if (!cleared.ok) throw new Error(cleared.error.message);
		expect(cleared.data.voices.some((v) => v.raycast_agent === TRAILER_HOUSE_AGENT)).toBeFalse();
	});

	test('the teaser must pass the Seedance linter; the retry message never names the banned word', () => {
		const banned = teaserLintIssue('Shot 1: Mara bares her fangs in the rain.', []);
		expect(banned).toContain('bans');
		expect(banned).not.toContain('fangs');
		expect(teaserLintIssue('@Image 1 defines Mara.', [])).toContain('@Image_1');
		expect(teaserLintIssue('@Image_1 defines Mara Voss exact identity. Mara Voss runs.', [])).toBeNull();
		expect(teaserLintIssue('A glitter storm.', ['glitter'])).toContain('bans');
	});
});
