import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SeedanceRequest } from '$lib/domain/animate';

/**
 * Video generator seam (Animate, Finalize) and its Higgsfield implementation
 * through the Higgsfield CLI, which runs on the operator's higgsfield.ai
 * account: plan credits, and Seedance draft mode (`draft: true` renders a
 * 480p draft that `draft_job_id` finalizes to 1080p from the same render
 * within seven days). The public REST API bills a separate balance and has
 * no draft mode, so it is not used.
 */

export const SEEDANCE_JOB_TYPE = 'seedance_2_5';

export type GenerationStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw';


export interface VideoGenerator {
	/** Plan credits this request would cost; nothing is created. */
	estimate(request: SeedanceRequest): Promise<{ credits: number }>;
	submit(request: SeedanceRequest): Promise<{ job_id: string }>;
	status(jobId: string): Promise<{ status: GenerationStatus; video_url?: string; error?: string }>;
	/** Credits left on the account, when known. */
	balance(): Promise<{ credits: number; plan: string | null } | null>;
}

export class GeneratorError extends Error {}

export type CliRunner = (args: string[]) => Promise<unknown>;

/** The CLI binary: HIGGSFIELD_CLI, else the npm package's bundled binary on Windows, else `higgsfield` on PATH. */
export function higgsfieldCliPath(override?: string | null): string | null {
	if (override?.trim()) return override.trim();
	if (process.platform === 'win32' && process.env.APPDATA) {
		const bundled = join(process.env.APPDATA, 'npm', 'node_modules', '@higgsfield', 'cli', 'vendor', 'hf.exe');
		if (existsSync(bundled)) return bundled;
	}
	return process.platform === 'win32' ? null : 'higgsfield';
}

/** Run the CLI with --json; no shell, so arguments are never re-parsed. */
export function cliRunner(bin: string, timeoutMs = 120_000): CliRunner {
	return (args) => new Promise((resolve, reject) => {
		execFile(bin, [...args, '--json', '--no-color'], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
			if (error) return reject(new GeneratorError(`Higgsfield CLI: ${(stderr || stdout || error.message).trim().split('\n').slice(0, 3).join(' ')}`));
			try { resolve(JSON.parse(stdout)); }
			catch { reject(new GeneratorError(`Higgsfield CLI returned non-JSON: ${stdout.slice(0, 200)}`)); }
		});
	});
}

/**
 * CLI flags for a Seedance request; the prompt goes in a JSON file because the CLI reads "@…" values as files.
 * Seedance 2.5's default mode (t2v) takes no reference media, so a start image or reference images switch it
 * to omni_reference. Seedance 2.0 has no draft mode.
 */
export function seedanceArgs(request: SeedanceRequest, promptFile: string): string[] {
	const jobType = request.job_type ?? SEEDANCE_JOB_TYPE;
	const references = request.image_references ?? [];
	const withMedia = Boolean(request.start_image) || references.length > 0;
	return [
		jobType,
		'--prompt', `@${promptFile}`,
		'--duration', String(request.duration),
		'--resolution', request.resolution,
		'--generate_audio', String(request.generate_audio),
		...(jobType === 'seedance_2_5'
			// The CLI's validator needs draft spelled out when finalizing.
			? ['--draft', String(Boolean(request.draft) && !request.draft_job_id), ...(request.draft_job_id ? ['--draft_job_id', request.draft_job_id] : []), ...(withMedia ? ['--mode', 'omni_reference'] : [])]
			: []),
		...(request.aspect_ratio ? ['--aspect_ratio', request.aspect_ratio] : []),
		...(request.start_image ? ['--start-image', request.start_image] : []),
		...references.flatMap((path) => ['--image-references', path])
	];
}

const STATUS: Record<string, GenerationStatus> = {
	completed: 'completed', succeeded: 'completed', success: 'completed',
	failed: 'failed', error: 'failed', canceled: 'failed', cancelled: 'failed',
	nsfw: 'nsfw', queued: 'queued', pending: 'queued', waiting: 'queued'
};

/** The job id in whatever shape `generate create` printed (an object, a list, or {jobs:[…]}). */
export function jobIdOf(value: unknown): string | null {
	const first = Array.isArray(value) ? value[0] : (value as { jobs?: unknown[] })?.jobs?.[0] ?? value;
	// GPT Image 2.5 answers with a plain list of job ids (2026-10-25).
	if (typeof first === 'string') return first.trim() || null;
	const id = (first as { id?: unknown; job_id?: unknown })?.id ?? (first as { job_id?: unknown })?.job_id;
	return typeof id === 'string' && id ? id : null;
}

