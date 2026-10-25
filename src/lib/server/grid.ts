import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectCommandGateway } from '$lib/application/gateway';
import type { ProjectStore } from '$lib/adapters/project-store';
import type { Project, StoryCard } from '$lib/domain/schemas';
import { gridChunks, gridPrompt, gridShape, keyframeChunks, keyframePrompt, keyframeQc, keyframeShape, lookLine, type KeyframeShot } from '$lib/domain/grid';
import { SeriesStore } from './series';
import { uuid7ish } from '$lib/domain/ids';
import { lintPrompt } from '$lib/domain/prompt-lint';
import { bannedTerms } from '$lib/domain/brief-rules';
import { projectRules } from './animate';
import type { ImageGenerator } from './higgsfield';
import { quoteStill, sendStill, NO_CLI } from './stills';
import type { StillApproval } from '$lib/domain/stills';
import type { Splitter } from './splitter';
import type { MediaProbe } from './media-probe';
import { compileForSend, seriesReferences, type ReferenceFiles } from './references';
import { seriesReferenceIds } from '$lib/domain/shot-references';

/**
 * Grid stills (V1S-278): a scene's shots without a still, up to nine per grid, each grid one square still
 * (GPT Image 2.5 at 2K since V1S-373). Quote lints every grid and builds its approval (prompt, references in
 * attach order, credits, the episode's running total); send goes through the approval step (nothing is spent
 * while a prompt is blocked, the price rose, or the prompt changed since the approval); settle downloads the
 * grid, splits it with the splitter service and adds one still take per shot, each remembering its grid and panel.
 */
export interface GridDeps {
	store: ProjectStore; gateway: ProjectCommandGateway; projectRoot: string;
	images: ImageGenerator | null; splitter: Splitter | null;
	download: (url: string) => Promise<Uint8Array>; probe: (file: string) => Promise<MediaProbe>;
	/** Reference files to attach (V1S-326); absent = none available, so a grid using a handle is blocked. */
	referenceFiles?: ReferenceFiles;
}
type Failure = { ok: false; status: number; message: string; reasons?: string[] };
const fail = (status: number, message: string, reasons?: string[]): Failure => ({ ok: false, status, message, ...(reasons ? { reasons } : {}) });

export interface GridQuote { chunk: number; card_ids: string[]; titles: string[]; prompt: string; credits: number | null; blocked: string[]; /** Reference files attached, in image order (V1S-327). */ references: string[]; /** What the operator approves (V1S-373). */ approval: StillApproval }

export async function quoteGrids(deps: GridDeps, project: Project, groupId: string): Promise<{ ok: true; grids: GridQuote[] } | Failure> {
	if (!deps.images) return fail(503, NO_CLI);
	const scene = project.series?.scenes.find((entry) => entry.group_id === groupId);
	const group = project.production.groups?.find((entry) => entry.group_id === groupId);
	if (!group) return fail(404, 'That scene is not on the board');
	const hasStill = (cardId: string) => project.production.assets.some((asset) => asset.card_id === cardId && asset.kind === 'image' && !asset.rejected);
	const shots = project.production.cards.filter((card) => card.group_id === groupId && !card.benched && !hasStill(card.card_id)).toSorted((a, b) => a.order - b.order);
	const banned = bannedTerms(await projectRules(deps.projectRoot, project.project_id));
	const references = await seriesReferences(deps.projectRoot, project);
	// V1S-376: shots Ghost proposed become 2×2 keyframes once approved (wide shots alone); older shots keep the grid prompt.
	const legacy = shots.filter((card) => !card.fit?.spec);
	const approved = shots.filter((card) => card.fit?.spec && card.fit.approved_at).map((card) => ({ card, card_id: card.card_id, title: card.title, spec: card.fit!.spec! }));
	const look = project.series ? lookLine((await SeriesStore.beside(deps.projectRoot).read(project.series.series_id).catch(() => null))?.story?.text ?? '') : '';
	const chunks: Array<{ cards: StoryCard[]; keyframe: boolean; items?: KeyframeShot[] }> = [
		...gridChunks(legacy).map((cards) => ({ cards, keyframe: false })),
		...keyframeChunks(approved).map((items) => ({ cards: items.map((item) => item.card), keyframe: true, items }))
	];
	const grids: GridQuote[] = [];
	for (const [chunk, entry] of chunks.entries()) {
		const { cards } = entry;
		const written = entry.items
			? keyframePrompt({ scene: scene?.title ?? group.name, look, shots: entry.items })
			: gridPrompt({ scene: scene?.title ?? group.name, location: scene?.location ?? '', summary: scene?.summary ?? '', characters: scene?.characters ?? [], shots: cards.map((card) => ({ card_id: card.card_id, title: card.title, image_prompt: card.image_prompt, description: card.beat })) });
		// Handles (@Kai) become exact names with `image N` tags (keyframes) or image labels (older grids), and their sheets are attached.
		const compiled = await compileForSend(written, references, entry.keyframe ? 'ghost' : 'nano_banana', deps.referenceFiles, { series: [...new Set(cards.flatMap((card) => seriesReferenceIds(card)))] });
		const prompt = entry.keyframe ? compiled.prompt.replace(/^Upload:/m, 'References:') : compiled.prompt;
		const counts = new Map<string, number>();
		const findings = entry.keyframe
			? keyframeQc(prompt, compiled.attached.map((a) => a.name), banned).map((message) => `Keyframe QC: ${message}`)
			: lintPrompt(prompt, 'nano_banana', banned, { references }).issues.filter((issue) => issue.severity === 'error').map((issue) => `Prompt rule ${issue.rule}: ${issue.message}`);
		for (const key of findings) counts.set(key, (counts.get(key) ?? 0) + 1);
		const blocked = [...[...counts].map(([reason, n]) => (n > 1 ? `${reason} (×${n})` : reason)), ...compiled.blocked];
		const attached = compiled.attached.map((entry) => ({ ...entry, ...(entry.page_id && project.series ? { url: `/api/series/${project.series.series_id}/references?page_id=${entry.page_id}` } : {}) }));
		const approval = await quoteStill(deps, project, { prompt, attached, aspect_ratio: GRID_ASPECT, blocked });
		grids.push({ chunk, card_ids: cards.map((card) => card.card_id), titles: cards.map((card) => card.title), prompt, credits: approval.credits, blocked: approval.blocked, references: compiled.files, approval });
	}
	return { ok: true, grids };
}

