import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { Project } from '$lib/domain/schemas';
import { MIN_LONG_EDGE } from '$lib/domain/media';
import { sheetFileName, type PrepFile } from '$lib/domain/prep';
import { UPSCALE_MODEL, type Upscaler } from './higgsfield';
import { findEntry, readPrep, update, type PrepDeps, type PrepView } from './prep';
import type { MediaProbe } from './media-probe';
import { uploadReference } from './reference-files';
import { NO_CLI } from './stills';

/**
 * Drift 08 (GitHub #36 / V1S-512, ADR 0012): a Prep sheet under 2048 px on its long edge, upscaled with its price
 * shown first. Four steps, each its own press: the price (spends nothing), the upscale on a yes to that price (spends
 * credits, logged on the project like any still), the upscaled sheet back beside the original (nothing sent), and the
 * send to Review Room on a second yes, through the reference upload. Remaking the sheet is Prep's own flow.
 */
export type PictureDeps = Pick<PrepDeps, 'store' | 'gateway' | 'projectRoot' | 'series' | 'download' | 'references'> & {
	upscaler: Upscaler | null;
	probe: (file: string) => Promise<MediaProbe>;
};

type Failure = { ok: false; status: number; message: string };
const fail = (status: number, message: string): Failure => ({ ok: false, status, message });
const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).replace(/\.$/, '');

export interface UpscaleQuote { credits: number; width: number; height: number; long_edge: number; original_url: string }

/** The entry's Prep sheet, not yet in Review Room and under 2048 px, with its size. */
async function smallSheet(deps: PictureDeps, project: Project, key: string): Promise<{ ok: true; view: PrepView; file: string; url: string; width: number; height: number } | Failure> {
	const found = await findEntry(deps, project, key);
	if (!found.ok) return found;
	const result = found.view.state.result;
	if (!result) return fail(409, `${found.view.entry.name} has no sheet in Prep yet; make one there`);
	if (result.uploaded) return fail(409, `${found.view.entry.name}'s sheet is already in Review Room`);
	const size = await deps.probe(result.file).catch(() => ({} as MediaProbe));
	if (!size.width || !size.height) return fail(400, `Could not read the size of ${found.view.entry.name}'s sheet`);
	if (Math.max(size.width, size.height) >= MIN_LONG_EDGE) return fail(400, `${found.view.entry.name}'s sheet is ${size.width}×${size.height}, already ${MIN_LONG_EDGE} px on its long edge: it needs no upscale`);
	return { ok: true, view: found.view, file: result.file, url: result.url, width: size.width, height: size.height };
}

/** The price of upscaling the sheet to 2K. It asks Higgsfield for a price only: nothing is uploaded or spent. */
export async function quoteUpscale(deps: PictureDeps, project: Project, key: string): Promise<{ ok: true; quote: UpscaleQuote } | Failure> {
	const sheet = await smallSheet(deps, project, key);
	if (!sheet.ok) return sheet;
	if (!deps.upscaler) return fail(503, NO_CLI);
	try {
		const { credits } = await deps.upscaler.estimate();
		return { ok: true, quote: { credits, width: sheet.width, height: sheet.height, long_edge: MIN_LONG_EDGE, original_url: sheet.url } };
	} catch (cause) { return fail(502, `Higgsfield gave no price for the upscale: ${reason(cause)}`); }
}

/**
 * The upscale, on the operator's yes to `confirmed_credits`. The price is asked again first and must still be the
 * one said yes to; a sheet already being upscaled is not sent twice. The credits are logged with the project's stills.
 */
export async function startUpscale(deps: PictureDeps, project: Project, key: string, approved: { confirmed_credits: number }): Promise<{ ok: true; job_id: string; credits: number; prep: PrepFile; note?: string } | Failure> {
	const sheet = await smallSheet(deps, project, key);
	if (!sheet.ok) return sheet;
	const name = sheet.view.entry.name;
	const pending = sheet.view.state.upscale;
	if (pending && !pending.file) return fail(409, `${name} is already being upscaled (Higgsfield job ${pending.job_id}); wait for it to come back`);
	if (pending && !pending.sent) return fail(409, `${name} was upscaled already; look at it beside the original, then send it or remake it`);
	if (!deps.upscaler) return fail(503, NO_CLI);
	let credits: number;
	try { ({ credits } = await deps.upscaler.estimate()); } catch (cause) { return fail(502, `Higgsfield gave no price for the upscale: ${reason(cause)}. Nothing was spent.`); }
	if (credits !== approved.confirmed_credits) return fail(422, `The upscale's price is ${credits} credits now, not the ${approved.confirmed_credits} you said yes to. Nothing was spent; look at the new price first.`);
	let jobId: string;
	try { ({ job_id: jobId } = await deps.upscaler.submit(sheet.file)); } catch (cause) { return fail(502, `The upscale was not sent: ${reason(cause)}`); }
	const sentAt = new Date().toISOString();
	// The job id is kept in Prep first, so whatever happens to the spend note the paid job is never asked for twice.
	const prep = await update(deps.projectRoot, project.project_id, key, (state) => ({ ...state, upscale: { job_id: jobId, sent_at: sentAt, credits, from: { width: sheet.width, height: sheet.height }, sent: false } }));
	const current = (await deps.store.readProject(project.project_id)) ?? project;
	const recorded = await deps.gateway.recordStillSend(current.project_id, current.version, {
		job_id: jobId, purpose: 'reference', model: UPSCALE_MODEL, resolution: '2k', credits, prompt: `Upscale ${name} to 2K`, references: [name.slice(0, 300)], sent_at: sentAt
	}).catch((cause: unknown) => ({ ok: false as const, error: { message: reason(cause) } }));
	// The job is running and paid for either way, so it is reported as started; a failed note of the spend is said.
	return { ok: true, job_id: jobId, credits, prep, ...(recorded.ok ? {} : { note: `Noting the ${credits} credits on the project failed: ${recorded.error.message}` }) };
}

