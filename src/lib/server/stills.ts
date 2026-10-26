import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectCommandGateway } from '$lib/application/gateway';
import type { ProjectStore } from '$lib/adapters/project-store';
import type { Project, StillSend } from '$lib/domain/schemas';
import { approvalProblems, episodeSpend, stillApproval, type StillApproval } from '$lib/domain/stills';
import { type ImageGenerator } from './higgsfield';
import { IMAGE_MODELS, type ImageModelId } from '$lib/domain/image-models';

/**
 * One still through the approval step (V1S-373): quote shows the operator the prompt, the references in attach
 * order with their exact names, the model, the predicted credits and the episode's running total; send re-quotes
 * and refuses before any spend if anything changed since the approval; settle saves the finished image under the
 * project's files. Grids, references (Prep) and keyframes all go through here.
 */
export interface StillDeps {
	store: ProjectStore; gateway: ProjectCommandGateway; projectRoot: string;
	images: ImageGenerator | null;
	download: (url: string) => Promise<Uint8Array>;
}
export interface StillInput {
	model?: ImageModelId;
	prompt: string;
	/** In image order; each with the exact name the prompt calls it, and a thumbnail URL when there is one. */
	attached: Array<{ name: string; file: string; url?: string }>;
	aspect_ratio: string;
	/** QC and gate findings found before pricing; any entry blocks Approve. */
	blocked?: string[];
}
type Failure = { ok: false; status: number; message: string; reasons?: string[] };
const fail = (status: number, message: string, reasons?: string[]): Failure => ({ ok: false, status, message, ...(reasons ? { reasons } : {}) });
export const NO_CLI = 'The Higgsfield CLI was not found; install it and run "higgsfield auth login" (see Settings)';

export async function quoteStill(deps: Pick<StillDeps, 'images'>, project: Project, input: StillInput): Promise<StillApproval> {
	const model = IMAGE_MODELS[input.model ?? 'gpt_image_2_5'];
	const blocked = [...(input.blocked ?? [])];
	let credits: number | null = null;
	if (!deps.images) blocked.push(NO_CLI);
	else {
		try { credits = (await deps.images.estimate({ prompt: input.prompt, references: [], aspect_ratio: input.aspect_ratio, ...(input.model ? { model: input.model } : {}) })).credits; }
		catch (cause) { blocked.push(cause instanceof Error ? cause.message : 'Price check failed'); }
	}
	return stillApproval({
		prompt: input.prompt, attached: input.attached, model: model.label, resolution: model.resolution.toUpperCase(),
		aspect_ratio: input.aspect_ratio, credits, spent: episodeSpend(project.production), blocked
	});
}

/** Send one approved still; logs its credits on the project. */
export async function sendStill(deps: StillDeps, input: StillInput & { project_id: string; purpose: StillSend['purpose']; approval_key: string; confirmed_credits: number }): Promise<{ ok: true; job_id: string; credits: number; project: Project } | Failure> {
	const project = await deps.store.readProject(input.project_id);
	if (!project) return fail(404, 'Project not found');
	// The same approved still (same prompt, references, model, aspect) is never sent twice within 30 min:
	// a second press, a retry after an unclear answer, or two tabs would each spend credits.
	const recent = (project.production.still_sends ?? []).find((send) => send.approval_key === input.approval_key && Date.now() - Date.parse(send.sent_at) < 30 * 60_000);
	if (recent) return fail(409, `Already sent ${Math.max(1, Math.round((Date.now() - Date.parse(recent.sent_at)) / 60_000))} min ago (Higgsfield job ${recent.job_id}); wait for it to land, or change the prompt to make another`);
	const now = await quoteStill(deps, project, input);
	const problems = approvalProblems(now, input);
	if (problems.length) return fail(422, 'Blocked before any spend', problems);
	let jobId: string;
	try { ({ job_id: jobId } = await deps.images!.submit({ prompt: now.prompt, references: now.references.map((ref) => ref.file), aspect_ratio: input.aspect_ratio, ...(input.model ? { model: input.model } : {}) })); }
	catch (cause) { return fail(502, cause instanceof Error ? cause.message : 'Send failed'); }
	const model = IMAGE_MODELS[input.model ?? 'gpt_image_2_5'];
	const recorded = await deps.gateway.recordStillSend(project.project_id, project.version, {
		job_id: jobId, purpose: input.purpose, model: model.job_type, resolution: model.resolution, credits: now.credits ?? 0,
		prompt: now.prompt.slice(0, 20_000), references: now.references.map((ref) => ref.name.slice(0, 300)).slice(0, 16), approval_key: now.approval_key, sent_at: new Date().toISOString()
	});
	if (!recorded.ok) return fail(409, `Sent as ${jobId}, but noting the spend failed: ${recorded.error.message}`);
	return { ok: true, job_id: jobId, credits: now.credits ?? 0, project: recorded.data };
}

/** A sent still: pending, or saved to `files/<folder>/<name>.png` and returned with its project URL. */
export async function settleStill(deps: Pick<StillDeps, 'images' | 'download' | 'projectRoot'>, input: { project_id: string; job_id: string; folder: string; name: string }): Promise<{ ok: true; pending: true } | { ok: true; pending: false; file: string; url: string } | Failure> {
	if (!deps.images) return fail(503, NO_CLI);
	const job = await deps.images.status(input.job_id);
	if (job.status === 'queued' || job.status === 'in_progress') return { ok: true, pending: true };
	if (job.status !== 'completed' || !job.url) return fail(502, `The still failed: ${job.error ?? job.status}`);
	const dir = join(deps.projectRoot, input.project_id, 'files', input.folder);
	await mkdir(dir, { recursive: true });
	const name = `${input.name.replace(/[^\w.-]+/g, '_')}.png`;
	const file = join(dir, name);
	await writeFile(file, await deps.download(job.url));
	return { ok: true, pending: false, file, url: `/api/projects/${input.project_id}/files/${input.folder}/${name}` };
}
