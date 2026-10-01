import type { ProductionAsset, ProductionState } from './schemas';
import type { SeedanceRequest } from './animate';
import type { TakeResult } from './takes';

/**
 * Finalize (CONTEXT.md: Draft, Finalize). A Seedance draft can be finalized
 * to 1080p from the same render — same motion and timing, so trims and ramps
 * carry over — until seven days after the draft was made. Nothing is deleted
 * or blocked when the window closes; it just stops being offered.
 */

export const FINALIZE_WINDOW_MS = 7 * 24 * 3600 * 1000;
/** The badge turns red for the last 48 hours. */
export const CLOSING_MS = 48 * 3600 * 1000;
/** The project banner lists drafts closing within three days. */
export const BANNER_MS = 3 * 24 * 3600 * 1000;

export type DraftWindow =
	| { state: 'none' }
	| { state: 'open' | 'closing'; closes_at: string; ms_left: number }
	| { state: 'closed'; closes_at: string };

/** A take's finalize window at `now`. Only unfinalized drafts with a job id and creation time have one. */
export function draftWindow(take: Pick<ProductionAsset, 'job_id' | 'generation'>, now: number): DraftWindow {
	const g = take.generation;
	if (!take.job_id || !g?.draft || g.finalized_at || !g.draft_created_at) return { state: 'none' };
	const closes = Date.parse(g.draft_created_at) + FINALIZE_WINDOW_MS;
	const closes_at = new Date(closes).toISOString();
	const ms_left = closes - now;
	if (ms_left <= 0) return { state: 'closed', closes_at };
	return { state: ms_left <= CLOSING_MS ? 'closing' : 'open', closes_at, ms_left };
}

/** "5d left", "30h left", "40m left". */
export function timeLeft(msLeft: number): string {
	const hours = msLeft / 3600_000;
	if (hours >= 48) return `${Math.floor(hours / 24)}d left`;
	if (hours >= 1) return `${Math.floor(hours)}h left`;
	return `${Math.max(1, Math.floor(msLeft / 60_000))}m left`;
}

/**
 * Takes whose draft is already being finalized (sent, not yet settled). Two
 * takes can share one draft job (the same file on two beats), so a pending
 * finalize covers every take of that job.
 */
export function finalizingIds(production: Pick<ProductionState, 'generations' | 'assets'>): Set<string> {
	const pending = new Set((production.generations ?? []).flatMap((g) => g.finalizes && (g.status === 'queued' || g.status === 'in_progress') ? [g.finalizes] : []));
	const jobs = new Set(production.assets.flatMap((take) => pending.has(take.asset_id) && take.job_id ? [take.job_id] : []));
	return new Set(production.assets.flatMap((take) => pending.has(take.asset_id) || (take.job_id && jobs.has(take.job_id)) ? [take.asset_id] : []));
}

/** One take per draft job, first wins: finalizing the same draft twice would pay for the same render twice. */
export function oneTakePerDraft<T extends Pick<ProductionAsset, 'job_id'>>(takes: T[]): T[] {
	const seen = new Set<string>();
	return takes.filter((take) => !take.job_id || (!seen.has(take.job_id) && seen.add(take.job_id)));
}

export interface ClosingDraft { take: ProductionAsset; closes_at: string; ms_left: number }

/** Drafts whose window closes within three days, soonest first (for the project banner); ones already finalizing are left out. */
export function draftsClosingSoon(production: ProductionState, now: number, withinMs = BANNER_MS): ClosingDraft[] {
	const sent = finalizingIds(production);
	return production.assets
		.filter((take) => !sent.has(take.asset_id) && !take.rejected)
		.flatMap((take) => {
			const window = draftWindow(take, now);
			return (window.state === 'open' || window.state === 'closing') && window.ms_left <= withinMs
				? [{ take, closes_at: window.closes_at, ms_left: window.ms_left }]
				: [];
		})
		.sort((a, b) => a.ms_left - b.ms_left)
		.filter((entry, index, all) => !entry.take.job_id || all.findIndex((other) => other.take.job_id === entry.take.job_id) === index);
}

/** Every take that can still be finalized (open window), e.g. the picks in a cut. */
export function finalizable(takes: ProductionAsset[], now: number): ProductionAsset[] {
	return takes.filter((take) => {
		const window = draftWindow(take, now);
		return window.state === 'open' || window.state === 'closing';
	});
}

/** The finalize request for a draft take: the same prompt, length and audio, at 1080p, by draft job id. */
export function finalizeRequest(take: ProductionAsset): SeedanceRequest | null {
	const g = take.generation;
	if (!take.job_id || !g?.draft || !g.duration_s) return null;
	return { prompt: g.prompt, duration: g.duration_s, resolution: '1080p', generate_audio: g.generate_audio ?? true, draft_job_id: take.job_id };
}

export interface DraftLink {
	take_id: string;
	job_id: string;
	draft_created_at: string;
	prompt: string;
	duration_s: number;
	generate_audio: boolean;
}

/** Record which Seedance draft each existing take came from. */
export function applyLinkDraftJobs(production: ProductionState, links: DraftLink[]): TakeResult {
	const byTake = new Map(links.map((link) => [link.take_id, link]));
	for (const link of links) {
		const take = production.assets.find((asset) => asset.asset_id === link.take_id);
		if (!take) return { ok: false, message: `Take ${link.take_id} not found` };
		if (take.kind !== 'video') return { ok: false, message: `Take ${link.take_id} is not a video` };
		if (take.generation?.finalized_at) return { ok: false, message: `Take ${link.take_id} is already finalized` };
	}
	return {
		ok: true,
		production: {
			...production,
			assets: production.assets.map((asset) => {
				const link = byTake.get(asset.asset_id);
				if (!link) return asset;
				return {
					...asset,
					job_id: link.job_id,
					generation: {
						provider: 'higgsfield', model: 'seedance_2_5', resolution: '480p', prompt: link.prompt,
						duration_s: link.duration_s, generate_audio: link.generate_audio, draft: true, draft_created_at: link.draft_created_at
					}
				};
			})
		}
	};
}

/**
 * A finalize finished: the take's media becomes the 1080p render (the draft
 * file stays on disk, noted on the take). In/out and speed are untouched.
 */
export function finalizedTake(take: ProductionAsset, media: Pick<ProductionAsset, 'url' | 'width' | 'height' | 'duration_s'>, finalizeJobId: string, now: string): ProductionAsset {
	return {
		...take,
		url: media.url,
		...(media.width ? { width: media.width } : {}),
		...(media.height ? { height: media.height } : {}),
		...(media.duration_s ? { duration_s: media.duration_s } : {}),
		mime_type: 'video/mp4',
		generation: { ...take.generation!, resolution: '1080p', finalized_at: now, finalize_job_id: finalizeJobId, draft_url: take.url }
	};
}
