import type { CliRunner } from './higgsfield';

/**
 * The operator's finished Higgsfield renders, read through the CLI (`generate list` / `generate get`), for
 * importing as shots. The CLI has no "liked" filter, so the operator picks from the newest.
 */
export interface Render {
	job_id: string;
	kind: 'video' | 'image';
	model: string;
	created_at: string;
	prompt: string;
	duration_s: number | null;
	aspect_ratio: string | null;
	resolution: string | null;
	thumbnail_url: string | null;
	result_url: string;
}

type Raw = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** A finished job with an https result as a Render; anything else (queued, failed, no file) as null. */
export function renderOf(raw: unknown): Render | null {
	if (!raw || typeof raw !== 'object') return null;
	const job = raw as Raw;
	const params = (job.params && typeof job.params === 'object' ? job.params : {}) as Raw;
	const result = text(job.result_url);
	if (text(job.status) !== 'completed' || !/^https:\/\//.test(result) || !text(job.id)) return null;
	const kind = /\.(mp4|mov|webm)(\?|$)/i.test(result) ? 'video' : /\.(png|jpe?g|webp)(\?|$)/i.test(result) ? 'image' : null;
	if (!kind) return null;
	const height = typeof params.height === 'number' ? params.height : null;
	return {
		job_id: text(job.id),
		kind,
		model: text(job.display_name) || text(job.job_type),
		created_at: text(job.created_at),
		prompt: text(params.prompt).slice(0, 2000),
		duration_s: typeof params.duration === 'number' ? params.duration : null,
		aspect_ratio: text(params.aspect_ratio) || null,
		resolution: text(params.resolution) || (height ? `${height}p` : null),
		thumbnail_url: /^https:\/\//.test(text(job.thumbnail_url)) ? text(job.thumbnail_url) : null,
		result_url: result
	};
}

/** The newest finished renders of a kind, newest first. */
export async function listRenders(run: CliRunner, kind: 'video' | 'image', size: number): Promise<Render[]> {
	const raw = await run(['generate', 'list', `--${kind}`, '--size', String(Math.max(1, Math.min(100, size)))]);
	return (Array.isArray(raw) ? raw : []).map(renderOf).filter((render): render is Render => render !== null && render.kind === kind);
}

/** One render by job id, read fresh from Higgsfield (so the file to download never comes from the browser). */
export async function getRender(run: CliRunner, jobId: string): Promise<Render | null> {
	return renderOf(await run(['generate', 'get', jobId]));
}

/** The file name a render is kept under: the name Higgsfield gave the file. */
export function renderFileName(render: Render): string {
	const base = decodeURIComponent(new URL(render.result_url).pathname.split('/').pop() ?? '');
	return base || `hf_${render.job_id}.${render.kind === 'video' ? 'mp4' : 'png'}`;
}
