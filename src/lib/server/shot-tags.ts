import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProductionAsset, Project } from '$lib/domain/schemas';
import { motionOf, wordsFromCaption, type ShotTags } from '$lib/domain/shot-tags';
import { generateStructured, type AgentModelClient, type ModelImage } from './model-provider';
import { runFfmpeg } from './ffmpeg';
import { readFrameSignal } from './frame-signal';
import { castFor, namedSubjects, type CastHeadshot, type CastMember } from './caption-cast';
import type { SeriesReferenceItem } from './references';

/**
 * Tagging one take: a caption of its middle frame (the operator's caption gateway, Qwen3-VL; the Agent's
 * model only where no gateway is set up) and its motion, inner cuts and real length, measured from every frame.
 * One take per call, so a slow or failed caption costs that take only. A gateway that is set up but not
 * answering fails the take fast: falling back to the Agent's model would take minutes a shot and stall a run.
 */
export interface CaptionGateway { url: string; token: string }

export interface TagDeps {
	gateway: CaptionGateway | null;
	/** The series' characters and how to get each one's headshot; absent = captions name nobody. */
	cast?: { references: SeriesReferenceItem[]; regulars: SeriesReferenceItem[]; headshot: (reference: SeriesReferenceItem) => Promise<ModelImage | null> };
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

/**
 * The gateway stops its Qwen backend after ten idle minutes; whoever calls it wakes it first (as stack-structure does).
 * Asking to start an already running backend is harmless, so two takes tagged at once can both ask.
 */
export async function wakeCaptionGateway(gateway: CaptionGateway, fetchImpl: TagDeps['fetch'] = fetch, timeoutMs = 300_000, pollMs = 3_000): Promise<void> {
	const base = gateway.url.replace(/\/+$/, '');
	const headers = { authorization: `Bearer ${gateway.token}` };
	const healthy = async () => {
		const response = await fetchImpl(`${base}/health`, { headers, signal: AbortSignal.timeout(10_000) }).catch(() => null);
		const body = (await response?.json().catch(() => null)) as { qwenBackendHealthy?: boolean } | null;
		return body?.qwenBackendHealthy === true;
	};
	if (await healthy()) return;
	const started = await fetchImpl(`${base}/admin/qwen/start`, { method: 'POST', headers, signal: AbortSignal.timeout(35_000) }).catch((cause) => { throw new Error(`Caption gateway not answering (${cause instanceof Error ? cause.message : 'network'}); check it on app-vm`); });
	if (!started.ok) {
		const body = (await started.json().catch(() => null)) as { detail?: string } | null;
		throw new Error(`Caption gateway could not wake its model (${started.status}): ${body?.detail ?? 'no detail'}`);
	}
	for (const until = Date.now() + timeoutMs; Date.now() < until;) {
		await new Promise((done) => setTimeout(done, pollMs));
		if (await healthy()) return;
	}
	throw new Error(`Caption gateway's model did not wake within ${Math.round(timeoutMs / 1000)} s; check its backend on app-vm`);
}

/** Stack-structure's identity rules (sceneCaptionPrompt.ts), for frames sent with character headshots. */
const NAME_RULES = 'Character reference headshots come before the frame; each is labelled with its name. Use a listed name, exactly as given, only when a person in the frame is recognizably that character by face and identity, never by clothes, gender or importance. Name a matched character and do not describe their hair, face, body or clothes. A person who matches no headshot is "unknown"; when unsure, answer unknown. subjects must be listed names or "unknown", never descriptions. Also return evidence.subjects as [{ name, confidence: "supported" | "uncertain", role: "focal" | "background" }].';

async function captionByGateway(gateway: CaptionGateway, image: ModelImage, context: string, source: string, fetchImpl: TagDeps['fetch'] = fetch, headshots: CastHeadshot[] = []): Promise<Record<string, unknown>> {
	const form = new FormData();
	form.set('image', new Blob([image.data as Uint8Array<ArrayBuffer>], { type: image.mediaType }), 'frame.jpg');
	form.set('mode', 'smart');
	form.set('prompt', headshots.length ? `${ASK} ${NAME_RULES}` : ASK);
	form.set('sourceName', source.slice(0, 200));
	form.set('captionContext', (headshots.length ? `Characters who may appear: ${headshots.map((h) => h.label).join(', ')}. ${context}` : context).slice(0, 1500));
	headshots.forEach((headshot, index) => {
		form.append('referenceImages', new Blob([headshot.image.data as Uint8Array<ArrayBuffer>], { type: headshot.image.mediaType }), `${headshot.label}.jpg`);
		form.append('referenceLabels', JSON.stringify({ name: headshot.label, role: index === 0 ? 'primary' : 'secondary' }));
	});
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
	const cast: CastMember[] = [];
	if (deps.gateway) {
		const headshots: CastHeadshot[] = [];
		if (deps.cast) {
			const card = project.production.cards.find((entry) => entry.card_id === take.card_id);
			for (const member of castFor({ title: `${take.name} · ${card?.title ?? ''}`, body: context }, deps.cast.references, deps.cast.regulars)) {
				const headshot = await deps.cast.headshot(member.reference);
				if (headshot) { headshots.push({ label: member.label, image: headshot }); cast.push(member); }
			}
		}
		await wakeCaptionGateway(deps.gateway, deps.fetch);
		meta = await captionByGateway(deps.gateway, image, context, take.name, deps.fetch, headshots);
		if (cast.length) meta = { ...meta, subjects: namedSubjects(meta, cast) };
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
