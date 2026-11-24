import type { ProductionState } from './schemas';
import type { TakeResult } from './takes';

/**
 * Which Higgsfield job an existing take came from, found by matching files. The job id is what a re-render reads
 * the take's request back by (CONTEXT.md: Re-render), so a take brought in from the operator's history can be
 * rendered again with the same still and references.
 */
export interface JobLink {
	take_id: string;
	job_id: string;
	/** When the job was made. */
	draft_created_at: string;
	prompt: string;
	duration_s: number;
	generate_audio: boolean;
}

export function applyLinkJobs(production: ProductionState, links: JobLink[]): TakeResult {
	const byTake = new Map(links.map((link) => [link.take_id, link]));
	for (const link of links) {
		const take = production.assets.find((asset) => asset.asset_id === link.take_id);
		if (!take) return { ok: false, message: `Take ${link.take_id} not found` };
		if (take.kind !== 'video') return { ok: false, message: `Take ${link.take_id} is not a video` };
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
						provider: 'higgsfield', model: 'seedance_2_5', resolution: asset.generation?.resolution ?? '480p', prompt: link.prompt,
						duration_s: link.duration_s, generate_audio: link.generate_audio, draft_created_at: link.draft_created_at
					}
				};
			})
		}
	};
}
