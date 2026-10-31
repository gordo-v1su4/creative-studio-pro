import { z } from 'zod';
import type { ProductionState } from './schemas';
import type { TakeResult } from './takes';

/**
 * Shot tags: what a take shows, in words a rule can read (place, who, what happens, how it is framed) and how
 * much it moves, measured from its frames. The words come from a caption of one frame (the caption gateway,
 * or the Agent's model when the gateway is down); motion and internal cuts are measured in code, so a cut
 * planned from tags comes out the same every time.
 */
export const shotTagsSchema = z.object({
	caption: z.string().max(600),
	place: z.string().max(200).default(''),
	time_of_day: z.string().max(60).default(''),
	subjects: z.array(z.string().max(120)).max(12).default([]),
	action: z.string().max(400).default(''),
	shot_size: z.string().max(60).default(''),
	lighting: z.string().max(200).default(''),
	/** A title card, logo or end card: the end tag's candidate. */
	title_card: z.boolean().default(false),
	/** Mean frame-to-frame change over the take's kept span, as a share of full scale (0..1); 0 for a still. */
	motion: z.number().min(0).max(1).default(0),
	/** Hard cuts inside the kept span: more than a few means the take is already an edit. */
	cuts: z.number().int().min(0).max(10_000).default(0),
	/** The video's length as decoded (frames ÷ fps), for takes whose length was never recorded. */
	duration_s: z.number().positive().optional(),
	source: z.enum(['caption-gateway', 'agent', 'operator']),
	model: z.string().max(200).optional(),
	at: z.string()
});
export type ShotTags = z.infer<typeof shotTagsSchema>;

/** A frame difference this big (share of full scale, like frameSignal's diffs) is a hard cut, not motion. */
export const HARD_CUT_DIFF = 0.12;
/** More hard cuts than this inside a take: it is a pre-cut sequence, not a shot. */
export const MAX_INNER_CUTS = 3;

/** Motion and hard cuts over a span of a take's frame differences (diffs[k] is frame k against frame k+1, 0..1). */
export function motionOf(signal: { fps: number; diffs: number[] }, in_s = 0, out_s = Infinity): { motion: number; cuts: number } {
	const from = Math.max(0, Math.floor(in_s * signal.fps)), to = Math.min(signal.diffs.length, Math.ceil(out_s * signal.fps));
	const span = signal.diffs.slice(from, to);
	if (span.length === 0) return { motion: 0, cuts: 0 };
	const cuts = span.filter((d) => d >= HARD_CUT_DIFF).length;
	const calm = span.filter((d) => d < HARD_CUT_DIFF);
	const motion = calm.length ? calm.reduce((sum, d) => sum + d, 0) / calm.length : 0;
	return { motion: Math.round(motion * 10000) / 10000, cuts };
}

const TITLE_WORDS = /\b(title card|end card|logo|the (word|words|title|text)\b|text reads|reads ['"“])/i;
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const list = (value: unknown) => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(/,|;| and /) : []).map((v) => text(v, 120)).filter(Boolean).slice(0, 12);

/** The caption model's JSON (gateway keys: caption, shotType, subjects, action, setting, lighting, timeOfDay; plus titleCard) as tag words. */
export function wordsFromCaption(meta: Record<string, unknown>): Pick<ShotTags, 'caption' | 'place' | 'time_of_day' | 'subjects' | 'action' | 'shot_size' | 'lighting' | 'title_card'> {
	const yes = (v: unknown) => v === true || (typeof v === 'string' && /^(true|yes)$/i.test(v.trim()));
	const caption = text(meta.caption ?? meta.text, 600);
	const said = meta.titleCard ?? meta.title_card;
	return {
		caption,
		place: text(meta.setting ?? meta.place ?? meta.location, 200),
		time_of_day: text(meta.timeOfDay ?? meta.time_of_day, 60).toLowerCase(),
		subjects: list(meta.subjects),
		action: text(meta.action, 400),
		shot_size: text(meta.shotType ?? meta.shot_size, 60).toLowerCase(),
		lighting: text(meta.lighting, 200),
		// When the model doesn't say, a caption about on-screen words or a logo means a title card.
		title_card: said === undefined ? TITLE_WORDS.test(caption) : yes(said)
	};
}

/** Put tags on a take (or clear them with null). */
export function applySetTakeTags(production: ProductionState, takeId: string, tags: ShotTags | null): TakeResult {
	if (!production.assets.some((asset) => asset.asset_id === takeId)) return { ok: false, message: `Take ${takeId} not on this project` };
	return {
		ok: true,
		production: {
			...production,
			assets: production.assets.map((asset) => {
				if (asset.asset_id !== takeId) return asset;
				const { tags: _old, ...rest } = asset;
				return tags ? { ...rest, tags } : rest;
			})
		}
	};
}
