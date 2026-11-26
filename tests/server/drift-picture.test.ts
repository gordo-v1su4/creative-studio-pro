import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { SeriesStore, type SeriesRecord } from '../../src/lib/server/series';
import type { ReviewRoomClient } from '../../src/lib/server/review-room';
import type { ReferenceFileDeps } from '../../src/lib/server/reference-files';
import { createHiggsfieldUpscaler, type Upscaler } from '../../src/lib/server/higgsfield';
import { quoteUpscale, sendUpscaled, settleUpscale, startUpscale, type PictureDeps } from '../../src/lib/server/drift-picture';
import { checkDrift } from '../../src/lib/server/drift';
import type { NotionApi } from '../../src/lib/server/notion';
import type { NotionPage } from '../../src/lib/domain/notion-series';

/**
 * Drift 08 (GitHub #36 / V1S-512, ADR 0012): a Prep sheet under 2048 px is upscaled only after its price is shown and
 * the operator says yes to that price; the upscaled sheet is shown beside the original and sent to Review Room only
 * on a second yes. The upscaler (Higgsfield, spends credits) and Review Room are fakes that log every call.
 */

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const check = { ok: true, missing: [], wrongType: [], optionalMissing: [] };

function fakeUpscaler(price = 2) {
	const calls: string[] = [];
	let state: 'queued' | 'completed' | 'failed' = 'queued';
	const upscaler: Upscaler = {
		estimate: async () => { calls.push('estimate'); return { credits: price }; },
		submit: async (file) => { calls.push(`submit ${file.split('/').slice(-2).join('/')}`); return { job_id: 'job-up-1' }; },
		status: async (job) => { calls.push(`status ${job}`); return state === 'completed' ? { status: 'completed', url: 'https://cdn.example/hf_20261125_upscaled.png' } : state === 'failed' ? { status: 'failed', error: 'refused' } : { status: 'queued' }; }
	};
	return { upscaler, calls, finish: () => { state = 'completed'; }, failJob: () => { state = 'failed'; }, reprice: (next: number) => { price = next; } };
}

function fakeReviewRoom() {
	const calls: string[] = [];
	const client = {
		beginUpload: async (input: { assetCode: string; folderId: string }) => { calls.push(`begin ${input.assetCode} ${input.folderId}`); return { sessionId: 's', url: 'u', posterUrl: 'p', assetId: 'a-gym' }; },
		putSigned: async () => {}, completeUpload: async () => ({ assetId: 'a-gym', jobId: 'j' }), putMetadata: async () => {}, setCurrentVersion: async () => {},
		changes: async () => ({ cursor: '1', assets: [], versions: [{ versionId: 'v-gym', assetId: 'a-gym', version: 1, isCurrent: true, processingState: 'ready', mimeType: 'image/png', createdAt: 1 }], removedAssets: [] })
	} as unknown as ReviewRoomClient;
	return { client, calls };
}

