import { z } from 'zod';
import type { ProductionState } from './schemas';

// A trailer's story plan: sections (acts) hold scenes; scenes hold story beats; story beats hold planned shots.
// The schema keeps the stored field name `moments` for story beats so existing plans stay readable.

const planId = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
export const planShotSchema = z.object({ id: planId, title: z.string().trim().min(1).max(180), beat: z.string().trim().min(1).max(4000), duration_s: z.number().positive().max(120).multipleOf(0.001),
	/** An existing board shot that already covers this planned shot: Add to Board then creates no new card for it. */
	card_id: planId.optional() });
/** Review Room scene code (three capital letters, e.g. PCK). */
export const sceneCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'A scene code is three capital letters');
/** A trailer scene: one story chunk inside a section, with its own board group and, once coded, its own Review Room folder. */
export const planSceneSchema = z.object({
	id: planId, title: z.string().trim().min(1).max(200),
	scene_code: sceneCodeSchema.optional(),
	/** An existing board group this scene is (TR110's sequences); otherwise Add to Board makes the scene's group. */
	group_id: planId.optional()
});
export const storyPlanSchema = z.object({
	title: z.string().trim().min(1).max(200),
	source: z.object({ series_id: planId.optional(), title: z.string().max(300), text: z.string().max(100_000), url: z.string().url().optional(), imported_at: z.string(), references: z.array(z.object({ key: z.string().min(1).max(300), name: z.string().min(1).max(200), kind: z.string().max(40) })).max(300).default([]) }).optional(),
	footage_source_project_id: planId.optional(),
	/** Existing project whose references may be used as sources; never write its Prep through this plan. */
	prep_source_project_id: planId.optional(),
	sections: z.array(z.object({
		id: planId, title: z.string().trim().min(1).max(200), summary: z.string().max(2000),
		scenes: z.array(planSceneSchema).max(30).default([]),
		/** Story beats. */
		moments: z.array(z.object({
			id: planId, title: z.string().trim().min(1).max(180), beat: z.string().trim().min(1).max(4000),
			duration_s: z.number().positive().max(120).multipleOf(0.001),
			characters: z.array(z.string().trim().min(1).max(100)).max(40).default([]),
			location: z.string().max(200).default(''),
			candidate_asset_id: planId.optional(),
			/** The scene this story beat plays in; without one its shots go to the section's own group. */
			scene_id: planId.optional(),
			approved: z.boolean().default(false),
			shots: z.array(planShotSchema).max(30).default([])
		})).max(100)
	})).min(1).max(30)
}).superRefine((plan, ctx) => {
	const ids = plan.sections.flatMap(section => [section.id, ...section.scenes.map(scene => scene.id), ...section.moments.flatMap(moment => [moment.id, ...moment.shots.map(shot => shot.id)])]);
	if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Plan section, scene, story beat and shot IDs must be unique' });
	const scenes = plan.sections.flatMap(section => section.scenes);
	const codes = scenes.flatMap(scene => scene.scene_code ? [scene.scene_code] : []);
	if (new Set(codes).size !== codes.length) ctx.addIssue({ code: 'custom', message: 'Each scene needs its own scene code' });
	const groups = scenes.flatMap(scene => scene.group_id ? [scene.group_id] : []);
	if (new Set(groups).size !== groups.length) ctx.addIssue({ code: 'custom', message: 'Two scenes cannot share one board group' });
	for (const section of plan.sections) for (const moment of section.moments)
		if (moment.scene_id && !section.scenes.some(scene => scene.id === moment.scene_id)) ctx.addIssue({ code: 'custom', message: `${moment.title} points at a scene outside ${section.title}` });
});
export type StoryPlan = z.infer<typeof storyPlanSchema>;
export type PlanScene = StoryPlan['sections'][number]['scenes'][number];
export const plannedCardId = (id: string) => `plan-shot-${id}`;
export const plannedGroupId = (id: string) => `plan-section-${id}`;
export const plannedSceneGroupId = (id: string) => `plan-scene-${id}`;
/** The board group a scene's shots live in: the existing group it was mapped to, else the one Add to Board makes. */
export const sceneGroupId = (scene: PlanScene) => scene.group_id ?? plannedSceneGroupId(scene.id);

/** A changed story beat needs fresh approval and coverage; previously boarded cards remain intact. */
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

/** The board card that covers a planned shot: the existing shot it is linked to, else the card Add to Board made for it. */
export function boardCardFor(production: ProductionState, shot: { id: string; card_id?: string }) {
	return production.cards.find(card => card.card_id === (shot.card_id ?? plannedCardId(shot.id)))
		?? (shot.card_id ? production.cards.find(card => card.card_id === plannedCardId(shot.id)) : undefined);
}

/** Append only. Stable IDs make repeated clicks harmless; existing boards and picks remain untouched.
 * A planned shot linked to an existing board shot (card_id) is already covered and adds nothing.
 * New shots go to their story beat's scene group (made here unless the scene maps onto an existing group),
 * or to the section's own group when the story beat has no scene. */
export function appendPlannedShots(production: ProductionState, now: string): ProductionState {
	const plan = production.story_plan;
	if (!plan) return production;
	const groups = [...(production.groups ?? [])];
	const cards = [...production.cards];
	let order = cards.reduce((max, card) => Math.max(max, card.order), -1) + 1;
	const ensureGroup = (group_id: string, title: string) => {
		if (!groups.some(group => group.group_id === group_id)) groups.push({ group_id, name: `${plan.title} · ${title}`.slice(0, 120), created_at: now });
	};
	for (const section of plan.sections) {
		const missing = section.moments.filter(moment => moment.approved).flatMap(moment => moment.shots.map(shot => ({ moment, shot })))
			.filter(({ shot }) => !boardCardFor({ ...production, cards }, shot));
		for (const { moment, shot } of missing) {
			const scene = moment.scene_id ? section.scenes.find(entry => entry.id === moment.scene_id) : undefined;
			const group_id = scene ? sceneGroupId(scene) : plannedGroupId(section.id);
			ensureGroup(group_id, scene ? scene.title : section.title);
			cards.push({
				card_id: plannedCardId(shot.id), group_id, order: order++, title: shot.title, beat: shot.beat,
				identity_tags: {
					characters: moment.characters.map(name => ({ name, key: plan.source?.references.find(ref => ref.name === name && /^char/i.test(ref.kind))?.key ?? `character:${name}` })),
					...(moment.location ? { location: { name: moment.location, key: plan.source?.references.find(ref => ref.name === moment.location && /^loc/i.test(ref.kind))?.key ?? `location:${moment.location}` } } : {})
				},
				purpose: `Planned shot for the story beat "${moment.title}". Review references and coverage before writing generation prompts.`.slice(0, 1000),
				duration_ms: Math.round(shot.duration_s * 1000), status: 'draft', benched: true,
				image_prompt: 'Pending reference review.', video_prompt: 'Pending reference review.'
			});
		}
	}
	return cards.length === production.cards.length && groups.length === (production.groups?.length ?? 0) ? production : { ...production, cards, groups };
}
