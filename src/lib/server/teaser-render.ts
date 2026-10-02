import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SeedanceRequest } from '$lib/domain/animate';
import type { Project, TeaserRender, TrailerHouse } from '$lib/domain/schemas';
import { uuid7ish } from '$lib/domain/ids';
import type { AnimateDeps } from '$lib/server/animate';
import { lintTeaser } from '$lib/server/trailer-house';
import { bannedTerms } from '$lib/domain/brief-rules';
import { projectRules } from '$lib/server/animate';
import { groupsOf } from '$lib/domain/groups';

/**
 * Teaser renders (Trailer House → Seedance → back): the picked pitch's Seedance prompt goes to the chosen
 * model through the Higgsfield CLI, with the main character's reference image attached when there is one.
 * Always priced first and sent only for the price the operator confirmed; a Seedance 2.5 480p render is a
 * draft (finalizable to 1080p from the same render for seven days). The finished clip comes back into the
 * project files, and the operator can add it to the board as a take.
 */

export interface RenderSettings { resolution: '480p' | '720p' | '1080p'; generate_audio: boolean }
type Failure = { ok: false; status: number; message: string };
const failure = (status: number, message: string): Failure => ({ ok: false, status, message });
const folder = (root: string, projectId: string) => join(root, projectId, 'files', 'trailer-house');

/** The Seedance request for the current teaser. */
export function teaserRequest(house: TrailerHouse, settings: RenderSettings, characterImagePath: string | null): SeedanceRequest {
	const v25 = house.target.model === 'seedance-2.5';
	return {
		prompt: house.blueprint!.seedance_prompt,
		duration: house.target.seconds,
		resolution: settings.resolution,
		generate_audio: settings.generate_audio,
		job_type: v25 ? 'seedance_2_5' : 'seedance_2_0',
		aspect_ratio: house.target.aspect === 'adaptive' ? 'auto' : house.target.aspect,
		draft: v25 && settings.resolution === '480p',
		...(characterImagePath ? { image_references: [characterImagePath] } : {})
	};
}

/** What must be true before money can move: a teaser, a clean lint, and a configured generator. */
async function ready(deps: AnimateDeps, project: Project, settings: RenderSettings): Promise<{ ok: true; request: SeedanceRequest } | Failure> {
	const house = project.trailer_house;
	if (!house?.blueprint) return failure(400, 'Write the teaser first');
	if (!deps.generator) return failure(503, 'The Higgsfield CLI is not installed on this machine');
	const banned = bannedTerms(await projectRules(deps.projectRoot, project.project_id));
	const errors = lintTeaser(house.blueprint.seedance_prompt, banned).filter((issue) => issue.severity === 'error');
	if (errors.length) return failure(422, `The Seedance prompt still has ${errors.length} lint error${errors.length === 1 ? '' : 's'}; let the Agent fix them first`);
	const image = house.character_image ? join(folder(deps.projectRoot, project.project_id), house.character_image.file) : null;
	return { ok: true, request: teaserRequest(house, settings, image) };
}

export async function quoteTeaser(deps: AnimateDeps, project: Project, settings: RenderSettings): Promise<{ ok: true; credits: number; balance: number | null; draft: boolean } | Failure> {
	const prepared = await ready(deps, project, settings);
	if (!prepared.ok) return prepared;
	try {
		const { credits } = await deps.generator!.estimate(prepared.request);
		const balance = await deps.generator!.balance().catch(() => null);
		return { ok: true, credits, balance: balance?.credits ?? null, draft: Boolean(prepared.request.draft) };
	} catch (cause) {
		return failure(502, cause instanceof Error ? cause.message : 'Price check failed');
	}
}

/** Send for exactly the confirmed price (re-priced here; a changed price is refused, nothing is spent). */
export async function sendTeaser(deps: AnimateDeps, input: { project_id: string; expected_version: number; settings: RenderSettings; confirmed_credits: number }): Promise<{ ok: true; project: Project } | Failure> {
	const project = await deps.store.readProject(input.project_id);
	if (!project) return failure(404, 'Project not found');
	if (project.version !== input.expected_version) return failure(409, 'The project changed; reload and try again');
	const prepared = await ready(deps, project, input.settings);
	if (!prepared.ok) return prepared;
	let credits: number;
	try { ({ credits } = await deps.generator!.estimate(prepared.request)); }
	catch (cause) { return failure(502, cause instanceof Error ? cause.message : 'Price check failed'); }
	if (credits !== input.confirmed_credits) return failure(409, `The price changed to ${credits} credits; confirm again`);

	// Confirmed: from here on money moves.
	let requestId: string;
	try { ({ job_id: requestId } = await deps.generator!.submit(prepared.request)); }
	catch (cause) { return failure(502, cause instanceof Error ? cause.message : 'Send failed'); }
	const house = project.trailer_house!;
	const render: TeaserRender = {
		request_id: requestId, job_type: prepared.request.job_type ?? 'seedance_2_5', prompt: prepared.request.prompt,
		duration_s: prepared.request.duration, resolution: prepared.request.resolution, aspect: house.target.aspect,
		draft: Boolean(prepared.request.draft), estimate_credits: credits, status: 'queued', submitted_at: new Date().toISOString()
	};
	const saved = await deps.gateway.setTrailerHouse(input.project_id, project.version, { ...house, renders: [...(house.renders ?? []), render], updated_at: render.submitted_at });
	return saved.ok ? { ok: true, project: saved.data } : failure(409, `Sent as ${requestId}, but noting it failed: ${saved.error.message}`);
}