/** TR110 with two small Prep sheets: Campus gym (in Notion) and Portland rooftops (not yet). */
async function setup() {
	const root = await mkdtemp(join(tmpdir(), 'csp-drift-picture-')); roots.push(root);
	const projectRoot = join(root, 'projects');
	const store = new ProjectStore({ root: projectRoot });
	const gateway = new ProjectCommandGateway(store);
	const series = new SeriesStore(join(root, 'series'));
	const created = await gateway.createProject({ command: 'create_project', title: 'TR110', brief: '', creative_focus: 'full room', created_by: 'test' });
	if (!created.ok) throw new Error(created.error.message);
	const id = created.data.project_id;
	const scene = (n: number, location: string) => ({ page_id: `s-${n}`, number: n, title: 'Scene', act: 'Act 1', summary: '', story_beats: '', dialogue: '', timecode: '', location, characters: [], group_id: 'g1', reference_ids: [], story_beat_ids: [], seconds: 0, shot_count: 0 });
	const imported = await gateway.importEpisode(id, created.data.version, {
		series: { series_id: 'ser1', episode_page_id: 'ep1', episode_number: 1, season: 1, episode_title: 'TR110', summary: '', twist: '', cliffhanger: '', imported_at: '2026-11-25T00:00:00.000Z', outline: '', scenes: [scene(10, 'Campus gym'), scene(20, 'Portland rooftops')] },
		groups: [{ group_id: 'g1', name: 'Scene', created_at: '2026-11-25T00:00:00.000Z' }], cards: [], title: 'TR110', logline: ''
	});
	if (!imported.ok) throw new Error(imported.error.message);
	const made = join(projectRoot, id, 'files', 'prep', 'references');
	await mkdir(made, { recursive: true });
	await writeFile(join(made, 'Campus_gym_sheet.png'), 'small gym');
	await writeFile(join(made, 'Portland_rooftops_sheet.png'), 'small roofs');
	const result = (file: string) => ({ file: `files/prep/references/${file}`, url: `/api/projects/${id}/files/prep/references/${file}`, made_at: '2026-11-20T00:00:00.000Z', outside: false, uploaded: false, note: 'The image is 1678×937; references must be at least 2048 px on the long edge' });
	await writeFile(join(projectRoot, id, 'prep.json'), JSON.stringify({ schema_version: 1, props: [], entries: { 'rgym': { result: result('Campus_gym_sheet.png') }, 'location:Portland rooftops': { result: result('Portland_rooftops_sheet.png') } } }));
	const record: SeriesRecord = {
		schema_version: 1, series_id: 'ser1', title: 'Blood Rush', notion_root_id: 'ser1',
		sources: { episodes: 'src-ep', scenes: 'src-sc', shots: 'src-sh' }, checks: { episodes: check, scenes: check, shots: check }, story: null,
		episodes: [{ page_id: 'ep1', number: 1, title: 'TR110', status: '', act: '', season: 1, summary: '', twist: '', cliffhanger: '', scene_ids: ['s-10', 's-20'], scene_count: 2 }],
		references: { database: 'db-refs', source: 'src-refs', check, items: [{ page_id: 'rgym', name: 'Campus gym', kind: 'Location', role: '', handles: [], file_name: '', name_on_sheet: false, scene_ids: [] }] },
		runtime_min: 10, episode_projects: { ep1: id }, show_code: 'BLR',
		review_room: { project_id: 'rr1', folders: { 'refs:characters': 'f-chr', 'refs:locations': 'f-loc', 'refs:props': 'f-prp' }, synced_at: null },
		checked_at: '2026-11-25T00:00:00.000Z', created_at: '2026-11-25T00:00:00.000Z'
	};
	await series.write(record);
	const up = fakeUpscaler();
	const room = fakeReviewRoom();
	const sizes: Record<string, { width: number; height: number }> = { 'Campus_gym_sheet.png': { width: 1678, height: 937 }, 'Portland_rooftops_sheet.png': { width: 1344, height: 752 }, 'hf_20261125_upscaled.png': { width: 2048, height: 1144 } };
	const probe = async (file: string) => sizes[file.split('/').at(-1)!] ?? { width: 2048, height: 1144 };
	const references: ReferenceFileDeps = { client: room.client, store: series, cacheDir: join(root, 'cache'), sourceDir: join(root, 'sources'), probe, poster: async (_input, output) => { await writeFile(output, 'jpg'); } };
	const downloads: string[] = [];
	const deps: PictureDeps = { store, gateway, projectRoot, series, upscaler: up.upscaler, probe, references, download: async (url) => { downloads.push(url); return new TextEncoder().encode('upscaled gym'); } };
	const project = async () => (await store.readProject(id))!;
	return { deps, up, room, downloads, project, id, projectRoot };
}

