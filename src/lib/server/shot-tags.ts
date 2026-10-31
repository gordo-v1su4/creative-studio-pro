import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProductionAsset, Project } from '$lib/domain/schemas';
import { motionOf, wordsFromCaption, type ShotTags } from '$lib/domain/shot-tags';
import { generateStructured, type AgentModelClient, type ModelImage } from './model-provider';
import { runFfmpeg } from './ffmpeg';
import { readFrameSignal } from './frame-signal';

/**
 * Tagging one take: a caption of its middle frame (the operator's caption gateway, Qwen3-VL; the Agent's
 * model only where no gateway is set up) and its motion, inner cuts and real length, measured from every frame.
 * One take per call, so a slow or failed caption costs that take only. A gateway that is set up but not
 * answering fails the take fast: falling back to the Agent's model would take minutes a shot and stall a run.
 */
export interface CaptionGateway { url: string; token: string }

export interface TagDeps {
	gateway: CaptionGateway | null;
	agent: () => Promise<AgentModelClient | null>;
	fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

const ASK = 'Also include titleCard: true only if the frame is a title card, logo or end card (mostly text or a logo), else false. Name people only if the context names them and the frame clearly shows them.';

/** A 512px JPEG of a local image or video file (for a video, the frame at `at` seconds). */
export async function frameOf(file: string, at: number | null): Promise<ModelImage | null> {
	const dir = await mkdtemp(join(tmpdir(), 'csp-frame-'));
	const out = join(dir, 'frame.jpg');
	try {
		await runFfmpeg(['-y', ...(at !== null ? ['-ss', at.toFixed(2)] : []), '-i', file, '-frames:v', '1', '-vf', 'scale=512:512:force_original_aspect_ratio=decrease', '-q:v', '4', out], 60_000);
		return { data: new Uint8Array(await readFile(out)), mediaType: 'image/jpeg' };
	} catch {
		return null;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function captionByGateway(gateway: CaptionGateway, image: ModelImage, context: string, source: string, fetchImpl: TagDeps['fetch'] = fetch): Promise<Record<string, unknown>> {
	const form = new FormData();
	form.set('image', new Blob([image.data as Uint8Array<ArrayBuffer>], { type: image.mediaType }), 'frame.jpg');
	form.set('mode', 'smart');
	form.set('prompt', ASK);
	form.set('sourceName', source.slice(0, 200));
	form.set('captionContext', context.slice(0, 1500));
	// The gateway answers in seconds; two minutes covers waiting on its GPU lock behind another job.
	const response = await fetchImpl(`${gateway.url.replace(/\/+$/, '')}/caption/scene`, { method: 'POST', body: form, headers: { authorization: `Bearer ${gateway.token}` }, signal: AbortSignal.timeout(120_000) }).catch((cause) => { throw new Error(`Caption gateway not answering (${cause instanceof Error ? cause.message : 'network'}); check its backend on app-vm`); });
	const body = (await response.json().catch(() => null)) as { ok?: boolean; caption?: string; meta?: Record<string, unknown>; detail?: string } | null;
	if (!response.ok || !body?.caption) throw new Error(`Caption gateway ${response.status}: ${body?.detail ?? 'no caption'}`);
	return { ...(body.meta ?? {}), caption: body.caption };
}

async function captionByAgent(client: AgentModelClient, image: ModelImage, context: string): Promise<Record<string, unknown>> {
	const system = 'You caption one frame from a film shot for an editor. Answer with compact JSON only.';
	const prompt = `Return JSON with keys: caption (one concrete sentence), shotType, subjects (array), action, setting, lighting, timeOfDay, titleCard (boolean). ${ASK}\n\nContext: ${context.slice(0, 1500)}`;
	return generateStructured(client, { system, prompt, images: [image], maxOutputTokens: 400, timeoutMs: 180_000 }, (value) => {
		if (!value || typeof value !== 'object' || typeof (value as Record<string, unknown>).caption !== 'string') throw new Error('no caption');
		return value as Record<string, unknown>;
	});
}

/** What the caption model is told about the take: the project, the shot's title and beat, and the prompt it was made from. */
export function captionContext(project: Project, take: ProductionAsset): string {
	const card = project.production.cards.find((entry) => entry.card_id === take.card_id);
	return [
		`Project: ${project.title}.`,
		card ? `Shot: ${card.title}. ${card.beat.startsWith('Dropped in:') ? '' : card.beat}` : '',
		take.generation?.prompt ? `Made from this prompt: ${take.generation.prompt.replace(/\s+/g, ' ').slice(0, 700)}` : ''
	].filter(Boolean).join(' ');
}

/** Tag one take of a local file. */
export async function tagTake(deps: TagDeps, project: Project, take: ProductionAsset, file: string): Promise<ShotTags> {
	const isVideo = take.kind === 'video';
	const signal = isVideo ? await readFrameSignal(file) : null;
	const decoded = signal && signal.fps > 0 ? Math.round(((signal.diffs.length + 1) / signal.fps) * 1000) / 1000 : undefined;
	const in_s = isVideo ? (take.in_s ?? 0) : 0;
	const out_s = isVideo ? Math.min(take.out_s ?? take.duration_s ?? decoded ?? Infinity, decoded ?? Infinity) : 0;
	const middle = isVideo ? (Number.isFinite(out_s) ? (in_s + out_s) / 2 : in_s) : null;
	const image = (await frameOf(file, middle)) ?? (isVideo ? await frameOf(file, 0) : null);
	if (!image) throw new Error(`Could not read a frame of ${take.name}`);
	const context = captionContext(project, take);

	let meta: Record<string, unknown> | null = null;
	let source: ShotTags['source'] = 'caption-gateway';
	let model: string | undefined;
	if (deps.gateway) {
		meta = await captionByGateway(deps.gateway, image, context, take.name, deps.fetch);
		model = 'qwen3-vl';
	} else {
		const client = await deps.agent();
		if (!client) throw new Error('No caption gateway and no Agent model to caption with');
		meta = await captionByAgent(client, image, context);
		source = 'agent';
	}
	const moved = signal ? motionOf(signal, in_s, out_s) : { motion: 0, cuts: 0 };
	return { ...wordsFromCaption(meta), ...moved, ...(decoded ? { duration_s: decoded } : {}), source, ...(model ? { model } : {}), at: new Date().toISOString() };
}