/** The prompt goes to the CLI as a JSON file (`--prompt @file.json`), so quotes and newlines survive. */
async function withPrompt<T>(prompt: string, use: (file: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), 'csp-hf-'));
	const file = join(dir, 'prompt.json');
	try {
		await writeFile(file, JSON.stringify(prompt), 'utf8');
		return await use(file);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** Sound effects (V1S-129): Mirelo text-to-audio on the same account; priced per second. */
export const SFX_JOB_TYPE = 'mirelo_text_to_audio';
export interface SoundEffectGenerator {
	estimate(request: { prompt: string; duration_s: number }): Promise<{ credits: number }>;
	submit(request: { prompt: string; duration_s: number }): Promise<{ job_id: string }>;
	status(jobId: string): Promise<{ status: GenerationStatus; url?: string; error?: string }>;
}

export function createHiggsfieldSfx(run: CliRunner): SoundEffectGenerator {
	const args = (file: string, duration: number) => [SFX_JOB_TYPE, '--prompt', `@${file}`, '--duration', String(duration)];
	return {
		async estimate(request) {
			const result = (await withPrompt(request.prompt, (file) => run(['generate', 'cost', ...args(file, request.duration_s)]))) as { credits?: unknown };
			const credits = Number(result?.credits);
			if (!Number.isFinite(credits)) throw new GeneratorError('Higgsfield CLI gave no credit estimate');
			return { credits };
		},
		async submit(request) {
			const result = await withPrompt(request.prompt, (file) => run(['generate', 'create', ...args(file, request.duration_s)]));
			const jobId = jobIdOf(result);
			if (!jobId) throw new GeneratorError(`Higgsfield CLI created no job id: ${JSON.stringify(result).slice(0, 200)}`);
			return { job_id: jobId };
		},
		async status(jobId) {
			const job = (await run(['generate', 'get', jobId])) as { status?: string; result_url?: string; error?: string };
			return { status: STATUS[String(job?.status ?? '').toLowerCase()] ?? 'in_progress', url: job?.result_url ?? undefined, error: job?.error };
		}
	};
}

/**
 * Every still (V1S-373, ADR 0003): references, keyframes and grids are GPT Image 2.5 at 2K, high quality, on
 * the operator's account. References attach in the order given (image 1, image 2…).
 */
export const STILL_MODEL = { job_type: 'gpt_image_2_5', label: 'GPT Image 2.5', quality: 'high', resolution: '2k' } as const;
/** Grids are square (2×2 or 3×3); other stills say their own aspect. */
export interface StillRequest { prompt: string; references: string[]; aspect_ratio?: string }
export interface ImageGenerator {
	estimate(request: StillRequest): Promise<{ credits: number }>;
	submit(request: StillRequest): Promise<{ job_id: string }>;
	status(jobId: string): Promise<{ status: GenerationStatus; url?: string; error?: string }>;
}

export function stillArgs(request: StillRequest, promptFile: string): string[] {
	return [
		STILL_MODEL.job_type, '--prompt', `@${promptFile}`, '--aspect_ratio', request.aspect_ratio ?? '1:1',
		'--quality', STILL_MODEL.quality, '--resolution', STILL_MODEL.resolution,
		...request.references.slice(0, 14).flatMap((file) => ['--image-references', file])
	];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Local reference files are uploaded first (`upload create`, one retry) and passed to the job by upload id:
 * the CLI's own upload inside `generate create` once failed with a storage signature error (2026-10-25) while
 * a plain upload of the same file worked. Ids already given pass through.
 */
export async function uploadReferences(run: CliRunner, files: string[]): Promise<string[]> {
	const ids: string[] = [];
	for (const file of files) {
		if (UUID.test(file)) { ids.push(file); continue; }
		let last: unknown;
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const result = (await run(['upload', 'create', file])) as { id?: unknown };
				if (typeof result?.id === 'string' && UUID.test(result.id)) { ids.push(result.id); last = null; break; }
				last = new GeneratorError(`Higgsfield CLI gave no upload id for ${file}`);
			} catch (cause) { last = cause; }
		}
		if (last) throw last instanceof Error ? new GeneratorError(`Uploading a reference failed: ${last.message}`) : last;
	}
	return ids;
}

export function createHiggsfieldImages(run: CliRunner): ImageGenerator {
	return {
		async estimate(request) {
			// Priced without the references: the CLI would upload each file just to quote.
			const result = (await withPrompt(request.prompt, (file) => run(['generate', 'cost', ...stillArgs({ ...request, references: [] }, file)]))) as { credits?: unknown };
			const credits = Number(result?.credits);
			if (!Number.isFinite(credits)) throw new GeneratorError('Higgsfield CLI gave no credit estimate');
			return { credits };
		},
		async submit(request) {
			const references = await uploadReferences(run, request.references);
			const result = await withPrompt(request.prompt, (file) => run(['generate', 'create', ...stillArgs({ ...request, references }, file)]));
			const jobId = jobIdOf(result);
			if (!jobId) throw new GeneratorError(`Higgsfield CLI created no job id: ${JSON.stringify(result).slice(0, 200)}`);
			return { job_id: jobId };
		},
		async status(jobId) {
			const job = (await run(['generate', 'get', jobId])) as { status?: string; result_url?: string; error?: string };
			return { status: STATUS[String(job?.status ?? '').toLowerCase()] ?? 'in_progress', url: job?.result_url ?? undefined, error: job?.error };
		}
	};
}

export function createHiggsfieldCli(run: CliRunner): VideoGenerator {
	return {
		async estimate(request) {
			const result = (await withPrompt(request.prompt, (file) => run(['generate', 'cost', ...seedanceArgs(request, file)]))) as { credits?: unknown };
			const credits = Number(result?.credits);
			if (!Number.isFinite(credits)) throw new GeneratorError('Higgsfield CLI gave no credit estimate');
			return { credits };
		},
		async submit(request) {
			const result = await withPrompt(request.prompt, (file) => run(['generate', 'create', ...seedanceArgs(request, file)]));
			const jobId = jobIdOf(result);
			if (!jobId) throw new GeneratorError(`Higgsfield CLI created no job id: ${JSON.stringify(result).slice(0, 200)}`);
			return { job_id: jobId };
		},
		async status(jobId) {
			const job = (await run(['generate', 'get', jobId])) as { status?: string; result_url?: string; error?: string };
			const status = STATUS[String(job?.status ?? '').toLowerCase()] ?? 'in_progress';
			return { status, video_url: job?.result_url ?? undefined, error: job?.error };
		},
		async balance() {
			try {
				const account = (await run(['account', 'status'])) as { credits?: unknown; subscription_plan_type?: unknown };
				const credits = Number(account?.credits);
				return Number.isFinite(credits) ? { credits, plan: typeof account?.subscription_plan_type === 'string' ? account.subscription_plan_type : null } : null;
			} catch {
				return null;
			}
		}
	};
}
