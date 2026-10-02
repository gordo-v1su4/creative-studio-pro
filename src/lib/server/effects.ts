import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import type { ProjectCommandGateway } from '$lib/application/gateway';
import type { ProjectStore } from '$lib/adapters/project-store';
import type { PlacedEffect, Project } from '$lib/domain/schemas';
import { cutsOf } from '$lib/domain/cuts';
import { checkProposals, classifyEffect, cutMoments, impactMoments, type GenerateOffer, type Moment, type SfxFile } from '$lib/domain/effects';
import { defaultSoundPlan, layLevels } from '$lib/domain/sound';
import { safeFileName } from '$lib/domain/media';
import { programElapsed } from '$lib/media/speed-curve';
import { generateStructured, type AgentModelClient } from '$lib/server/model-provider';
import { PCM_RATE, readPcm } from '$lib/server/audio-envelope';
import { probeMedia } from '$lib/server/media-probe';
import type { SoundEffectGenerator } from '$lib/server/higgsfield';

type Failure = { ok: false; status: number; message: string };
const failure = (status: number, message: string): Failure => ({ ok: false, status, message });
const HZ = 100;
const MAX_INDEX = 6000;
/** How many files of each kind the Agent sees (spread across the folder). */
const PER_KIND = 60;

const indexCache = new Map<string, { at: number; files: SfxFile[] }>();

/** Forget the cached index (the folder setting changed, or its files did). */
export function clearSfxIndex(): void {
	indexCache.clear();
}

/** Every effect (hit, whoosh, riser) in the folder, by path; loops, drums and the like left out. Cached for five minutes. */
export async function indexSfx(folder: string): Promise<SfxFile[]> {
	const root = resolve(folder);
	const hit = indexCache.get(root);
	if (hit && Date.now() - hit.at < 300_000) return hit.files;
	const names = (await readdir(root, { recursive: true })) as string[];
	const files: SfxFile[] = [];
	for (const name of names) {
		const id = name.split(sep).join('/');
		const kind = classifyEffect(id);
		if (kind) files.push({ id, name: basename(id), kind });
		if (files.length >= MAX_INDEX) break;
	}
	files.sort((a, b) => a.id.localeCompare(b.id));
	indexCache.set(root, { at: Date.now(), files });
	return files;
}

/** A spread of up to PER_KIND files per kind, so a big library still fits in the Agent's prompt. */
function shortlist(index: SfxFile[]): SfxFile[] {
	return (['hit', 'whoosh', 'riser'] as const).flatMap((kind) => {
		const all = index.filter((file) => file.kind === kind);
		const step = Math.max(1, all.length / PER_KIND);
		return Array.from({ length: Math.min(PER_KIND, all.length) }, (_, i) => all[Math.floor(i * step)]);
	});
}

interface Deps { gateway: ProjectCommandGateway; store: ProjectStore; projectRoot: string }

function localFile(projectRoot: string, projectId: string, url: string): string | null {
	const files = resolve(join(projectRoot, projectId, 'files'));
	const prefix = `/api/projects/${projectId}/files/`;
	if (!url.startsWith(prefix)) return null;
	const file = resolve(join(files, decodeURIComponent(url.slice(prefix.length))));
	return file.startsWith(files + sep) ? file : null;
}

/** The moments of a locked version: every cut, and impacts in its take audio. */
async function momentsOf(deps: Deps, project: Project, entries: NonNullable<ReturnType<typeof cutsOf>[number]['versions']>[number]['entries']): Promise<Moment[]> {
	const lengths = entries.map((entry) => programElapsed(entry.speed, entry.out_s - entry.in_s));
	const total = lengths.reduce((s, l) => s + l, 0);
	const titles = entries.map((entry) => project.production.cards.find((card) => card.card_id === entry.card_id)?.title ?? entry.card_id);
	const activity = new Array<number>(Math.ceil(total * HZ)).fill(-120);
	let at = 0;
	for (const [i, entry] of entries.entries()) {
		const take = project.production.assets.find((asset) => asset.asset_id === entry.asset_id);
		const file = take ? localFile(deps.projectRoot, project.project_id, take.url) : null;
		const pcm = file ? await readPcm(file).catch(() => null) : null;
		if (pcm) layLevels(activity, HZ, pcm, PCM_RATE, { in_s: entry.in_s, out_s: entry.out_s, speed: entry.speed, at_s: at });
		at += lengths[i];
	}
	const cuts = cutMoments(entries.map((_, i) => ({ title: titles[i], length_s: lengths[i] })));
	// An impact right on a cut is the cut.
	const impacts = impactMoments(activity, HZ).filter((m) => cuts.every((c) => Math.abs(c.at_s - m.at_s) > 0.15));
	return [...cuts, ...impacts].sort((a, b) => a.at_s - b.at_s).slice(0, 60);
}