const pending = (render: TeaserRender) => render.status === 'queued' || render.status === 'in_progress';

/** Check pending renders once; finished clips are downloaded into the project. */
export async function pollTeasers(deps: AnimateDeps, projectId: string): Promise<{ ok: true; project: Project } | Failure> {
	const project = await deps.store.readProject(projectId);
	if (!project) return failure(404, 'Project not found');
	const house = project.trailer_house;
	if (!house || !deps.generator || !(house.renders ?? []).some(pending)) return { ok: true, project };
	let changed = false;
	const renders: TeaserRender[] = [];
	for (const render of house.renders) {
		if (!pending(render)) { renders.push(render); continue; }
		let status;
		try { status = await deps.generator.status(render.request_id); }
		catch { renders.push(render); continue; }
		if (status.status === 'completed' && status.video_url) {
			const file = `teaser-${render.request_id.slice(0, 8)}.mp4`;
			const target = join(folder(deps.projectRoot, projectId), file);
			await mkdir(folder(deps.projectRoot, projectId), { recursive: true });
			try { await writeFile(target, await deps.download(status.video_url)); }
			catch { await rm(target, { force: true }); renders.push(render); continue; }
			const probe = await deps.probe(target);
			renders.push({ ...render, status: 'completed', settled_at: new Date().toISOString(), video: { file, url: `/api/projects/${projectId}/files/trailer-house/${encodeURIComponent(file)}`, ...probe } });
			changed = true;
		} else if (status.status !== render.status && status.status !== 'completed') {
			renders.push({ ...render, status: status.status, ...(status.status === 'failed' || status.status === 'nsfw' ? { settled_at: new Date().toISOString(), error: status.error ?? (status.status === 'nsfw' ? 'Blocked by the content filter (refunded)' : 'Failed') } : {}) });
			changed = true;
		} else renders.push(render);
	}
	if (!changed) return { ok: true, project };
	const saved = await deps.gateway.setTrailerHouse(projectId, project.version, { ...house, renders, updated_at: new Date().toISOString() });
	return saved.ok ? { ok: true, project: saved.data } : failure(409, saved.error.message);
}

const TEASER_GROUP = 'Teasers';

/** Put a finished teaser on the board as a beat (in the Teasers group), so it can be reviewed, cut and finalized. */
export async function addTeaserToBoard(deps: AnimateDeps, input: { project_id: string; expected_version: number; request_id: string }): Promise<{ ok: true; project: Project } | Failure> {
	let project = await deps.store.readProject(input.project_id);
	if (!project) return failure(404, 'Project not found');
	if (project.version !== input.expected_version) return failure(409, 'The project changed; reload and try again');
	const house = project.trailer_house;
	const render = house?.renders.find((r) => r.request_id === input.request_id);
	if (!house || !render?.video) return failure(400, 'That render has no clip yet');
	if (render.card_id) return failure(400, 'Already on the board');

	let group = groupsOf(project.production).find((g) => g.name === TEASER_GROUP)?.group_id;
	if (!group) {
		group = uuid7ish();
		const made = await deps.gateway.changeGroups({ command: 'create_group', project_id: project.project_id, expected_version: project.version, group_id: group, name: TEASER_GROUP });
		if (!made.ok) return failure(409, made.error.message);
		project = made.data;
	}
	const cardId = uuid7ish();
	const title = house.blueprint?.title ?? 'Teaser';
	const added = await deps.gateway.addBeat({
		command: 'add_beat', project_id: project.project_id, expected_version: project.version, card_id: cardId,
		title: `Teaser · ${title}`.slice(0, 200), group_id: group,
		take: {
			asset_id: uuid7ish(), kind: 'video', name: `${title} · ${render.resolution}${render.draft ? ' draft' : ''} · ${render.duration_s}s`,
			mime_type: 'video/mp4', url: render.video.url,
			...(render.video.width ? { width: render.video.width } : {}), ...(render.video.height ? { height: render.video.height } : {}),
			...(render.video.duration_s ? { duration_s: render.video.duration_s } : {}),
			job_id: render.request_id,
			generation: { provider: 'higgsfield', model: render.job_type, resolution: render.resolution, prompt: render.prompt, duration_s: render.duration_s, draft: render.draft },
			created_at: new Date().toISOString()
		}
	});
	if (!added.ok) return failure(409, added.error.message);
	const latest = added.data.trailer_house!;
	const saved = await deps.gateway.setTrailerHouse(project.project_id, added.data.version, { ...latest, renders: latest.renders.map((r) => (r.request_id === render.request_id ? { ...r, card_id: cardId } : r)), updated_at: new Date().toISOString() });
	return saved.ok ? { ok: true, project: saved.data } : failure(409, saved.error.message);
}