export interface SheetSide { url: string; width: number; height: number }

/**
 * The upscale, if it is back: saved under `files/prep/upscaled/` with Higgsfield's own file name and returned beside
 * the original, so a changed face or place is caught. Nothing is sent. A failed upscale is cleared so it can be asked again.
 */
export async function settleUpscale(deps: PictureDeps, project: Project, key: string): Promise<{ ok: true; pending: true } | { ok: true; pending: false; original: SheetSide; upscaled: SheetSide; prep: PrepFile } | Failure> {
	const found = await findEntry(deps, project, key);
	if (!found.ok) return found;
	const { state, entry } = found.view;
	const upscale = state.upscale;
	if (!upscale || !state.result) return fail(409, `${entry.name} is not being upscaled`);
	const original: SheetSide = { url: state.result.url, width: upscale.from.width, height: upscale.from.height };
	if (upscale.file && upscale.url && upscale.width && upscale.height) {
		const prep = await readPrep(deps.projectRoot, project.project_id);
		return { ok: true, pending: false, original, upscaled: { url: upscale.url, width: upscale.width, height: upscale.height }, prep };
	}
	if (!deps.upscaler) return fail(503, NO_CLI);
	// A CLI or network error is not a failed job: the paid job id is kept, so asking again picks it up.
	let job: Awaited<ReturnType<Upscaler['status']>>;
	try { job = await deps.upscaler.status(upscale.job_id); } catch (cause) { return fail(502, `Higgsfield could not be asked about ${entry.name}'s upscale: ${reason(cause)}. Ask again in a moment.`); }
	if (job.status === 'queued' || job.status === 'in_progress') return { ok: true, pending: true };
	if (job.status !== 'completed' || !job.url) {
		await update(deps.projectRoot, project.project_id, key, (now) => ({ ...now, upscale: undefined }));
		return fail(502, `The upscale of ${entry.name} failed: ${job.error ?? job.status}. Nothing was sent; you can ask for it again.`);
	}
	const fromUrl = basename(new URL(job.url).pathname).replace(/[^\w.-]+/g, '_');
	const name = /\.(png|jpe?g|webp)$/i.test(fromUrl) ? fromUrl : `${upscale.job_id.replace(/[^\w-]+/g, '_')}.png`;
	const relative = `files/prep/upscaled/${name}`;
	const file = join(deps.projectRoot, project.project_id, relative);
	try {
		await mkdir(join(deps.projectRoot, project.project_id, 'files', 'prep', 'upscaled'), { recursive: true });
		await writeFile(file, await deps.download(job.url));
	} catch (cause) { return fail(502, `The upscaled sheet could not be saved: ${reason(cause)}`); }
	const size = await deps.probe(file).catch(() => ({} as MediaProbe));
	if (!size.width || !size.height) return fail(502, 'Could not read the size of the upscaled sheet');
	const url = `/api/projects/${project.project_id}/${relative}`;
	const prep = await update(deps.projectRoot, project.project_id, key, (now) => ({ ...now, upscale: now.upscale && { ...now.upscale, file: relative, url, width: size.width, height: size.height } }));
	return { ok: true, pending: false, original, upscaled: { url, width: size.width!, height: size.height! }, prep };
}

/**
 * The upscaled sheet to Review Room, on the operator's yes after seeing it beside the original: the reference upload
 * under its Notion name (refused, as ever, under 2048 px). A reference not yet in Notion keeps its upscaled sheet here.
 */
export async function sendUpscaled(deps: PictureDeps, project: Project, key: string): Promise<{ ok: true; prep: PrepFile } | Failure> {
	const found = await findEntry(deps, project, key);
	if (!found.ok) return found;
	const { state, entry } = found.view;
	const upscale = state.upscale;
	if (!upscale?.file || !upscale.url || !state.result) return fail(409, `${entry.name} has no upscaled sheet to send yet`);
	if (upscale.sent) return fail(409, `${entry.name}'s upscaled sheet is already in Review Room`);
	if (!entry.reference_page_id || !project.series) return fail(409, `Add ${entry.name} to Notion first; its upscaled sheet waits here until then`);
	if (!deps.references) return fail(503, 'Review Room is not configured, so the sheet stays here');
	const file = join(deps.projectRoot, project.project_id, upscale.file);
	let bytes: Uint8Array;
	try { bytes = new Uint8Array(await readFile(file)); } catch (cause) { return fail(500, `The upscaled sheet could not be read: ${reason(cause)}`); }
	const sent = await uploadReference(deps.references, project.series.series_id, { page_id: entry.reference_page_id, file_name: `${sheetFileName(entry.name)}${extname(file).toLowerCase() || '.png'}`, bytes });
	if (!sent.ok) return sent;
	const note = `Upscaled from ${upscale.from.width}×${upscale.from.height}`;
	const prep = await update(deps.projectRoot, project.project_id, key, (now) => ({
		...now, upscale: now.upscale && { ...now.upscale, sent: true },
		result: now.result && { ...now.result, file, url: upscale.url!, uploaded: true, note }
	}));
	return { ok: true, prep };
}
