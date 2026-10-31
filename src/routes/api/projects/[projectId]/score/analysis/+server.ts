import { json } from '@sveltejs/kit';
import { join, resolve, sep } from 'node:path';
import type { RequestHandler } from './$types';
import type { CutMusic, Project } from '$lib/domain/schemas';
import { idSchema } from '$lib/domain/schemas';
import { getEssentia, getGateway, getProjectRoot, getProjectStore } from '$lib/server/config';
import { commandStatus } from '$lib/server/http';
import { getSongJob, needsGpu, submitSong, type StudioJob } from '$lib/server/essentia';

const fail = (status: number, message: string) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : 'INVALID_COMMAND', message, retryable: status >= 500, source: 'essentia' } }, { status });

/** The score with this job's state on it (done: Essentia's beats, sections and energy replace the app's own grid). */
function scoreWith(score: CutMusic, job: StudioJob): CutMusic {
	const at = new Date().toISOString();
	if (job.status === 'completed') {
		const { analysis } = job;
		return { ...score, bpm: analysis.bpm, beats: analysis.beats.filter((b) => b < score.duration_s), sections: analysis.sections, energy: analysis.energy, analysis: { source: 'essentia', status: 'done', job_id: job.id, at } };
	}
	if (job.status === 'failed') return { ...score, analysis: { source: 'essentia', status: 'failed', job_id: job.id, error: (needsGpu(job.error) ? `Essentia's GPU is not available; start it and analyse again (${job.error})` : job.error).slice(0, 500), at } };
	return { ...score, analysis: { source: 'essentia', status: 'running', job_id: job.id, at: score.analysis?.status === 'running' ? score.analysis.at : at } };
}

function scoreFile(project: Project, score: CutMusic): string | null {
	const files = resolve(join(getProjectRoot(), project.project_id, 'files'));
	const prefix = `/api/projects/${project.project_id}/files/`;
	const file = score.url.startsWith(prefix) ? resolve(join(files, decodeURIComponent(score.url.slice(prefix.length)))) : null;
	return file && file.startsWith(files + sep) ? file : null;
}

async function save(project: Project, score: CutMusic) {
	const outcome = await getGateway().setScore({ command: 'set_score', project_id: project.project_id, expected_version: project.version, music: score });
	return outcome.ok ? json({ ...outcome, analysis: score.analysis }) : json(outcome, { status: commandStatus(outcome.error) });
}

async function load(projectIdRaw: string | undefined) {
	const projectId = idSchema.safeParse(projectIdRaw);
	if (!projectId.success) return { ok: false as const, error: fail(400, 'Invalid project id') };
	const project = await getProjectStore().readProject(projectId.data);
	if (!project) return { ok: false as const, error: fail(404, 'Project not found') };
	if (!project.production.score) return { ok: false as const, error: fail(400, 'Add a score first') };
	const essentia = getEssentia();
	if (!essentia) return { ok: false as const, error: fail(503, 'Essentia is not set up (ESSENTIA_API_URL and ESSENTIA_API_KEY)') };
	return { ok: true as const, project, score: project.production.score, essentia };
}

/** Send the score to Essentia (a Studio job); the job id is kept on the score and GET follows it. */
export const POST: RequestHandler = async ({ params }) => {
	const loaded = await load(params.projectId);
	if (!loaded.ok) return loaded.error;
	const { project, score, essentia } = loaded;
	const file = scoreFile(project, score);
	if (!file) return fail(400, 'The score is not stored in the project folder');
	let job: StudioJob;
	try { job = await submitSong(essentia, file); } catch (cause) { return fail(502, cause instanceof Error ? cause.message : 'Essentia refused the song'); }
	return save(project, scoreWith(score, job));
};

/** Check a running analysis once; when it's done, its beats, sections and energy go on the score. */
export const GET: RequestHandler = async ({ params }) => {
	const loaded = await load(params.projectId);
	if (!loaded.ok) return loaded.error;
	const { project, score, essentia } = loaded;
	if (score.analysis?.source !== 'essentia' || score.analysis.status !== 'running' || !score.analysis.job_id) return json({ ok: true, data: project, analysis: score.analysis ?? null });
	let job: StudioJob;
	try { job = await getSongJob(essentia, score.analysis.job_id); } catch (cause) { return fail(502, cause instanceof Error ? cause.message : 'Could not reach Essentia'); }
	if (job.status === 'queued' || job.status === 'running') return json({ ok: true, data: project, analysis: score.analysis, stage: job.stage });
	return save(project, scoreWith(score, job));
};
