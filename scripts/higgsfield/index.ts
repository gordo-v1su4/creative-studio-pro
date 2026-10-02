/**
 * Higgsfield API — Seedance 2.5 / 2.0 text-to-video through the official SDK (@higgsfield/client).
 *
 * This is the Higgsfield API (console.higgsfield.ai): its own pay-per-use dollar balance, billed per request,
 * no draft/finalize. It is a different service from the Higgsfield CLI (`hf`) the app's Animate, Finalize and
 * Trailer House renders use, which runs on the higgsfield.ai plan's credits and has 480p drafts.
 *
 *   bun scripts/higgsfield/index.ts                    price only (free): Seedance 2.5, 480p, 4 s, no audio
 *   bun scripts/higgsfield/index.ts --model 2.0        price Seedance 2.0 instead
 *   bun scripts/higgsfield/index.ts --run              price, then generate (BILLABLE) and print the video URL
 *   options: --resolution 480p|720p  --duration 4..30  --audio  --aspect 16:9
 *
 * The key is HIGGSFIELD_KEY in .env.local (git-ignored; Bun loads it), as KEY_ID:KEY_SECRET. It is passed to the
 * SDK directly (the SDK's own variable name is not used) and is never printed or logged.
 */
import { config, higgsfield } from '@higgsfield/client/v2';

const MODELS = {
	'2.5': { id: 'bytedance/seedance-2.5/text-to-video', resolutions: ['480p', '720p'], maxDuration: 30 },
	'2.0': { id: 'bytedance/seedance-2.0/text-to-video', resolutions: ['480p', '720p', '1080p', '4k'], maxDuration: 15 }
} as const;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };

const modelKey = option('model', '2.5') as keyof typeof MODELS;
const model = MODELS[modelKey];
if (!model) fail(`Unknown model ${modelKey}; use 2.5 or 2.0`);
const input = {
	prompt: 'A cinematic scene at sunset',
	duration: Number(option('duration', '4')),
	resolution: option('resolution', '480p'),
	aspect_ratio: option('aspect', '16:9'),
	generate_audio: flag('audio')
};
if (!(model.resolutions as readonly string[]).includes(input.resolution)) fail(`Seedance ${modelKey} takes ${model.resolutions.join(', ')}`);
if (!Number.isInteger(input.duration) || input.duration < 4 || input.duration > model.maxDuration) fail(`Seedance ${modelKey} takes 4–${model.maxDuration} seconds`);

const credentials = process.env.HIGGSFIELD_KEY?.trim();
if (!credentials) fail('No API key: add HIGGSFIELD_KEY to .env.local as KEY_ID:KEY_SECRET (Higgsfield API, not the CLI)');
if (!/^[^:\s]+:[^:\s]+$/.test(credentials)) fail('The credentials are not in KEY_ID:KEY_SECRET form (value not shown)');

function fail(message: string): never {
	console.error(`✗ ${message}`);
	process.exit(1);
}

/** Output pixels per resolution at 16:9 (other aspects are close enough for a rough figure). */
const PIXELS: Record<string, number> = { '480p': 864 * 480, '720p': 1280 * 720, '1080p': 1920 * 1080, '4k': 3840 * 2160 };

/**
 * The free estimate for exactly these parameters (documented: POST /estimate/<model>). Seedance answers with a
 * pricing description rather than a number, so a rough dollar figure is worked out from its stated rates.
 */
async function estimate(): Promise<string> {
	const response = await fetch(`https://api.higgsfield.ai/estimate/${model.id}`, {
		method: 'POST',
		headers: { Authorization: `Key ${credentials}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (response.status === 401 || response.status === 403) fail(`Estimate refused (HTTP ${response.status}): the API key was not accepted`);
	if (!response.ok) fail(`Estimate failed (HTTP ${response.status}): ${(await response.text()).slice(0, 300)}`);
	const body = (await response.json()) as { credits?: string; usd?: string; pricing_description?: string };
	if (body.usd) return `${body.credits} credits ($${body.usd})`;
	const text = body.pricing_description ?? '';
	const perSecond = text.match(new RegExp(`\\$([\\d.]+) per second of generated video at ${input.resolution}`)) ?? text.match(new RegExp(`\\$([\\d.]+) at ${input.resolution}`));
	if (perSecond) return `≈ $${(Number(perSecond[1]) * input.duration).toFixed(2)} (${perSecond[1]} $/s at ${input.resolution}, from Higgsfield's pricing)`;
	const perThousand = text.match(/Per 1,000 video tokens:[^$]*\$([\d.]+)/);
	if (perThousand) {
		const tokens = Math.ceil((input.duration * PIXELS[input.resolution] * 24) / 1024);
		return `≈ $${((tokens / 1000) * Number(perThousand[1])).toFixed(2)} (${tokens.toLocaleString()} video tokens × $${perThousand[1]} per 1,000)`;
	}
	return `see Higgsfield's pricing: ${text.slice(0, 300)}`;
}

console.log(`Seedance ${modelKey} · ${input.resolution} · ${input.duration}s · ${input.aspect_ratio} · audio ${input.generate_audio ? 'on' : 'off'}`);
console.log(`Estimate: ${await estimate()}`);
if (!flag('run')) {
	console.log('Price only. Add --run to generate (billable).');
	process.exit(0);
}

config({ credentials });
console.log(`Submitting ${model.id} and waiting…`);
let result;
try {
	result = await higgsfield.subscribe(model.id, { input, withPolling: true });
} catch (cause) {
	const name = cause instanceof Error ? cause.constructor.name : 'Error';
	fail(`${name}: ${cause instanceof Error ? cause.message : String(cause)}`);
}
const status = result.status as string;
console.log(`Request ${result.request_id}: ${status}`);
if (status === 'completed' && result.video?.url) {
	console.log(`Video: ${result.video.url}`);
	process.exit(0);
}
if (status === 'completed') fail('Completed, but the response has no video URL');
if (status === 'nsfw') fail('Rejected by content moderation (not charged)');
if (status === 'failed') fail(`Generation failed (not charged): ${JSON.stringify((result as { error?: unknown }).error ?? null)}`);
if (status === 'canceled') fail('The request was canceled');
fail(`Stopped without a result (status ${status})`);
