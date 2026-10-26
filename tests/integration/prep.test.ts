import { handOffLine, referenceSpecSchema } from '../../src/lib/domain/prep';
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'bun:test';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { SeriesStore } from '../../src/lib/server/series';
import type { AgentModelClient } from '../../src/lib/server/model-provider';
import { uploadReferences, type GenerationStatus, type StillRequest } from '../../src/lib/server/higgsfield';
import { addSource, aspectOf, draftSpec, removeSource, prepQc, prepView, quotePrep, saveSpec, sendPrep, setBodySource, setImageModel, settlePrep, writePrompt, type PrepDeps } from '../../src/lib/server/prep';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const SPEC = { name: 'x', kind: 'character', template: 'T1', identity: { sex: 'female', age: 19, height_cm: 168, build: 'slim', face: 'pale, watchful', eyes: 'amber-gold eyes', hair: 'dark bob', marks: 'cross choker' } };
/** The hand-off line the app builds for that spec (the prompt must end with it). */
const HAND_OFF = handOffLine(referenceSpecSchema.parse({ ...SPEC, name: 'Mara Voss' }));
const PROMPT = 'Create a photorealistic character key art plate: ONE character, Mara Voss, shown in three panels on a near-white seamless studio backdrop. PANEL LEFT: tight close-up of the head and upper shoulders, straight-on, face square to the camera, looking directly into the lens. PANEL CENTRE: front at full-person scale, head omitted above the collarbones, empty background above the shoulders. She is 168 cm tall.\nGRADE: full natural colour, gently muted, one amber accent.\nCAMERA: 100mm, chest height, straight on.\nREALISM: real skin pores, real fabric.\nLOCKS: same person in all three panels.\nAVOID: fangs, leg lengthening, text, watermark.\n' + HAND_OFF;

async function setup() {
	const root = await mkdtemp(join(tmpdir(), 'csp-prep-')); roots.push(root);
	const projectRoot = join(root, 'projects');
	const store = new ProjectStore({ root: projectRoot });
	const gateway = new ProjectCommandGateway(store);
	const series = new SeriesStore(join(root, 'series'));
	const created = await gateway.createProject({ command: 'create_project', title: 'Prep', brief: '', creative_focus: 'full room', created_by: 'gordo' });
	if (!created.ok) throw new Error(created.error.message);
	const seriesId = 'ser1';
	const imported = await gateway.importEpisode(created.data.project_id, created.data.version, {
		series: { series_id: seriesId, episode_page_id: 'ep1', episode_number: 1, season: 1, episode_title: 'Pilot', summary: '', twist: '', cliffhanger: '', imported_at: '2026-10-25T00:00:00.000Z', outline: '',
			scenes: [{ page_id: 's1', number: 10, title: 'Dorm', act: 'Act 1', summary: 'Mara writes in her notebook.', story_beats: 'Mara writes.', dialogue: '', timecode: '', location: "Mara's dorm room", characters: ['Mara'], group_id: 'g1', reference_ids: [], story_beat_ids: [], seconds: 0, shot_count: 0 }] },
		groups: [{ group_id: 'g1', name: 'Dorm', created_at: '2026-10-25T00:00:00.000Z' }], cards: [], title: 'Pilot', logline: ''
	});
	if (!imported.ok) throw new Error(imported.error.message);
	await series.write({ schema_version: 1, series_id: seriesId, title: 'Blood Rush', notion_root_id: 'root', sources: { episodes: null, scenes: null, shots: null },
		checks: { episodes: { ok: true, missing: [], wrongType: [], optionalMissing: [] }, scenes: { ok: true, missing: [], wrongType: [], optionalMissing: [] }, shots: { ok: true, missing: [], wrongType: [], optionalMissing: [] } },
		story: { page_id: 'story', title: 'Story', text: 'Look: anamorphic lens, light haze.' }, episodes: [], runtime_min: 10, episode_projects: { ep1: created.data.project_id },
		references: { database: null, source: null, check: null, items: [{ page_id: 'r-mara', name: 'Mara Voss', kind: 'Character', role: 'a freshman', handles: ['@Mara'], file_name: 'Mara_Voss.png', name_on_sheet: true, scene_ids: ['s1'] }] },
		checked_at: '2026-10-25T00:00:00.000Z', created_at: '2026-10-25T00:00:00.000Z' } as never);
	const asks: string[] = [];
	let status: GenerationStatus = 'queued';
	const submitted: StillRequest[] = [];
	const estimated: StillRequest[] = [];
	const agent: AgentModelClient = { choice: { provider: 'kimi', model: 'k3' } as never, generate: async ({ prompt }) => { asks.push(prompt); return prompt.includes('THE FACTS (what the pictures cannot say)') ? JSON.stringify({ prompt: PROMPT }) : JSON.stringify(SPEC); } };
	const deps: PrepDeps = {
		store, gateway, projectRoot, series, references: null, notion: null,
		images: { estimate: async (request) => { estimated.push(request); return { credits: 2.75 }; }, submit: async (request) => { submitted.push(request); return { job_id: 'job-ref-1' }; }, status: async () => ({ status, url: status === 'completed' ? 'https://files.test/ref.png' : undefined }) },
		download: async () => new Uint8Array([137, 80, 78, 71]), agent: async () => agent,
		stamp: async (file, _name, out) => { await copyFile(file, out).catch(async () => { const { mkdir } = await import('node:fs/promises'); await mkdir(join(out, '..'), { recursive: true }); await copyFile(file, out); }); return out; }
	};
	return { deps, projectId: created.data.project_id, asks, submitted, estimated, setStatus: (next: GenerationStatus) => { status = next; } };
}

