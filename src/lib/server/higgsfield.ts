/**
 * Video generator seam (Animate) and its Higgsfield API implementation.
 * https://docs.higgsfield.ai — async: submit to a model path, poll
 * /requests/{id}/status, download video.url. /estimate/<model> prices the
 * exact body first; /files/generate-upload-url takes local inputs, since
 * models only read public URLs. The API bills its own dollar balance,
 * separate from higgsfield.ai plan credits.
 */

export type GenerationStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw';

export interface Estimate {
	credits: number;
	usd: number;
}

export interface VideoGenerator {
	upload(bytes: Uint8Array, contentType: string): Promise<string>;
	estimate(model: string, body: Record<string, unknown>): Promise<Estimate>;
	submit(model: string, body: Record<string, unknown>, idempotencyKey: string): Promise<{ request_id: string }>;
	status(requestId: string): Promise<{ status: GenerationStatus; video_url?: string; error?: string }>;
}

export class GeneratorError extends Error {}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createHiggsfieldGenerator(credentials: string, options: { baseURL?: string; fetchImpl?: FetchLike } = {}): VideoGenerator {
	const base = (options.baseURL ?? 'https://api.higgsfield.ai').replace(/\/$/, '');
	const send = options.fetchImpl ?? fetch;
	const auth = { authorization: `Key ${credentials}` };

	async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await send(`${base}${path}`, { ...init, headers: { ...auth, 'content-type': 'application/json', ...(init.headers ?? {}) } });
		const text = await response.text();
		if (!response.ok) throw new GeneratorError(`Higgsfield ${response.status}: ${text.slice(0, 300) || response.statusText}`);
		return JSON.parse(text) as T;
	}

	return {
		async upload(bytes, contentType) {
			const slot = await call<{ upload_url: string; public_url: string; upload_headers?: Record<string, string> }>('/files/generate-upload-url', {
				method: 'POST', body: JSON.stringify({ content_type: contentType })
			});
			// The presigned storage URL never gets the API credentials.
			const put = await send(slot.upload_url, { method: 'PUT', headers: { 'content-type': contentType, ...(slot.upload_headers ?? {}) }, body: bytes as unknown as BodyInit });
			if (!put.ok) throw new GeneratorError(`Higgsfield upload failed: ${put.status}`);
			return slot.public_url;
		},
		async estimate(model, body) {
			const result = await call<{ credits: string | number; usd: string | number }>(`/estimate/${model}`, { method: 'POST', body: JSON.stringify(body) });
			return { credits: Number(result.credits), usd: Number(result.usd) };
		},
		async submit(model, body, idempotencyKey) {
			const result = await call<{ request_id: string }>(`/${model}`, { method: 'POST', body: JSON.stringify(body), headers: { 'idempotency-key': idempotencyKey } });
			return { request_id: result.request_id };
		},
		async status(requestId) {
			const result = await call<{ status: GenerationStatus; video?: { url?: string }; error?: string; detail?: string }>(`/requests/${encodeURIComponent(requestId)}/status`, { method: 'GET' });
			return { status: result.status, video_url: result.video?.url, error: result.error ?? result.detail };
		}
	};
}
