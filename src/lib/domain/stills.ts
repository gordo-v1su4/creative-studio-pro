import type { ProductionState } from './schemas';

/**
 * The approval step for every still (V1S-373): the operator sees the exact prompt, the references in the order
 * they attach (each with its exact name), the model and resolution, and the predicted credits with the episode's
 * running total, then presses Approve. One send at a time; no cap for now.
 */
export interface StillReference { order: number; name: string; file: string; url?: string }

export interface StillApproval {
	prompt: string;
	references: StillReference[];
	model: string;
	resolution: string;
	aspect_ratio: string;
	/** null when the price check failed (then it is also blocked). */
	credits: number | null;
	/** Credits already spent on this episode: renders plus stills. */
	episode_spent: number;
	/** What it reaches with this send. */
	episode_after: number;
	/** QC and gate findings; any entry blocks Approve. */
	blocked: string[];
	/** Fingerprint of what was shown, so the send is refused if anything changed since. */
	approval_key: string;
}

const round = (credits: number) => Math.round(credits * 100) / 100;

/** Everything this episode has spent: Seedance renders (estimates as sent) and approved stills. */
export function episodeSpend(production: Pick<ProductionState, 'generations' | 'still_sends'>): number {
	const renders = (production.generations ?? []).reduce((sum, generation) => sum + generation.estimate_credits, 0);
	const stills = (production.still_sends ?? []).reduce((sum, send) => sum + send.credits, 0);
	return round(renders + stills);
}

/** References in image order, numbered from 1, each with the exact name the prompt uses. */
export const orderedReferences = (attached: Array<{ name: string; file: string; url?: string }>): StillReference[] =>
	attached.map((entry, i) => ({ order: i + 1, name: entry.name, file: entry.file, ...(entry.url ? { url: entry.url } : {}) }));

/** A stable fingerprint of the prompt, the references in order, the model and the aspect (FNV-1a, hex). */
export function approvalKey(input: { prompt: string; references: Array<{ name: string; file: string }>; model: string; resolution: string; aspect_ratio: string }): string {
	const text = JSON.stringify([input.prompt, input.references.map((ref) => [ref.name, ref.file]), input.model, input.resolution, input.aspect_ratio]);
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
	return hash.toString(16).padStart(8, '0');
}

export function stillApproval(input: { prompt: string; attached: Array<{ name: string; file: string; url?: string }>; model: string; resolution: string; aspect_ratio: string; credits: number | null; spent: number; blocked: string[] }): StillApproval {
	const references = orderedReferences(input.attached);
	return {
		prompt: input.prompt, references, model: input.model, resolution: input.resolution, aspect_ratio: input.aspect_ratio,
		credits: input.credits, episode_spent: round(input.spent), episode_after: round(input.spent + (input.credits ?? 0)),
		blocked: input.credits === null && !input.blocked.length ? ['The price check failed'] : input.blocked,
		approval_key: approvalKey({ prompt: input.prompt, references, model: input.model, resolution: input.resolution, aspect_ratio: input.aspect_ratio })
	};
}

/** Why a send is refused against what the operator approved; empty = send. */
export function approvalProblems(now: StillApproval, approved: { approval_key: string; confirmed_credits: number }): string[] {
	const problems = [...now.blocked];
	if (now.approval_key !== approved.approval_key) problems.push('The prompt, references or model changed since you approved; look again and approve the new version');
	if (now.credits !== null && now.credits > approved.confirmed_credits + 1e-6) problems.push(`It now costs ${now.credits} credits, above the ${approved.confirmed_credits} you approved`);
	return problems;
}