describe('upscaling an undersized picture (Drift 08)', () => {
	test('the price is shown first: quoting asks the upscaler for a price and spends, submits and uploads nothing', async () => {
		const { deps, up, room, project } = await setup();
		const quoted = await quoteUpscale(deps, await project(), 'rgym');
		if (!quoted.ok) throw new Error(quoted.message);
		expect(quoted.quote).toMatchObject({ credits: 2, width: 1678, height: 937, long_edge: 2048 });
		expect(up.calls).toEqual(['estimate']);
		expect(room.calls).toEqual([]);
		expect((await project()).production.still_sends ?? []).toEqual([]);
	});

	test('an upscale without a yes to the price as it is now is refused before any spend', async () => {
		const { deps, up, project } = await setup();
		up.reprice(3);
		const refused = await startUpscale(deps, await project(), 'rgym', { confirmed_credits: 2 });
		expect(refused).toMatchObject({ ok: false, status: 422 });
		expect(up.calls).toEqual(['estimate']);
		expect((await project()).production.still_sends ?? []).toEqual([]);
	});

	test('a yes to the price sends one upscale of the Prep sheet, logs its credits, and a second press does not send again', async () => {
		const { deps, up, project } = await setup();
		const started = await startUpscale(deps, await project(), 'rgym', { confirmed_credits: 2 });
		if (!started.ok) throw new Error(started.message);
		expect(started.job_id).toBe('job-up-1');
		expect(up.calls).toEqual(['estimate', 'submit references/Campus_gym_sheet.png']);
		expect((await project()).production.still_sends).toEqual([expect.objectContaining({ job_id: 'job-up-1', purpose: 'reference', credits: 2, references: ['Campus gym'] })]);
		expect(await startUpscale(deps, await project(), 'rgym', { confirmed_credits: 2 })).toMatchObject({ ok: false, status: 409 });
		expect(up.calls.filter((call) => call.startsWith('submit'))).toHaveLength(1);
	});

	test('the upscaled sheet comes back beside the original and is not sent: Review Room is not touched', async () => {
		const { deps, up, room, downloads, project, projectRoot, id } = await setup();
		await startUpscale(deps, await project(), 'rgym', { confirmed_credits: 2 });
		expect(await settleUpscale(deps, await project(), 'rgym')).toEqual({ ok: true, pending: true });
		up.finish();
		const settled = await settleUpscale(deps, await project(), 'rgym');
		if (!settled.ok || settled.pending) throw new Error('not settled');
		expect(settled.original).toEqual({ url: expect.stringContaining(`/api/projects/${id}/files/prep/references/Campus_gym_sheet.png`), width: 1678, height: 937 });
		// The downloaded file keeps its Higgsfield name.
		expect(settled.upscaled).toEqual({ url: `/api/projects/${id}/files/prep/upscaled/hf_20261125_upscaled.png`, width: 2048, height: 1144 });
		expect(await readFile(join(projectRoot, id, 'files', 'prep', 'upscaled', 'hf_20261125_upscaled.png'), 'utf8')).toBe('upscaled gym');
		expect(downloads).toEqual(['https://cdn.example/hf_20261125_upscaled.png']);
		expect(room.calls).toEqual([]);
		// The original stays as it was.
		expect(await readFile(join(projectRoot, id, 'files', 'prep', 'references', 'Campus_gym_sheet.png'), 'utf8')).toBe('small gym');
	});

	test('a failed upscale says why and can be asked again', async () => {
		const { deps, up, project } = await setup();
		await startUpscale(deps, await project(), 'rgym', { confirmed_credits: 2 });
		up.failJob();
		expect(await settleUpscale(deps, await project(), 'rgym')).toMatchObject({ ok: false, status: 502, message: expect.stringContaining('refused') });
		expect((await startUpscale(deps, await project(), 'rgym', { confirmed_credits: 2 })).ok).toBeTrue();
	});

	test('a hiccup asking Higgsfield keeps the paid job; an upscale already back is not paid for again', async () => {
		const { deps, up, project } = await setup();
		await startUpscale(deps, await project(), 'rgym', { confirmed_credits: 2 });
		const status = deps.upscaler!.status;
		deps.upscaler!.status = async () => { throw new Error('network down'); };
		expect(await settleUpscale(deps, await project(), 'rgym')).toMatchObject({ ok: false, status: 502 });
		deps.upscaler!.status = status;
		up.finish();
		expect((await settleUpscale(deps, await project(), 'rgym')).ok).toBeTrue();
		expect(await startUpscale(deps, await project(), 'rgym', { confirmed_credits: 2 })).toMatchObject({ ok: false, status: 409 });
		expect(up.calls.filter((call) => call.startsWith('submit'))).toHaveLength(1);
	});

	test('sending the upscaled sheet, on its own yes, uploads it under the Notion name and marks the Prep sheet as in Review Room', async () => {
		const { deps, up, room, project, id } = await setup();
		await startUpscale(deps, await project(), 'rgym', { confirmed_credits: 2 });
		up.finish();
		await settleUpscale(deps, await project(), 'rgym');
		const sent = await sendUpscaled(deps, await project(), 'rgym');
		if (!sent.ok) throw new Error(sent.message);
		expect(room.calls).toEqual(['begin BLR_REF_LOC_CAMPUS_GYM f-loc']);
		const state = sent.prep.entries['rgym'];
		expect(state.result).toMatchObject({ uploaded: true, url: `/api/projects/${id}/files/prep/upscaled/hf_20261125_upscaled.png` });
		expect(state.upscale).toMatchObject({ sent: true });
	});

	test('a reference not yet in Notion can be upscaled, but its sheet waits for Notion before it is sent', async () => {
		const { deps, up, room, project } = await setup();
		const key = 'location:Portland rooftops';
		await startUpscale(deps, await project(), key, { confirmed_credits: 2 });
		up.finish();
		await settleUpscale(deps, await project(), key);
		expect(await sendUpscaled(deps, await project(), key)).toMatchObject({ ok: false, status: 409, message: expect.stringContaining('Notion') });
		expect(room.calls).toEqual([]);
	});

	test('nothing is sent before an upscaled sheet has come back', async () => {
		const { deps, room, project } = await setup();
		expect(await sendUpscaled(deps, await project(), 'rgym')).toMatchObject({ ok: false, status: 409 });
		expect(room.calls).toEqual([]);
	});

	test('a sheet at 2048 px needs no upscale', async () => {
		const { deps, up, project } = await setup();
		deps.probe = async () => ({ width: 2048, height: 1143 });
		expect(await quoteUpscale(deps, await project(), 'rgym')).toMatchObject({ ok: false, status: 400 });
		expect(up.calls).toEqual([]);
	});
});