describe('references go up before the job (CLI upload fix)', () => {
	test('local files are uploaded with one retry and passed by id; ids pass through', async () => {
		const calls: string[][] = [];
		let failures = 1;
		const run = async (args: string[]) => {
			calls.push(args);
			if (args[0] === 'upload') {
				if (failures-- > 0) throw new Error('SignatureDoesNotMatch');
				return { id: '471f5554-ee1b-4573-ac3e-19157f6c7e3a' };
			}
			return {};
		};
		const ids = await uploadReferences(run, ['C:/refs/kai.png', '11111111-2222-3333-4444-555555555555']);
		expect(ids).toEqual(['471f5554-ee1b-4573-ac3e-19157f6c7e3a', '11111111-2222-3333-4444-555555555555']);
		expect(calls).toEqual([['upload', 'create', 'C:/refs/kai.png'], ['upload', 'create', 'C:/refs/kai.png']]);
		const dead = async () => { throw new Error('SignatureDoesNotMatch'); };
		expect(uploadReferences(dead, ['C:/refs/kai.png'])).rejects.toThrow('Uploading a reference failed');
	});
});

describe('Prep end to end against fakes (V1S-374)', () => {
	test('model selection persists, prices and sends the selected model, and rejects a stale approval', async () => {
		const { deps, projectId, submitted, estimated } = await setup();
		const project = async () => (await deps.store.readProject(projectId))!;
		await draftSpec(deps, await project(), 'r-mara');
		await writePrompt(deps, await project(), 'r-mara');
		const before = await quotePrep(deps, await project(), 'r-mara');
		if (!before.ok) throw new Error(before.message);
		const changed = await setImageModel(deps, await project(), 'r-mara', 'nano_banana_pro');
		if (!changed.ok) throw new Error(changed.message);
		expect(changed.prep.entries['r-mara'].prompt).toBe(PROMPT);
		const view = await prepView(deps, await project());
		if (!view.ok) throw new Error(view.message);
		expect(view.items[0].state.image_model).toBe('nano_banana_pro');
		const stale = await sendPrep(deps, await project(), 'r-mara', { approval_key: before.approval.approval_key, confirmed_credits: 2.75 });
		expect(stale.ok).toBeFalse();
		expect(submitted).toHaveLength(0);
		const after = await quotePrep(deps, await project(), 'r-mara');
		if (!after.ok) throw new Error(after.message);
		expect(after.approval.model).toBe('Nano Banana Pro');
		expect(after.approval.aspect_ratio).toBe('16:9');
		expect(estimated.at(-1)?.model).toBe('nano_banana_pro');
		expect(estimated.at(-1)?.aspect_ratio).toBe('16:9');
		const sent = await sendPrep(deps, await project(), 'r-mara', { approval_key: after.approval.approval_key, confirmed_credits: 2.75 });
		expect(sent.ok).toBeTrue();
		expect(submitted[0].model).toBe('nano_banana_pro');
		expect(submitted[0].aspect_ratio).toBe('16:9');
		expect((await project()).production.still_sends?.[0].model).toBe('nano_banana_pro');
		expect((await setImageModel(deps, await project(), 'r-mara', 'gpt_image_2_5')).ok).toBeFalse();
	});
	test('an explicit original body omits physique facts and blocks their reintroduction, while portraits keep the design path', async () => {
		const { deps, projectId, asks } = await setup();
		const project = async () => (await deps.store.readProject(projectId))!;
		await draftSpec(deps, await project(), 'r-mara');
		const added = await addSource(deps, projectId, 'r-mara', { file_name: 'original.png', bytes: new Uint8Array([1, 2, 3]) });
		if (!added.ok) throw new Error(added.message);
		const url = added.prep.entries['r-mara'].sources[0].url;
		// Attaching an image does not claim that a portrait supplies a body.
		expect(added.prep.entries['r-mara'].body_source_url).toBeNull();
		expect((await setBodySource(deps, projectId, 'r-mara', '/some-other-source')).ok).toBeFalse();
		await setBodySource(deps, projectId, 'r-mara', url);
		const spec = referenceSpecSchema.parse({ ...SPEC, name: 'Mara Voss' });
		const handoff = handOffLine(spec, true);
		const corrected = PROMPT.replace(' She is 168 cm tall.', '').replace(HAND_OFF, handoff) + '\nImage 1 controls the body. Match the body shape and proportions exactly like image 1.';
		deps.agent = async () => ({ choice: { provider: 'kimi', model: 'k3' } as never, generate: async ({ prompt }) => { asks.push(prompt); return JSON.stringify({ prompt: corrected }); } });
		await saveSpec(deps, await project(), 'r-mara', { spec: { ...spec, identity: { ...spec.identity!, height_cm: null, build: '' } }, approve: false });
		const written = await writePrompt(deps, await project(), 'r-mara');
		expect(written.ok).toBeTrue();
		expect(asks.at(-1)).not.toContain('168 cm');
		expect(asks.at(-1)).not.toContain('slim');
		expect(asks.at(-1)).toContain('image 1 is the sole body baseline');
		expect(asks.at(-1)).toContain('without enlarging the body or moving it upward');
		expect(asks.at(-1)).toContain('Leave empty background above the shoulders');
		const view = await prepView(deps, await project());
		if (!view.ok) throw new Error(view.message);
		expect(prepQc(corrected, view.items[0])).toEqual([]);
		for (const description of ['168 cm', 'slim', 'tall', 'skinny', 'athletic']) expect(prepQc(corrected + '\nSUBJECT: ' + description, view.items[0]).join(' ')).toContain('remove height, build and figure');
		const quoted = await quotePrep(deps, await project(), 'r-mara');
		expect(quoted.ok && quoted.approval.blocked).toEqual([]);
		await removeSource(deps, projectId, 'r-mara', url);
		const removed = await prepView(deps, await project());
		expect(removed.ok && removed.items[0].state.body_source_url).toBeNull();
		expect(removed.ok && removed.items[0].state.prompt).toBeNull();
	});

	test('facts → prompt in one pass → approval card → make → stamped sheet', async () => {
		const { deps, projectId, asks, submitted, setStatus } = await setup();
		const project = async () => (await deps.store.readProject(projectId))!;
		const listed = await prepView(deps, await project());
		if (!listed.ok) throw new Error(listed.message);
		expect(listed.items.map((item) => [item.entry.name, item.entry.reference_page_id, item.template])).toEqual([['Mara Voss', 'r-mara', 'T1'], ["Mara's dorm room", null, 'W3']]);

		// No prompt before the facts exist.
		expect((await writePrompt(deps, await project(), 'r-mara')).ok).toBeFalse();
		// The Agent drafts the facts only (never a description of the pictures); the exact name and template are the app's.
		const drafted = await draftSpec(deps, await project(), 'r-mara');
		if (!drafted.ok) throw new Error(drafted.message);
		expect([drafted.spec.name, drafted.spec.kind, drafted.spec.template, drafted.spec.description, drafted.spec.must_hold]).toEqual(['Mara Voss', 'character', 'T1', '', []]);
		expect(asks[0]).toContain('Draft the FACTS');
		// A character missing age or height cannot be written.
		await saveSpec(deps, await project(), 'r-mara', { spec: { ...drafted.spec, identity: { ...drafted.spec.identity!, height_cm: null } }, approve: false });
		const gap = await writePrompt(deps, await project(), 'r-mara');
		expect(gap.ok === false && gap.message).toContain('height (cm)');
		// No spec approval: the facts complete, the prompt is written in one pass, the price card is the approval.
		await saveSpec(deps, await project(), 'r-mara', { spec: drafted.spec, approve: false });
		const written = await writePrompt(deps, await project(), 'r-mara');
		if (!written.ok) throw new Error(written.message);
		expect(asks.at(-1)).toContain('straight-on face close-up');
		expect(asks.at(-1)).toContain('IDENTITY: female, 19, 168 cm, slim');

		const quoted = await quotePrep(deps, await project(), 'r-mara');
		if (!quoted.ok) throw new Error(quoted.message);
		expect([quoted.approval.blocked, quoted.approval.credits, quoted.approval.aspect_ratio]).toEqual([[], 2.75, '16:9']);
		const sent = await sendPrep(deps, await project(), 'r-mara', { approval_key: quoted.approval.approval_key, confirmed_credits: 2.75 });
		if (!sent.ok) throw new Error(sent.message);
		expect(submitted[0]).toEqual({ prompt: PROMPT, references: [], aspect_ratio: '16:9', model: 'gpt_image_2_5' });
		expect((await project()).production.still_sends?.map((s) => [s.purpose, s.credits])).toEqual([['reference', 2.75]]);

		expect(await settlePrep(deps, await project(), 'r-mara')).toEqual({ ok: true, pending: true });
		setStatus('completed');
		const settled = await settlePrep(deps, await project(), 'r-mara');
		if (!settled.ok || settled.pending) throw new Error('not settled');
		const result = settled.prep.entries['r-mara'].result!;
		expect(result.url).toBe(`/api/projects/${projectId}/files/prep/references/Mara_Voss_sheet.png`);
		expect(result.note).toContain('Review Room is not configured');
		expect(await readFile(result.file)).toEqual(Buffer.from([137, 80, 78, 71]));
	});

	test('a source image switches the template to T5a, keeps the spec, and must be named in the prompt', async () => {
		const { deps, projectId } = await setup();
		const project = async () => (await deps.store.readProject(projectId))!;
		await draftSpec(deps, await project(), 'r-mara');
		const added = await addSource(deps, projectId, 'r-mara', { file_name: 'old-sheet.png', bytes: new Uint8Array([1, 2, 3]) });
		if (!added.ok) throw new Error(added.message);
		// The spec stays when images change (Redraft gives a fresh one); only the prompt is rewritten.
		expect(added.prep.entries['r-mara'].spec).not.toBeNull();
		expect(added.prep.entries['r-mara'].prompt).toBeNull();
		const listed = await prepView(deps, await project());
		const view = listed.ok ? listed.items[0] : null;
		expect(view?.template).toBe('T5a');
		expect(prepQc(PROMPT, view!).join(' ')).toContain('never names "image 1"');
		expect(prepQc(PROMPT.replace('Mara Voss', 'Mara'), view!).join(' ')).toContain('exact name');
		expect(prepQc(PROMPT.replace(/\nAVOID:[^\n]*/, ''), view!).join(' ')).toContain('The AVOID section is missing');
		expect(prepQc(PROMPT.replace('full natural colour', 'desaturated near-monochrome'), view!).join(' ')).toContain('full natural colour');
		expect(prepQc(PROMPT.replace('fangs, ', ''), view!).join(' ')).toContain('Fangs must be listed under AVOID');
		expect(prepQc(PROMPT.replace(' She is 168 cm tall.', '').replace(HAND_OFF, ''), view!).join(' ')).toContain('true height');
		expect(prepQc(PROMPT.replace('168 cm tall', '168 cm (5\'6") tall'), view!).join(' ')).toContain('cm only');
		expect(prepQc(PROMPT.replace('168 cm tall', '1.68 m tall'), view!).join(' ')).toContain('cm only');
		expect(prepQc(PROMPT.replace('collarbones', 'chin'), view!).join(' ')).toContain('collarbones');
		expect(prepQc(PROMPT.replace(HAND_OFF, ''), view!).join(' ')).toContain('CHARACTER hand-off line');
		expect(prepQc(PROMPT.replace('near-white seamless studio backdrop', 'rainy street at night'), view!).join(' ')).toContain('near-white seamless studio backdrop');
		// Two images: each needs its named job ("Image N controls …"), which the writer decides by looking at them.
		const second = await addSource(deps, projectId, 'r-mara', { file_name: 'body.png', bytes: new Uint8Array([4, 5, 6]) });
		if (!second.ok) throw new Error(second.message);
		const two = await prepView(deps, await project());
		const twoView = two.ok ? two.items[0] : null;
		const named = PROMPT.replace('Create a', 'Using image 1 and image 2, create a');
		expect(prepQc(named, twoView!).join(' ')).toContain('Image N controls');
		expect(prepQc(named.replace('Using', 'Image 1 controls the face; image 2 controls the body. Using'), twoView!).join(' ')).not.toContain('Image N controls');
		await removeSource(deps, projectId, 'r-mara', second.prep.entries['r-mara'].sources[1].url);
		// Removing the source takes it (and its copy) off the entry and back to T1, spec cleared.
		const removed = await removeSource(deps, projectId, 'r-mara', added.prep.entries['r-mara'].sources[0].url);
		if (!removed.ok) throw new Error(removed.message);
		expect(removed.prep.entries['r-mara'].sources).toEqual([]);
		expect(existsSync(added.prep.entries['r-mara'].sources[0].file)).toBeFalse();
		expect((await removeSource(deps, projectId, 'r-mara', 'nope')).ok).toBeFalse();
		expect(prepQc(`${PROMPT} image 1 neon glow`, view!).join(' ')).toContain('"neon"');
		// The skill's SETTINGS line names the canvas; without one the kind's default applies.
		// Character sheets are always 16:9 (the drawer's headshot frame); other kinds take the skill's SETTINGS aspect.
		expect(aspectOf(`${PROMPT}\nSETTINGS: GPT Image 2.5, 3:2 landscape, high quality.`, 'character')).toBe('16:9');
		expect(aspectOf('SETTINGS: GPT Image 2.5, 3:2 landscape.', 'location')).toBe('3:2');
		expect(aspectOf(PROMPT, 'character')).toBe('16:9');
	});
});