/**
 * The Agent proposes effects for a locked version: from the local folder at
 * cuts and impacts, or "generate" offers the operator approves first. Picks
 * are copied into the project and saved as suggestions (replacing earlier
 * suggestions); the operator keeps or removes each.
 */
export async function proposeEffects(deps: Deps, client: AgentModelClient, input: { projectId: string; cutId: string; version: number; folder: string | null; rules: string | null }): Promise<{ ok: true; project: Project; offers: GenerateOffer[]; dropped: string[]; moments: number } | Failure> {
	const project = await deps.store.readProject(input.projectId);
	if (!project) return failure(404, 'Project not found');
	const cut = cutsOf(project.production).find((entry) => entry.cut_id === input.cutId);
	const locked = cut?.versions?.find((v) => v.version === input.version);
	if (!cut || !locked) return failure(400, 'Lay sound against a locked cut version');
	const index = input.folder ? await indexSfx(input.folder).catch(() => []) : [];
	const moments = await momentsOf(deps, project, locked.entries);
	if (!moments.length) return failure(400, 'This cut has no cuts or impacts to put effects on');
	const offered = shortlist(index);

	const system = [
		'You are the Agent in Creative Studio Pro, doing the effects pass on a locked trailer cut.',
		'Pick added sound effects for the moments listed (cuts between shots, and impacts heard in the take audio). Not every moment needs one: hit the big moments, keep the rest clean.',
		'Use files from the effects list by their exact id: risers lead into a cut (they are placed to end on it), whooshes carry a cut, hits land on impacts and hard cuts.',
		'When nothing in the list fits a moment that really needs a sound, you may ask to generate one: give a short sound description in "generate" and a duration in seconds (0.5–5). The operator approves and pays for each before it is made, so use this sparingly.',
		'Follow the project rules. Return JSON only: {"effects": [{"moment_s": number, "sfx_id": string, "reason": string} | {"moment_s": number, "generate": string, "duration_s": number, "reason": string}]}.'
	].join('\n');
	const prompt = JSON.stringify({
		moments: moments.map((m) => ({ moment_s: m.at_s, kind: m.kind, what: m.note })),
		effects: offered.map((file) => ({ id: file.id, kind: file.kind })),
		effects_folder: input.folder ? (index.length ? `${index.length} effects indexed; a spread is listed` : 'no effects found in the folder') : 'no effects folder set (generate only)',
		project_rules: input.rules ?? '(none)'
	}, null, 2);
	let answer: unknown;
	try {
		answer = await generateStructured(client, { system, prompt, maxOutputTokens: 2000 }, (value) => {
			if (!Array.isArray((value as { effects?: unknown })?.effects)) throw new Error('effects must be an array');
			return value;
		});
	} catch (cause) {
		return failure(502, `The Agent couldn't propose effects: ${cause instanceof Error ? cause.message : 'model error'}`);
	}

	// Lengths of the picked files (risers end on their moment), then check the whole answer.
	const durations: Record<string, number> = {};
	for (const item of ((answer as { effects: Array<{ sfx_id?: unknown }> }).effects ?? []).slice(0, 40)) {
		const id = typeof item.sfx_id === 'string' ? item.sfx_id : null;
		if (!id || durations[id] !== undefined || !input.folder || !index.some((file) => file.id === id)) continue;
		durations[id] = (await probeMedia(join(resolve(input.folder), ...id.split('/')))).duration_s ?? 1;
	}
	const { placed, offers, dropped } = checkProposals(answer, moments, index, durations);

	// Copy picks into the project (the mix only reads project files) and save them as suggestions.
	const folder = join(resolve(deps.projectRoot), input.projectId, 'files', 'sound', 'sfx');
	await mkdir(folder, { recursive: true });
	const suggestions: PlacedEffect[] = [];
	for (const pick of placed) {
		const name = `${safeFileName(pick.sfx_id.replace(/\//g, '__'))}`;
		await copyFile(join(resolve(input.folder!), ...pick.sfx_id.split('/')), join(folder, name)).catch(() => undefined);
		suggestions.push({ effect_id: crypto.randomUUID(), url: `/api/projects/${input.projectId}/files/sound/sfx/${encodeURIComponent(name)}`, name: basename(pick.sfx_id), at_s: pick.at_s, ...(pick.from_s ? { from_s: pick.from_s } : {}), gain_db: 0, suggested: true, note: pick.reason || `at ${pick.moment_s}s` });
	}
	const plan = locked.sound ?? defaultSoundPlan();
	const saved = await deps.gateway.setSoundPlan({
		command: 'set_sound_plan', project_id: input.projectId, expected_version: project.version, cut_id: input.cutId, version: input.version,
		plan: { ...plan, effects: [...plan.effects.filter((e) => !e.suggested), ...suggestions].sort((a, b) => a.at_s - b.at_s) }
	});
	if (!saved.ok) return failure(409, saved.error.message);
	return { ok: true, project: saved.data, offers, dropped, moments: moments.length };
}

