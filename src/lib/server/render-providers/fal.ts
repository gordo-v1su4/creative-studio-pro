import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { RenderProviderError, type RenderCheck, type RenderMedia, type RenderProvider, type RenderRequest } from './types';

/**
 * fal.ai through its queue (queue.fal.run: submit, status, result, cancel)
 * and its pricing address, read from fal's documentation on 2026-11-24. The
 * price is in dollars and the HTTP status is kept as the answer code. It is
 * set up once FAL_KEY is given; until then it is listed as not set up.
 *
 * Not yet exercised against fal itself (no key on 2026-11-24):
 * - a local still goes as a data URI, which fal accepts but advises against
 *   for large files; its upload flow is documented only for its SDKs;
 * - the pricing address answers a unit price and a unit, and nothing says
 *   whether resolution changes it, so the total here is unit price x seconds
 *   for a per-second unit and the unit price itself for a per-video one.
 */

export const FAL_IMAGE_TO_VIDEO = 'bytedance/seedance-2.5/us/image-to-video';
export const FAL_REFERENCE_TO_VIDEO = 'bytedance/seedance-2.5/us/reference-to-video';

const QUEUE = 'https://queue.fal.run';
const PRICING = 'https://api.fal.ai/v1/models/pricing';
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Status, result and cancel live under the owner and the app only; the endpoint's own path answers 405 there. */
export const falApp = (model: string): string => model.split('/').slice(0, 2).join('/');

/** Which address a request goes to: reference-to-video as soon as there is more than a start frame. */
export const falEndpoint = (request: Pick<RenderRequest, 'references'>): string => (request.references?.length ? FAL_REFERENCE_TO_VIDEO : FAL_IMAGE_TO_VIDEO);

async function address(media: RenderMedia): Promise<string> {
	if (media.url) return media.url;
	if (!media.path) throw new RenderProviderError('fal.ai needs the file itself; an id from another provider means nothing to it', 'error');
	const type = MIME[extname(media.path).toLowerCase()];
	if (!type) throw new RenderProviderError(`fal.ai cannot take ${extname(media.path) || 'this file'} as a still`, 'error');
	return `data:${type};base64,${(await readFile(media.path)).toString('base64')}`;
}

export async function falBody(request: RenderRequest): Promise<Record<string, unknown>> {
	const common = { prompt: request.prompt, duration: String(request.duration_s), resolution: request.resolution, generate_audio: request.generate_audio };
	const references = request.references ?? [];
	if (!references.length) {
		if (!request.still) throw new RenderProviderError('A render on fal.ai needs its still', 'error');
		return { ...common, image_url: await address(request.still) };
	}
	// reference-to-video has no start frame of its own: the still leads the reference images.
	return { ...common, task: 'reference', image_urls: await Promise.all([...(request.still ? [request.still] : []), ...references].map(address)), ...(request.aspect_ratio ? { aspect_ratio: request.aspect_ratio } : {}) };
}

async function reason(response: Response): Promise<string> {
	const body = (await response.json().catch(() => null)) as { detail?: unknown; error?: unknown; error_type?: unknown } | null;
	const detail = body?.detail ?? (body?.error as { message?: unknown })?.message ?? body?.error ?? body?.error_type;
	return (typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : response.statusText || 'no reason given').slice(0, 2000);
}

export function createFalProvider(key: string | null | undefined, fetcher: Fetch = fetch): RenderProvider {
	const token = key?.trim() || null;
	const call = async (url: string, init: RequestInit = {}): Promise<Response> => {
		if (!token) throw new RenderProviderError('FAL_KEY is not set', 'error');
		return fetcher(url, { ...init, headers: { Authorization: `Key ${token}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) } });
	};
	const ok = async (response: Response): Promise<Response> => {
		if (!response.ok) throw new RenderProviderError(`fal.ai answered ${response.status}: ${await reason(response)}`, response.status);
		return response;
	};
	return {
		id: 'fal',
		label: 'fal.ai',
		models: [
			{ id: 'seedance_2_5', label: 'Seedance 2.5', kind: 'video', wired: true },
			{ id: 'fal-ai/nano-banana-pro', label: 'Nano Banana Pro', kind: 'still', wired: false },
			{ id: 'openai/gpt-image-2', label: 'GPT Image 2', kind: 'still', wired: false }
		],
		resolutions: ['480p', '720p', '1080p'],
		async setup() {
			return token ? { ready: true } : { ready: false, reason: 'FAL_KEY is not set' };
		},
		async price(request) {
			const endpoint = falEndpoint(request);
			const response = await ok(await call(`${PRICING}?endpoint_id=${encodeURIComponent(endpoint)}`));
			const body = (await response.json()) as { prices?: Array<{ endpoint_id?: string; unit_price?: number; unit?: string; currency?: string }> };
			const price = body.prices?.find((entry) => entry.endpoint_id === endpoint);
			if (!price || typeof price.unit_price !== 'number') throw new RenderProviderError('fal.ai gave no price for this model', response.status);
			if (price.currency && price.currency !== 'USD') throw new RenderProviderError(`fal.ai priced this in ${price.currency}, not dollars`, response.status);
			const unit = (price.unit ?? '').toLowerCase();
			const amount = /second/.test(unit) ? price.unit_price * request.duration_s : /video|request|generation/.test(unit) ? price.unit_price : NaN;
			if (!Number.isFinite(amount)) throw new RenderProviderError(`fal.ai prices this per "${price.unit}", which cannot be turned into a total here`, response.status);
			return { amount: Math.round(amount * 1e4) / 1e4, unit: 'usd' };
		},
		async send(request) {
			if (!token) throw new RenderProviderError('FAL_KEY is not set', 'error');
			const response = await ok(await call(`${QUEUE}/${falEndpoint(request)}`, { method: 'POST', body: JSON.stringify(await falBody(request)) }));
			const body = (await response.json()) as { request_id?: unknown };
			if (typeof body.request_id !== 'string' || !body.request_id) throw new RenderProviderError('fal.ai started no request', response.status);
			return { job_id: body.request_id, answer_code: response.status };
		},
		async check(job): Promise<RenderCheck> {
			const base = `${QUEUE}/${falApp(FAL_IMAGE_TO_VIDEO)}/requests/${encodeURIComponent(job.job_id)}`;
			const status = await call(`${base}/status`);
			if (!status.ok) return { state: 'failed', error: await reason(status), answer_code: status.status };
			const body = (await status.json()) as { status?: string; error?: string; error_type?: string };
			if (body.status === 'IN_QUEUE') return { state: 'queued', answer_code: status.status };
			if (body.status !== 'COMPLETED') return { state: 'rendering', answer_code: status.status };
			const result = await call(base);
			if (body.error || !result.ok) {
				const error = body.error ?? (await reason(result));
				const refused = /content|policy|moderat|safety/i.test(`${body.error_type ?? ''} ${error}`);
				return { state: refused ? 'refused' : 'failed', error, answer_code: result.ok ? (body.error_type ?? 'failed') : result.status };
			}
			const url = ((await result.json()) as { video?: { url?: unknown } }).video?.url;
			return typeof url === 'string' && url ? { state: 'done', url, answer_code: result.status } : { state: 'failed', error: 'fal.ai finished without a video', answer_code: result.status };
		},
		async cancel(job) {
			const response = await call(`${QUEUE}/${falApp(FAL_IMAGE_TO_VIDEO)}/requests/${encodeURIComponent(job.job_id)}/cancel`, { method: 'PUT' });
			// 200: taken out of the queue. 202: asked to stop, and it may still finish.
			return { cancelled: response.status === 200, answer_code: response.status };
		}
	};
}