/** A square grid of 16:9 panels (2×2, 3×3) is itself a 16:9 frame, and so is a shot that renders alone. */
const GRID_ASPECT = '16:9';

/** Send one grid after its approval; refused before any spend when blocked, pricier than approved, or changed since. */
export async function sendGrid(deps: GridDeps, input: { project_id: string; group_id: string; chunk: number; confirmed_credits: number; approval_key: string }): Promise<{ ok: true; job_id: string; card_ids: string[]; credits: number } | Failure> {
	const project = await deps.store.readProject(input.project_id);
	if (!project) return fail(404, 'Project not found');
	const quoted = await quoteGrids(deps, project, input.group_id);
	if (!quoted.ok) return quoted;
	const grid = quoted.grids.find((entry) => entry.chunk === input.chunk);
	if (!grid) return fail(400, 'That grid has nothing left to draw');
	const sent = await sendStill(deps, {
		project_id: input.project_id, purpose: 'grid', prompt: grid.prompt, attached: grid.approval.references, aspect_ratio: GRID_ASPECT,
		blocked: grid.blocked, approval_key: input.approval_key, confirmed_credits: input.confirmed_credits
	});
	return sent.ok ? { ok: true, job_id: sent.job_id, card_ids: grid.card_ids, credits: sent.credits } : sent;
}

/** Check a sent grid; when it is done, keep it, split it 3×3 and add a still take to each shot it was for. */
export async function settleGrid(deps: GridDeps, input: { project_id: string; job_id: string; card_ids: string[] }): Promise<{ ok: true; pending: true } | { ok: true; pending: false; project: Project; added: number } | Failure> {
	if (!deps.images || !deps.splitter) return fail(503, !deps.images ? 'The Higgsfield CLI is not set up' : 'The splitter is not configured (CSP_SPLITTER_URL)');
	const job = await deps.images.status(input.job_id);
	if (job.status === 'queued' || job.status === 'in_progress') return { ok: true, pending: true };
	if (job.status !== 'completed' || !job.url) return fail(502, `The grid failed: ${job.error ?? job.status}`);
	const folder = join(deps.projectRoot, input.project_id, 'files', 'grids');
	await mkdir(folder, { recursive: true });
	const gridName = `grid-${input.job_id.slice(0, 12)}.png`;
	const gridFile = join(folder, gridName);
	await writeFile(gridFile, await deps.download(job.url));
	const gridUrl = `/api/projects/${input.project_id}/files/grids/${gridName}`;
	let project = await deps.store.readProject(input.project_id);
	if (!project) return fail(404, 'Project not found');
	// Keyframes (V1S-376) are 2×2, or 1×1 for a shot that renders alone (kept whole, no split).
	const keyframe = input.card_ids.every((id) => project!.production.cards.find((card) => card.card_id === id)?.fit?.spec);
	const shape = keyframe ? keyframeShape(input.card_ids.length) : gridShape(input.card_ids.length);
	const whole = shape.rows * shape.cols === 1;
	const split = whole ? null : await deps.splitter.splitGrid(gridFile, shape.rows, shape.cols);
	let added = 0;
	for (const [i, cardId] of input.card_ids.entries()) {
		const panel = split?.panels[i];
		if ((!whole && !panel) || !project.production.cards.some((card) => card.card_id === cardId)) continue;
		const name = whole ? gridName : `grid-${input.job_id.slice(0, 12)}-${String(i + 1).padStart(2, '0')}.jpg`;
		const file = join(folder, name);
		if (split && panel) await writeFile(file, await split.download(panel.index));
		const probed = await deps.probe(file);
		const outcome = await deps.gateway.addTake({
			command: 'add_take', project_id: input.project_id, expected_version: project.version, card_id: cardId,
			take: { asset_id: uuid7ish(), kind: 'image', name, mime_type: whole ? 'image/png' : 'image/jpeg', url: `/api/projects/${input.project_id}/files/grids/${name}`, ...(probed.width ? { width: probed.width, height: probed.height } : {}), created_at: new Date().toISOString(), grid: { url: gridUrl, panel: i } }
		});
		if (!outcome.ok) return fail(409, outcome.error.message);
		project = outcome.data; added += 1;
	}
	return { ok: true, pending: false, project, added };
}