/** Price a generated effect (free check). */
export async function quoteEffect(generator: SoundEffectGenerator | null, request: { prompt: string; duration_s: number }): Promise<{ ok: true; credits: number } | Failure> {
	if (!generator) return failure(503, 'The Higgsfield CLI was not found; see Settings');
	try { return { ok: true, credits: (await generator.estimate(request)).credits }; }
	catch (cause) { return failure(502, cause instanceof Error ? cause.message : 'Price check failed'); }
}

/**
 * Generate an effect after the operator confirmed its price: re-quote, refuse
 * if it went up, submit, wait for it, download it into the project, and add
 * it (kept) to the version's effects.
 */
export async function generateEffect(
	deps: Deps & { generator: SoundEffectGenerator | null; download: (url: string) => Promise<Uint8Array>; wait?: (ms: number) => Promise<void> },
	input: { projectId: string; cutId: string; version: number; prompt: string; duration_s: number; at_s: number; confirmed_credits: number }
): Promise<{ ok: true; project: Project } | Failure> {
	const quote = await quoteEffect(deps.generator, input);
	if (!quote.ok) return quote;
	if (quote.credits > input.confirmed_credits + 1e-6) return failure(422, `The price is now ${quote.credits} credits, above the ${input.confirmed_credits} you confirmed`);
	const wait = deps.wait ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
	const { job_id } = await deps.generator!.submit(input);
	let result: Awaited<ReturnType<SoundEffectGenerator['status']>> = { status: 'queued' };
	for (let i = 0; i < 90 && (result.status === 'queued' || result.status === 'in_progress'); i++) {
		await wait(2000);
		result = await deps.generator!.status(job_id);
	}
	if (result.status !== 'completed' || !result.url) return failure(502, `The effect didn't generate (${result.status}${result.error ? `: ${result.error}` : ''})`);
	const folder = join(resolve(deps.projectRoot), input.projectId, 'files', 'sound', 'generated');
	await mkdir(folder, { recursive: true });
	const name = `${job_id.slice(0, 8)}-${safeFileName(input.prompt.slice(0, 40))}${extname(new URL(result.url).pathname) || '.mp3'}`;
	await writeFile(join(folder, name), await deps.download(result.url));
	const project = await deps.store.readProject(input.projectId);
	const locked = project ? cutsOf(project.production).find((c) => c.cut_id === input.cutId)?.versions?.find((v) => v.version === input.version) : null;
	if (!project || !locked) return failure(404, 'That cut version is gone');
	const plan = locked.sound ?? defaultSoundPlan();
	const effect: PlacedEffect = { effect_id: crypto.randomUUID(), url: `/api/projects/${input.projectId}/files/sound/generated/${encodeURIComponent(name)}`, name: `${input.prompt.slice(0, 60)}`, at_s: input.at_s, gain_db: 0, note: `generated: ${input.prompt}` };
	const saved = await deps.gateway.setSoundPlan({ command: 'set_sound_plan', project_id: input.projectId, expected_version: project.version, cut_id: input.cutId, version: input.version, plan: { ...plan, effects: [...plan.effects, effect].sort((a, b) => a.at_s - b.at_s) } });
	return saved.ok ? { ok: true, project: saved.data } : failure(409, saved.error.message);
}

/** How many effects the folder has, by kind (Settings). */
export async function sfxSummary(folder: string | null): Promise<{ folder: string | null; exists: boolean; counts: Record<string, number> }> {
	if (!folder) return { folder, exists: false, counts: {} };
	try { if (!(await stat(folder)).isDirectory()) return { folder, exists: false, counts: {} }; } catch { return { folder, exists: false, counts: {} }; }
	const index = await indexSfx(folder);
	const counts: Record<string, number> = {};
	for (const file of index) counts[file.kind] = (counts[file.kind] ?? 0) + 1;
	return { folder, exists: true, counts };
}