describe('the drift check reads each Prep sheet\'s size', () => {
	test('a small sheet not yet in Review Room is a picture item; the check still writes nothing', async () => {
		const { deps, project, projectRoot, id } = await setup();
		const page = (pid: string, name: string): NotionPage => ({ id: pid, properties: { Name: { type: 'title', title: [{ plain_text: name }] }, Kind: { type: 'select', select: { name: 'Location' } } } as NotionPage['properties'] });
		const notion = { query: async () => ({ results: [page('rgym', 'Campus gym')], next_cursor: null, has_more: false }) } as unknown as NotionApi;
		const before = await readFile(join(projectRoot, id, 'prep.json'), 'utf8');
		const checked = await checkDrift({ ...deps, notion, client: null }, await project());
		if (!checked.ok) throw new Error(checked.message);
		const pictures = checked.report.items.filter((item) => item.type === 'picture_too_small');
		expect(pictures.map((item) => [item.name, item.picture?.width, item.picture?.height, item.picture?.reference_page_id])).toEqual([['Campus gym', 1678, 937, 'rgym'], ['Portland rooftops', 1344, 752, null]]);
		expect(await readFile(join(projectRoot, id, 'prep.json'), 'utf8')).toBe(before);
	});

	test('a reference the series already has a Review Room sheet for gives no picture item, even with Review Room not read', async () => {
		const { deps, project } = await setup();
		await deps.series.update('ser1', (record) => ({ ...record, reference_files: { rgym: { asset_id: 'a', version_id: 'v', version: 1, code: 'BLR_REF_LOC_CAMPUS_GYM', file_name: 'Campus_gym_sheet.png', mime_type: 'image/png', width: 2048, height: 1144, uploaded_at: '2026-11-01T00:00:00.000Z' } } }));
		const page = (pid: string, name: string): NotionPage => ({ id: pid, properties: { Name: { type: 'title', title: [{ plain_text: name }] }, Kind: { type: 'select', select: { name: 'Location' } } } as NotionPage['properties'] });
		const notion = { query: async () => ({ results: [page('rgym', 'Campus gym')], next_cursor: null, has_more: false }) } as unknown as NotionApi;
		const checked = await checkDrift({ ...deps, notion, client: null }, await project());
		if (!checked.ok) throw new Error(checked.message);
		expect(checked.report.items.filter((item) => item.type === 'picture_too_small').map((item) => item.name)).toEqual(['Portland rooftops']);
	});
});

describe('the Higgsfield upscaler', () => {
	test('prices a 2K upscale without the image, and sends the sheet by its upload id', async () => {
		const calls: string[][] = [];
		const run = async (args: string[]) => {
			calls.push(args);
			if (args[0] === 'upload') return { id: '11111111-2222-3333-4444-555555555555' };
			if (args[1] === 'cost') return { credits: 2 };
			if (args[1] === 'create') return { id: 'job-9' };
			return { status: 'completed', result_url: 'https://cdn.example/x.png' };
		};
		const upscaler = createHiggsfieldUpscaler(run);
		expect(await upscaler.estimate()).toEqual({ credits: 2 });
		expect(calls[0]).toEqual(['generate', 'cost', 'bytedance_image_upscale', '--resolution', '2k', '--image-references', '00000000-0000-0000-0000-000000000000']);
		expect(await upscaler.submit('/tmp/sheet.png')).toEqual({ job_id: 'job-9' });
		expect(calls.slice(1)).toEqual([['upload', 'create', '/tmp/sheet.png'], ['generate', 'create', 'bytedance_image_upscale', '--resolution', '2k', '--image-references', '11111111-2222-3333-4444-555555555555']]);
		expect(await upscaler.status('job-9')).toEqual({ status: 'completed', url: 'https://cdn.example/x.png', error: undefined });
	});
});
