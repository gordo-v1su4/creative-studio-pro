import type { ProjectStore } from '$lib/adapters/project-store';
import type { Project, ProductionAsset, RenderProviderId } from '$lib/domain/schemas';
import { moveRender, openRerenderFor, queueRerender, removable, renderState, requestSource, withPrompt, withSettings, type Render, type RenderResult } from '$lib/domain/render-queue';
import type { ReviewNote } from '$lib/domain/review-notes';
import type { AgentModelClient } from './model-provider';
import { draftPromptChange, promptChangeCheck } from './prompt-change';
import type { RenderProviders } from './render-providers';

/**
 * The render queue's commands up to approval (slice 8, steps 3 and 4): queue a
 * re-render of a take, have the Agent draft its prompt change, edit it, choose
 * where and at what size it is made, approve it, remove it. Nothing here
 * prices, confirms or sends; that is the Queue view's Confirm. Dependencies
 * are injected so everything runs against a fake model and fake providers.
 */

export interface RerenderDeps {
	store: Pick<ProjectStore, 'readProject' | 'updateProject'>;
	providers: RenderProviders;
	/** The Agent's model, or why there is none. */
	model: (project: Project) => Promise<{ ok: true; client: AgentModelClient } | { ok: false; message: string }>;
	/** The skill's own text (Ghost), read fresh each time. */
	skill: () => Promise<string>;
	/** The notes reviewers left on the take's shot in Review Room; empty when it is not stored there. */
	notes: (take: ProductionAsset) => Promise<ReviewNote[]>;
	/** Words the project bans from prompts. */
	banned: (projectId: string) => Promise<string[]>;
	now: () => string;
	id: () => string;
}

export type RerenderOutcome = { ok: true; project: Project; render: Render | null } | { ok: false; status: number; message: string };
const fail = (status: number, message: string): RerenderOutcome => ({ ok: false, status, message });

async function open(deps: RerenderDeps, projectId: string, expectedVersion: number): Promise<{ ok: true; project: Project } | { ok: false; status: number; message: string }> {
	const project = await deps.store.readProject(projectId);
	if (!project) return { ok: false, status: 404, message: 'Project not found' };
	if (project.version !== expectedVersion) return { ok: false, status: 409, message: 'Project changed. Reload before continuing.' };
	return { ok: true, project };
}

const rendersOf = (project: Project): Render[] => project.production.generations ?? [];

/** Write one render back (or take it out), on the version that was read. */
async function save(deps: RerenderDeps, project: Project, renderId: string, next: Render | null, added = false): Promise<RerenderOutcome> {
	try {
		const saved = await deps.store.updateProject(project.project_id, project.version, (current) => {
			const renders = rendersOf(current);
			const generations = added && next ? [...renders, next] : renders.flatMap((entry) => (entry.request_id === renderId ? (next ? [next] : []) : [entry]));
			return { ...current, production: { ...current.production, generations } };
		});
		return { ok: true, project: saved, render: next };
	} catch (cause) {
		return fail(409, cause instanceof Error ? cause.message : 'The project could not be saved');
	}
}

async function change(deps: RerenderDeps, projectId: string, input: { expected_version: number; render_id: string }, apply: (render: Render, project: Project) => RenderResult | Promise<RenderResult>): Promise<RerenderOutcome> {
	const opened = await open(deps, projectId, input.expected_version);
	if (!opened.ok) return opened;
	const render = rendersOf(opened.project).find((entry) => entry.request_id === input.render_id);
	if (!render) return fail(404, 'That render is no longer in the queue');
	const result = await apply(render, opened.project);
	return result.ok ? save(deps, opened.project, render.request_id, result.render) : fail(400, result.message);
}

/**
 * "Queue re-render" on a take marked Needs changes: the entry already open for
 * it, or a new one. A take with no record of its own is read back from
 * Higgsfield by its job id. The reviewers' open notes are kept on the entry.
 */
export async function queueRerenderFor(deps: RerenderDeps, projectId: string, input: { expected_version: number; take_id: string; requested_change?: string; unchanged?: boolean }): Promise<RerenderOutcome> {
	const opened = await open(deps, projectId, input.expected_version);
	if (!opened.ok) return opened;
	const { project } = opened;
	const take = project.production.assets.find((asset) => asset.asset_id === input.take_id);
	if (!take) return fail(404, 'That take is no longer on this project');
	const renders = rendersOf(project);
	const existing = openRerenderFor(renders, take.asset_id);
	if (existing) return { ok: true, project, render: existing };
	if (take.review_status !== 'needs_changes') return fail(400, 'A re-render is queued from a take marked Needs changes');
	const source = requestSource(take, renders);
	if (source.kind === 'none') return fail(400, source.reason);

	const notes = (await deps.notes(take).catch(() => [])).filter((note) => note.completedAt === null)
		.map((note) => ({ text: note.body.slice(0, 4000), ...(note.timecodeSec === null ? {} : { at_s: note.timecodeSec }), ...(note.authorName ? { author: note.authorName.slice(0, 200) } : {}) }));

	// The app's own record or the take's own facts first; Higgsfield is asked only when the prompt is not known here.
	let readback: Parameters<typeof queueRerender>[1]['readback'];
	if (source.kind === 'job' && !take.generation?.prompt) {
		const read = deps.providers.higgsfield.readBack;
		if (!read) return fail(503, 'Higgsfield cannot read an earlier request back here');
		try {
			const job = await read(source.job_id);
			readback = { prompt: job.prompt, model: job.model, duration_s: job.duration_s, generate_audio: job.generate_audio };
		} catch (cause) {
			return fail(502, `This take's request could not be read back from Higgsfield: ${cause instanceof Error ? cause.message : 'no answer'}`);
		}
	}
	const queued = queueRerender(renders, { id: deps.id(), take, requested_change: input.requested_change, unchanged: input.unchanged, notes, readback, now: deps.now() });
	if (!queued.ok) return fail(400, queued.message);
	return save(deps, project, queued.render.request_id, queued.render, true);
}

