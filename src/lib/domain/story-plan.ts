import { z } from 'zod';
import type { ProductionState } from './schemas';

const planId = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
export const planShotSchema = z.object({ id: planId, title: z.string().trim().min(1).max(180), beat: z.string().trim().min(1).max(4000), duration_s: z.number().positive().max(120).multipleOf(0.001) });
export const storyPlanSchema = z.object({
	title: z.string().trim().min(1).max(200),
	source: z.object({ series_id: planId.optional(), title: z.string().max(300), text: z.string().max(100_000), url: z.string().url().optional(), imported_at: z.string(), references: z.array(z.object({ key: z.string().min(1).max(300), name: z.string().min(1).max(200), kind: z.string().max(40) })).max(300).default([]) }).optional(),
	footage_source_project_id: planId.optional(),
	/** Existing project whose references may be used as sources; never write its Prep through this plan. */
	prep_source_project_id: planId.optional(),
	sections: z.array(z.object({
		id: planId, title: z.string().trim().min(1).max(200), summary: z.string().max(2000),
		moments: z.array(z.object({
			id: planId, title: z.string().trim().min(1).max(180), beat: z.string().trim().min(1).max(4000),
			duration_s: z.number().positive().max(120).multipleOf(0.001),
			characters: z.array(z.string().trim().min(1).max(100)).max(40).default([]),
			location: z.string().max(200).default(''),
			candidate_asset_id: planId.optional(),
			approved: z.boolean().default(false),
			shots: z.array(planShotSchema).max(30).default([])
		})).max(100)
	})).min(1).max(30)
}).superRefine((plan, ctx) => {
	const ids = plan.sections.flatMap(section => [section.id, ...section.moments.flatMap(moment => [moment.id, ...moment.shots.map(shot => shot.id)])]);
	if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Plan section and shot IDs must be unique' });
});
export type StoryPlan = z.infer<typeof storyPlanSchema>;
export const plannedCardId = (id: string) => `plan-shot-${id}`;
export const plannedGroupId = (id: string) => `plan-section-${id}`;

/** A changed event needs fresh approval and coverage; previously boarded cards remain intact. */
export function reconcileMomentEdits(previous: StoryPlan | undefined, next: StoryPlan): StoryPlan {
	const result = structuredClone(next);
	const existing = new Map(previous?.sections.flatMap(section => section.moments).map(moment => [moment.id, moment]));
	for (const moment of result.sections.flatMap(section => section.moments)) {
		const old = existing.get(moment.id);
		const content = (entry: typeof moment) => JSON.stringify([entry.title, entry.beat, entry.duration_s, entry.characters, entry.location]);
		if (!old || content(old) !== content(moment)) { moment.approved = false; moment.shots = []; }
	}
	return result;
}

/** Append only. Stable IDs make repeated clicks harmless; existing boards and picks remain untouched. */
export function appendPlannedShots(production: ProductionState, now: string): ProductionState {
	const plan = production.story_plan;
	if (!plan) return production;
	const groups = [...(production.groups ?? [])];
	const cards = [...production.cards];
	let order = cards.reduce((max, card) => Math.max(max, card.order), -1) + 1;
	for (const section of plan.sections) {
		if (!section.moments.some(moment => moment.approved && moment.shots.length)) continue;
		const group_id = plannedGroupId(section.id);
		if (!groups.some(group => group.group_id === group_id)) groups.push({ group_id, name: `${plan.title} · ${section.title}`.slice(0, 120), created_at: now });
		for (const moment of section.moments.filter(moment => moment.approved)) for (const shot of moment.shots) {
			const card_id = plannedCardId(shot.id);
			if (cards.some(card => card.card_id === card_id)) continue;
			cards.push({
				card_id, group_id, order: order++, title: shot.title, beat: shot.beat,
				identity_tags: {
					characters: moment.characters.map(name => ({ name, key: plan.source?.references.find(ref => ref.name === name && /^char/i.test(ref.kind))?.key ?? `character:${name}` })),
					...(moment.location ? { location: { name: moment.location, key: plan.source?.references.find(ref => ref.name === moment.location && /^loc/i.test(ref.kind))?.key ?? `location:${moment.location}` } } : {})
				},
				purpose: 'Proposed trailer moment. Review references and coverage before writing generation prompts.',
				duration_ms: Math.round(shot.duration_s * 1000), status: 'draft', benched: true,
				image_prompt: 'Pending reference review.', video_prompt: 'Pending reference review.'
			});
		}
	}
	return cards.length === production.cards.length && groups.length === (production.groups?.length ?? 0) ? production : { ...production, cards, groups };
}
