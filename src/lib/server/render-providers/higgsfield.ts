import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GeneratorError, jobIdOf, uploadReferences, type CliRunner } from '../higgsfield';
import { RenderProviderError, type RenderCheck, type RenderMedia, type RenderProvider, type RenderReadBack, type RenderRequest } from './types';

/**
 * Higgsfield through its CLI, on the operator's plan credits. No `draft`:
 * a 480p take can no longer be finished at 1080p from the same render, so
 * resolution is a plain choice (decision 33). Reuse reads an earlier job
 * back with `generate get` and sends its media again by id.
 */

const STATE: Record<string, RenderCheck['state']> = {
	completed: 'done', succeeded: 'done', success: 'done',
	failed: 'failed', error: 'failed', canceled: 'failed', cancelled: 'failed',
	nsfw: 'refused', queued: 'queued', pending: 'queued', waiting: 'queued'
};

const idOrPath = (media: RenderMedia): string | null => media.media_id ?? media.path ?? null;

/** CLI flags for a request. Seedance 2.5's default mode takes no media, so a still or a reference switches it to omni_reference. */
export function renderArgs(request: RenderRequest, promptFile: string): string[] {
	const still = request.still ? idOrPath(request.still) : null;
	const references = (request.references ?? []).map(idOrPath).filter((value): value is string => Boolean(value));
	return [
		request.model,
		'--prompt', `@${promptFile}`,
		'--duration', String(request.duration_s),
		'--resolution', request.resolution,
		'--generate_audio', String(request.generate_audio),
		...(request.model === 'seedance_2_5' && (still || references.length) ? ['--mode', 'omni_reference'] : []),
		...(request.aspect_ratio ? ['--aspect_ratio', request.aspect_ratio] : []),
		...(still ? ['--start-image', still] : []),
		...references.flatMap((value) => ['--image-references', value])
	];
}

/** The prompt goes to the CLI as a JSON file, so quotes, newlines and a leading "@" survive. */
async function withPromptFile<T>(prompt: string, use: (file: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), 'csp-render-'));
	const file = join(dir, 'prompt.json');
	try {
		await writeFile(file, JSON.stringify(prompt), 'utf8');
		return await use(file);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

const failed = (cause: unknown): RenderProviderError => new RenderProviderError(cause instanceof Error ? cause.message : String(cause), 'error');

/** The media of a job read back, by the role Higgsfield kept for each. */
export function readBackOf(job: unknown): RenderReadBack {
	const value = job as { job_type?: unknown; params?: Record<string, unknown> };
	const params = value?.params ?? {};
	if (typeof value?.job_type !== 'string' || typeof params.prompt !== 'string' || !params.prompt) throw new RenderProviderError('Higgsfield kept no request for this job', 'error');
	const medias = (Array.isArray(params.medias) ? params.medias : []) as Array<{ role?: unknown; data?: { id?: unknown } }>;
	const media = medias.flatMap((entry) => (typeof entry?.data?.id === 'string' ? [{ media_id: entry.data.id, role: typeof entry.role === 'string' ? entry.role : 'image' }] : []));
	const still = media.find((entry) => entry.role === 'start_image');
	return {
		model: value.job_type,
		prompt: params.prompt,
		...(typeof params.duration === 'number' ? { duration_s: params.duration } : {}),
		...(typeof params.resolution === 'string' ? { resolution: params.resolution } : {}),
		...(typeof params.generate_audio === 'boolean' ? { generate_audio: params.generate_audio } : {}),
		...(typeof params.aspect_ratio === 'string' ? { aspect_ratio: params.aspect_ratio } : {}),
		...(still ? { still } : {}),
		references: media.filter((entry) => entry !== still)
	};
}

export function createHiggsfieldProvider(run: CliRunner | null): RenderProvider {
	const cli = (): CliRunner => {
		if (!run) throw new RenderProviderError('The Higgsfield CLI is not installed here', 'error');
		return run;
	};
	return {
		id: 'higgsfield',
		label: 'Higgsfield',
		models: [
			{ id: 'seedance_2_5', label: 'Seedance 2.5', kind: 'video', wired: true },
			{ id: 'seedance_2_0', label: 'Seedance 2.0', kind: 'video', wired: true }
		],
		resolutions: ['480p', '720p', '1080p'],
		async setup() {
			if (!run) return { ready: false, reason: 'The Higgsfield CLI is not installed here' };
			try {
				await run(['account', 'status']);
				return { ready: true };
			} catch (cause) {
				return { ready: false, reason: `The Higgsfield CLI is not signed in (${(cause instanceof Error ? cause.message : String(cause)).slice(0, 160)})` };
			}
		},
		async price(request) {
			// Priced without the media: the CLI would upload each local file just to quote.
			const result = (await withPromptFile(request.prompt, (file) => cli()(['generate', 'cost', ...renderArgs({ ...request, still: undefined, references: [] }, file)])).catch((cause) => { throw failed(cause); })) as { credits?: unknown };
			const credits = Number(result?.credits);
			if (!Number.isFinite(credits)) throw new RenderProviderError('Higgsfield gave no price', 'error');
			return { amount: credits, unit: 'credits' };
		},
		async send(request) {
			try {
				// Local references are uploaded first and passed by id; ids already known pass through.
				const references = await uploadReferences(cli(), (request.references ?? []).map(idOrPath).filter((value): value is string => Boolean(value)));
				const result = await withPromptFile(request.prompt, (file) => cli()(['generate', 'create', ...renderArgs({ ...request, references: references.map((media_id) => ({ media_id })) }, file)]));
				const jobId = jobIdOf(result);
				if (!jobId) throw new GeneratorError(`Higgsfield created no job id: ${JSON.stringify(result).slice(0, 200)}`);
				return { job_id: jobId, answer_code: 'queued' };
			} catch (cause) {
				throw failed(cause);
			}
		},
		async check(job) {
			const result = (await cli()(['generate', 'get', job.job_id]).catch((cause) => { throw failed(cause); })) as { status?: unknown; result_url?: unknown; error?: unknown };
			const word = String(result?.status ?? '').toLowerCase();
			return {
				state: STATE[word] ?? 'rendering',
				...(typeof result?.result_url === 'string' && result.result_url ? { url: result.result_url } : {}),
				...(typeof result?.error === 'string' && result.error ? { error: result.error } : {}),
				...(word ? { answer_code: word } : {})
			};
		},
		async readBack(jobId) {
			return readBackOf(await cli()(['generate', 'get', jobId]).catch((cause) => { throw failed(cause); }));
		}
	};
}