/**
 * The Agent drafts the prompt change of an entry that is drafting. When it
 * cannot, the entry stays drafting with the reason, to be asked again or removed.
 */
export async function draftRerender(deps: RerenderDeps, projectId: string, input: { expected_version: number; render_id: string }): Promise<RerenderOutcome> {
	const opened = await open(deps, projectId, input.expected_version);
	if (!opened.ok) return opened;
	const { project } = opened;
	const render = rendersOf(project).find((entry) => entry.request_id === input.render_id);
	if (!render) return fail(404, 'That render is no longer in the queue');
	if (renderState(render) !== 'drafting') return fail(400, 'Its prompt change is already written');
	const before = render.prompt_before ?? render.prompt;
	const stuck = (message: string) => save(deps, project, render.request_id, { ...render, error: message.slice(0, 2000) });
	const model = await deps.model(project);
	if (!model.ok) return stuck(model.message);
	try {
		const card = project.production.cards.find((entry) => entry.card_id === render.card_id);
		const drafted = await draftPromptChange(model.client, {
			skill: await deps.skill(), prompt: before, duration_s: render.duration_s, requested_change: render.requested_change,
			notes: render.notes, spec: card?.fit?.spec, banned: await deps.banned(project.project_id)
		});
		const result = withPrompt(render, drafted.prompt, drafted.check);
		if (!result.ok) return fail(400, result.message);
		const { error: _cleared, ...clean } = result.render;
		return save(deps, project, render.request_id, clean);
	} catch (cause) {
		return stuck(cause instanceof Error ? cause.message : 'The Agent could not write the prompt change');
	}
}

/** The operator's own edit of the changed prompt. It is checked the same way and waits for approval again. */
export function editRerender(deps: RerenderDeps, projectId: string, input: { expected_version: number; render_id: string; prompt: string }): Promise<RerenderOutcome> {
	return change(deps, projectId, input, async (render, project) => {
		const prompt = input.prompt.trim();
		if (!prompt) return { ok: false, message: 'The prompt is empty' };
		const check = promptChangeCheck(render.prompt_before ?? render.prompt, prompt, { duration_s: render.duration_s, banned: await deps.banned(project.project_id) });
		return withPrompt(render, prompt, check);
	});
}

/** Ask the Agent again with other words: back to drafting, the earlier prompt restored. */
export function redraftRerender(deps: RerenderDeps, projectId: string, input: { expected_version: number; render_id: string; requested_change: string }): Promise<RerenderOutcome> {
	return change(deps, projectId, input, (render) => {
		const requested = input.requested_change.trim();
		if (!requested) return { ok: false, message: 'Type what should change' };
		const moved = renderState(render) === 'drafting' ? ({ ok: true, render } as const) : moveRender(render, 'drafting', deps.now());
		if (!moved.ok) return moved;
		const { error: _cleared, unchanged: _was, ...rest } = moved.render;
		return { ok: true, render: { ...rest, requested_change: requested, prompt: render.prompt_before ?? render.prompt } };
	});
}

/** Where and at what size it is made. Only a provider that is set up, a model it renders video with, and a size it offers. */
export function setRerenderSettings(deps: RerenderDeps, projectId: string, input: { expected_version: number; render_id: string; provider?: RenderProviderId; model?: string; resolution?: string }): Promise<RerenderOutcome> {
	return change(deps, projectId, input, async (render) => {
		const provider = deps.providers[input.provider ?? render.provider];
		const setup = await provider.setup();
		if (!setup.ready) return { ok: false, message: `${provider.label} is not set up: ${setup.reason}` };
		const model = input.model ?? (input.provider && input.provider !== render.provider ? provider.models.find((entry) => entry.kind === 'video' && entry.wired)?.id : render.model);
		if (!model || !provider.models.some((entry) => entry.id === model && entry.kind === 'video' && entry.wired)) return { ok: false, message: `${provider.label} does not render video with that model` };
		const resolution = input.resolution ?? render.resolution;
		if (!provider.resolutions.includes(resolution)) return { ok: false, message: `${provider.label} does not render at ${resolution}` };
		return withSettings(render, { provider: provider.id, model, resolution });
	});
}

/** Approve the prompt change. The only way forward; it still spends nothing. */
export function approveRerender(deps: RerenderDeps, projectId: string, input: { expected_version: number; render_id: string }): Promise<RerenderOutcome> {
	return change(deps, projectId, input, (render) => moveRender(render, 'approved', deps.now()));
}

/** Remove an entry that is not with a provider. It costs nothing. */
export async function removeRerender(deps: RerenderDeps, projectId: string, input: { expected_version: number; render_id: string }): Promise<RerenderOutcome> {
	const opened = await open(deps, projectId, input.expected_version);
	if (!opened.ok) return opened;
	const render = rendersOf(opened.project).find((entry) => entry.request_id === input.render_id);
	if (!render) return { ok: true, project: opened.project, render: null };
	if (!removable(renderState(render))) return fail(400, 'It has been sent; it can no longer be removed');
	return save(deps, opened.project, render.request_id, null);
}
