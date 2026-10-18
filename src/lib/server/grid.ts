import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectCommandGateway } from '$lib/application/gateway';
import type { ProjectStore } from '$lib/adapters/project-store';
import type { Project } from '$lib/domain/schemas';
import { GRID_COLS, GRID_ROWS, gridChunks, gridPrompt } from '$lib/domain/grid';
import { uuid7ish } from '$lib/domain/ids';
import { lintPrompt } from '$lib/domain/prompt-lint';
import { bannedTerms } from '$lib/domain/brief-rules';
import { projectRules } from './animate';
import type { ImageGenerator } from './higgsfield';
import type { Splitter } from './splitter';
import type { MediaProbe } from './media-probe';
import { compileForSend, seriesReferences, type ReferenceFiles } from './references';

/**
 * Grid stills (V1S-278): a scene's shots without a still, nine per grid, each grid one Nano Banana Pro 4K
 * image. Quote prices and lints every grid; send goes through the same gate (nothing is spent while a prompt
 * is blocked or the price rose); settle downloads the grid, splits it with the splitter service and adds one
 * still take per shot, each remembering its grid and panel.
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

export interface GridQuote { chunk: number; card_ids: string[]; titles: string[]; prompt: string; credits: number | null; blocked: string[]; /** Reference files attached, in image order (V1S-327). */ references: string[] }

export async function quoteGrids(deps: GridDeps, project: Project, groupId: string): Promise<{ ok: true; grids: GridQuote[] } | Failure> {
	if (!deps.images) return fail(503, 'The Higgsfield CLI was not found; install it and run "higgsfield auth login" (see Settings)');
	const scene = project.series?.scenes.find((entry) => entry.group_id === groupId);
	const group = project.production.groups?.find((entry) => entry.group_id === groupId);
	if (!group) return fail(404, 'That scene is not on the board');
	const hasStill = (cardId: string) => project.production.assets.some((asset) => asset.card_id === cardId && asset.kind === 'image' && !asset.rejected);
	const shots = project.production.cards.filter((card) => card.group_id === groupId && !card.benched && !hasStill(card.card_id)).toSorted((a, b) => a.order - b.order);
	const banned = bannedTerms(await projectRules(deps.projectRoot, project.project_id));
	const references = await seriesReferences(deps.projectRoot, project);
	const grids: GridQuote[] = [];
	for (const [chunk, cards] of gridChunks(shots).entries()) {
		const written = gridPrompt({ scene: scene?.title ?? group.name, location: scene?.location ?? '', summary: scene?.summary ?? '', characters: scene?.characters ?? [], shots: cards.map((card) => ({ card_id: card.card_id, title: card.title, image_prompt: card.image_prompt, description: card.beat })) });
		// Handles (@Kai) become image labels and exact names before lint, and their sheets are attached.
		const compiled = await compileForSend(written, references, 'nano_banana', deps.referenceFiles);
		const prompt = compiled.prompt;
		const counts = new Map<string, number>();
		for (const issue of lintPrompt(prompt, 'nano_banana', banned, { references }).issues) if (issue.severity === 'error') { const key = `Prompt rule ${issue.rule}: ${issue.message}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
		const blocked = [...[...counts].map(([reason, n]) => (n > 1 ? `${reason} (×${n})` : reason)), ...compiled.blocked];
		let credits: number | null = null;
		try { credits = (await deps.images.estimate({ prompt, references: compiled.files })).credits; } catch (cause) { blocked.push(cause instanceof Error ? cause.message : 'Price check failed'); }
		grids.push({ chunk, card_ids: cards.map((card) => card.card_id), titles: cards.map((card) => card.title), prompt, credits, blocked, references: compiled.files });
	}
	return { ok: true, grids };
}

/** Send one grid after its approval; refused before any spend when blocked or pricier than confirmed. */
export async function sendGrid(deps: GridDeps, input: { project_id: string; group_id: string; chunk: number; confirmed_credits: number }): Promise<{ ok: true; job_id: string; card_ids: string[]; credits: number } | Failure> {
	const project = await deps.store.readProject(input.project_id);
	if (!project) return fail(404, 'Project not found');
	const quoted = await quoteGrids(deps, project, input.group_id);
	if (!quoted.ok) return quoted;
	const grid = quoted.grids.find((entry) => entry.chunk === input.chunk);
	if (!grid) return fail(400, 'That grid has nothing left to draw');
	const reasons = [...grid.blocked];
	if (grid.credits !== null && grid.credits > input.confirmed_credits + 1e-6) reasons.push(`The grid now costs ${grid.credits} credits, above the ${input.confirmed_credits} you confirmed`);
	if (reasons.length) return fail(422, 'Blocked before any spend', reasons);
	try {
		const { job_id } = await deps.images!.submit({ prompt: grid.prompt, references: grid.references });
		return { ok: true, job_id, card_ids: grid.card_ids, credits: grid.credits ?? 0 };
	} catch (cause) {
		return fail(502, cause instanceof Error ? cause.message : 'Send failed');
	}
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
	const split = await deps.splitter.splitGrid(gridFile, GRID_ROWS, GRID_COLS);
	let project = await deps.store.readProject(input.project_id);
	if (!project) return fail(404, 'Project not found');
	let added = 0;
	for (const [i, cardId] of input.card_ids.entries()) {
		const panel = split.panels[i];
		if (!panel || !project.production.cards.some((card) => card.card_id === cardId)) continue;
		const name = `grid-${input.job_id.slice(0, 12)}-${String(i + 1).padStart(2, '0')}.jpg`;
		const file = join(folder, name);
		await writeFile(file, await split.download(panel.index));
		const probed = await deps.probe(file);
		const outcome = await deps.gateway.addTake({
			command: 'add_take', project_id: input.project_id, expected_version: project.version, card_id: cardId,
			take: { asset_id: uuid7ish(), kind: 'image', name, mime_type: 'image/jpeg', url: `/api/projects/${input.project_id}/files/grids/${name}`, ...(probed.width ? { width: probed.width, height: probed.height } : {}), created_at: new Date().toISOString(), grid: { url: gridUrl, panel: i } }
		});
		if (!outcome.ok) return fail(409, outcome.error.message);
		project = outcome.data; added += 1;
	}
	return { ok: true, pending: false, project, added };
}
