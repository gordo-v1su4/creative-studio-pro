import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { cutsOf } from '../../src/lib/domain/cuts';
import { generateEffect, indexSfx, proposeEffects } from '../../src/lib/server/effects';
import type { AgentModelClient } from '../../src/lib/server/model-provider';
import type { SoundEffectGenerator } from '../../src/lib/server/higgsfield';
import type { ProductionAsset, StoryCard } from '../../src/lib/domain/schemas';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

/** A tiny silent WAV, enough to be a file in the effects folder. */
const wav = () => { const b = Buffer.alloc(44 + 800); b.write('RIFF', 0); b.writeUInt32LE(36 + 800, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(800, 40); return b; };

async function setup() {
	const root = await mkdtemp(join(tmpdir(), 'csp-fx-')); roots.push(root);
	const projectRoot = join(root, 'projects');
	const sfx = join(root, 'sfx');
	for (const path of ['FX/Risers/riser_long_up.wav', 'FX/Impacts/impact_heavy.wav', 'FX/Whooshes/whoosh_fast.wav', 'Loops/drum_loop_120.wav']) {
		await mkdir(join(sfx, ...path.split('/').slice(0, -1)), { recursive: true });
		await writeFile(join(sfx, ...path.split('/')), wav());
	}
	const store = new ProjectStore({ root: projectRoot });
	const gateway = new ProjectCommandGateway(store);
	const created = await gateway.createProject({ command: 'create_project', title: 'FX', brief: '', creative_focus: 'full room', created_by: 'gordo' });
	if (!created.ok) throw new Error(created.error.message);
	const id = created.data.project_id;
	const beat = (card_id: string, order: number): StoryCard => ({ card_id, order, title: card_id.toUpperCase(), beat: 'b', purpose: 'p', duration_ms: 2000, image_prompt: 'i', video_prompt: 'v', status: 'draft' });
	const take = (asset_id: string, card_id: string): ProductionAsset => ({ asset_id, card_id, kind: 'video', name: asset_id, mime_type: 'video/mp4', url: `/api/projects/${id}/files/${asset_id}.mp4`, created_at: '2026-10-01T00:00:00.000Z' });
	let p = await gateway.saveProduction({ command: 'save_production', project_id: id, expected_version: created.data.version, production: { status: 'draft', title: 'FX', logline: '', premise: '', theme: '', cards: [beat('a', 0), beat('b', 1)], assets: [take('ta', 'a'), take('tb', 'b')], updated_at: null } });
	if (!p.ok) throw new Error(p.error.message);
	p = await gateway.pushCut({ command: 'push_cut', project_id: id, expected_version: p.data.version, name: 'Trailer', entries: [{ card_id: 'a', asset_id: 'ta', in_s: 0, out_s: 2 }, { card_id: 'b', asset_id: 'tb', in_s: 0, out_s: 3 }] });
	if (!p.ok) throw new Error(p.error.message);
	const cutId = cutsOf(p.data.production)[0].cut_id;
	const locked = await gateway.handle({ command: 'lock_cut', project_id: id, expected_version: p.data.version, cut_id: cutId });
	if (!locked.ok) throw new Error('lock failed');
	return { root, projectRoot, sfx, store, gateway, id, cutId };
}

const fakeAgent = (answer: unknown): AgentModelClient & { prompts: string[] } => {
	const prompts: string[] = [];
	return { choice: { provider: 'custom', model: 'fake' } as AgentModelClient['choice'], prompts, async generate(input) { prompts.push(input.prompt); return JSON.stringify(answer); } };
};

describe('Agent effects pass (fake provider)', () => {
	test('the folder index keeps effects and leaves loops out', async () => {
		const { sfx } = await setup();
		expect((await indexSfx(sfx)).map((f) => [f.id, f.kind])).toEqual([['FX/Impacts/impact_heavy.wav', 'hit'], ['FX/Risers/riser_long_up.wav', 'riser'], ['FX/Whooshes/whoosh_fast.wav', 'whoosh']]);
	});

	test('proposals land as suggestions on the version, copied into the project; generate picks come back as offers', async () => {
		const { projectRoot, sfx, store, gateway, id, cutId } = await setup();
		const agent = fakeAgent({ effects: [
			{ moment_s: 2, sfx_id: 'FX/Whooshes/whoosh_fast.wav', reason: 'carry the cut' },
			{ moment_s: 2, sfx_id: 'Loops/drum_loop_120.wav', reason: 'not an effect' },
			{ moment_s: 2, generate: 'a deep sub drop', duration_s: 2, reason: 'nothing fits' }
		] });
		const result = await proposeEffects({ gateway, store, projectRoot }, agent, { projectId: id, cutId, version: 1, folder: sfx, rules: null });
		if (!result.ok) throw new Error(result.message);
		expect(agent.prompts[0]).toContain('"moment_s": 2');
		expect(agent.prompts[0]).not.toContain('drum_loop');
		const effects = cutsOf(result.project.production)[0].versions![0].sound!.effects;
		expect(effects).toHaveLength(1);
		expect(effects[0]).toMatchObject({ name: 'whoosh_fast.wav', suggested: true, note: 'carry the cut' });
		expect(await readdir(join(projectRoot, id, 'files', 'sound', 'sfx'))).toEqual(['FX__Whooshes__whoosh_fast.wav']);
		expect(result.offers).toEqual([{ moment_s: 2, prompt: 'a deep sub drop', duration_s: 2, at_s: 2, reason: 'nothing fits' }]);
		expect(result.dropped).toEqual(['not in the effects folder: Loops/drum_loop_120.wav']);

		// A second pass replaces the suggestions; a kept effect stays.
		const kept = { ...effects[0], suggested: false };
		const v = cutsOf(result.project.production)[0].versions![0].sound!;
		const keptSaved = await gateway.setSoundPlan({ command: 'set_sound_plan', project_id: id, expected_version: result.project.version, cut_id: cutId, version: 1, plan: { ...v, effects: [kept] } });
		if (!keptSaved.ok) throw new Error(keptSaved.error.message);
		const again = await proposeEffects({ gateway, store, projectRoot }, fakeAgent({ effects: [{ moment_s: 2, sfx_id: 'FX/Impacts/impact_heavy.wav', reason: 'hard cut' }] }), { projectId: id, cutId, version: 1, folder: sfx, rules: null });
		if (!again.ok) throw new Error(again.message);
		expect(cutsOf(again.project.production)[0].versions![0].sound!.effects.map((e) => [e.name, Boolean(e.suggested)])).toEqual([['whoosh_fast.wav', false], ['impact_heavy.wav', true]]);
	});

	test('generating an effect re-quotes, refuses a higher price before submitting, and adds the result kept', async () => {
		const { projectRoot, store, gateway, id, cutId } = await setup();
		const calls: string[] = [];
		const generator = (credits: number): SoundEffectGenerator => ({
			async estimate(r) { calls.push(`estimate ${r.duration_s}`); return { credits }; },
			async submit() { calls.push('submit'); return { job_id: 'job12345' }; },
			async status() { return { status: 'completed', url: 'https://cdn.example/fx/sub.mp3' }; }
		});
		const deps = { gateway, store, projectRoot, download: async () => new Uint8Array([1, 2, 3]), wait: async () => {} };
		const pricier = await generateEffect({ ...deps, generator: generator(1) }, { projectId: id, cutId, version: 1, prompt: 'a deep sub drop', duration_s: 2, at_s: 2, confirmed_credits: 0.5 });
		expect(pricier.ok).toBeFalse();
		expect(calls).toEqual(['estimate 2']);
		const made = await generateEffect({ ...deps, generator: generator(0.5) }, { projectId: id, cutId, version: 1, prompt: 'a deep sub drop', duration_s: 2, at_s: 2, confirmed_credits: 0.5 });
		if (!made.ok) throw new Error(made.message);
		expect(calls).toEqual(['estimate 2', 'estimate 2', 'submit']);
		const effect = cutsOf(made.project.production)[0].versions![0].sound!.effects[0];
		expect(effect).toMatchObject({ at_s: 2, note: 'generated: a deep sub drop' });
		expect(effect.suggested).toBeUndefined();
		expect(await readdir(join(projectRoot, id, 'files', 'sound', 'generated'))).toEqual(['job12345-a-deep-sub-drop.mp3']);
	});
});
