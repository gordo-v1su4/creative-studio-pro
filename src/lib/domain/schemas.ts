import { z } from 'zod';
import { modelChoiceSchema, projectAgentModelSchema } from '$lib/domain/model-provider';

/**
 * Domain boundary schemas. Every persisted record and API payload carries an
 * explicit schema_version; unknown versions fail closed (AD-4).
 *
 * Conventions (ARCHITECTURE-SPINE):
 * - IDs are UUIDv7 strings; never array position or display label.
 * - Time is UTC RFC3339; durations in integer milliseconds.
 */

export const idSchema = z.string().regex(/^[A-Za-z0-9_-]+$/, 'ID must contain only letters, numbers, underscore, or hyphen');
const nonBlank = (max: number) => z.string().min(1).max(max).refine((value) => value.trim().length > 0, 'Must not be blank');
export const rfc3339Schema = z.string();
export const sha256Schema = z.string().length(64);

export type EntityId = z.infer<typeof idSchema>;

export const errorSchema = z.object({
	code: z.string(),
	message: z.string(),
	retryable: z.boolean(),
	source: z.string(),
	details: z.string().optional()
});

export type DomainError = z.infer<typeof errorSchema>;

// ---------------------------------------------------------------------------
// Project (aggregate root, FR-001 / FR-003)
// ---------------------------------------------------------------------------

export const stageStateSchema = z.enum([
	'BLOCKED',
	'READY FOR REVIEW',
	'PASSED',
	'FORCED'
]);

export const stageIdSchema = z.string().regex(/^S([0-9]|10)$/);

export type StageId = z.infer<typeof stageIdSchema>;

export const stageSchema = z.object({
	/** super-seed2 stage id, S0..S10 */
	id: stageIdSchema,
	state: stageStateSchema,
	confidence: z.number().min(0).max(100).nullable()
});

/**
 * Gate audit entry (FR-004 / NFR-001): every force-advance records stage,
 * reason, prior confidence, operator, and timestamp. Append-only.
 */
export const gateHistoryEntrySchema = z.object({
	event: z.literal('force_advance'),
	from_stage: stageIdSchema,
	to_stage: stageIdSchema,
	reason: z.string().min(1).max(1000),
	prior_confidence: z.number().min(0).max(100).nullable(),
	operator: z.string().min(1),
	timestamp: rfc3339Schema
});

export type GateHistoryEntry = z.infer<typeof gateHistoryEntrySchema>;

export const confidenceDimensionSchema = z.enum([
	'goal_clarity', 'format_runtime', 'story_beats', 'visual_intent',
	'asset_coverage', 'continuity_plan', 'constraints', 'executable_next_step'
]);
export type ConfidenceDimension = z.infer<typeof confidenceDimensionSchema>;
export const CONFIDENCE_DIMENSIONS = confidenceDimensionSchema.options;

export const interviewQuestionSchema = z.object({
	question_id: idSchema,
	prompt: nonBlank(1000)
});
export const interviewAnswerSchema = z.object({
	question_id: idSchema,
	raw_text: nonBlank(10_000)
});
export const confidenceScoreSchema = z.object({
	dimension: confidenceDimensionSchema,
	score: z.number().int().min(0).max(100),
	notes: z.string().max(2000)
});
export const confidenceRoundSchema = z.object({
	round_id: idSchema,
	round_number: z.number().int().positive(),
	questions: z.array(interviewQuestionSchema).min(1).max(5),
	answers: z.array(interviewAnswerSchema).min(1).max(5),
	scores: z.array(confidenceScoreSchema).length(8),
	overall: z.number().int().min(0).max(100),
	lowest_dimension: confidenceDimensionSchema,
	lowest_score: z.number().int().min(0).max(100),
	resolutions: z.array(z.string().min(1).max(2000)),
	status: z.enum(['BLOCKED', 'PASSED', 'STALLED']),
	created_at: rfc3339Schema
}).superRefine((round, context) => {
	const dimensions = new Set(round.scores.map((score) => score.dimension));
	if (dimensions.size !== CONFIDENCE_DIMENSIONS.length) {
		context.addIssue({ code: 'custom', message: 'All eight confidence dimensions must be scored exactly once' });
	}
	const questionIds = new Set(round.questions.map((question) => question.question_id));
	if (round.answers.some((answer) => !questionIds.has(answer.question_id)) || new Set(round.answers.map((answer) => answer.question_id)).size !== round.questions.length) {
		context.addIssue({ code: 'custom', message: 'Every question must have exactly one answer' });
	}
	const actualLowest = Math.min(...round.scores.map((score) => score.score));
	const reported = round.scores.find((score) => score.dimension === round.lowest_dimension);
	if (!reported || reported.score !== actualLowest || round.lowest_score !== actualLowest) {
		context.addIssue({ code: 'custom', message: 'Lowest confidence dimension must match the scored minimum' });
	}
	if (round.status === 'STALLED' && round.scores.some((score) => score.score < 70 && score.notes.trim().length === 0)) {
		context.addIssue({ code: 'custom', message: 'STALLED rounds require blocker notes for every below-floor dimension' });
	}
});
export type ConfidenceRound = z.infer<typeof confidenceRoundSchema>;

export const interviewStateSchema = z.object({
	status: z.enum(['BLOCKED', 'PASSED', 'STALLED']),
	rounds: z.array(confidenceRoundSchema)
});
export const briefFormatSchema = z.object({
	type: nonBlank(200), runtime: nonBlank(200),
	aspect: nonBlank(100), platform: nonBlank(200)
});
export const briefVersionSchema = z.object({
	brief_id: idSchema,
	version: z.number().int().positive(),
	title: nonBlank(200),
	slug: nonBlank(200),
	logline: nonBlank(2000),
	format: briefFormatSchema,
	tone_visual_rules: nonBlank(5000),
	must_haves: z.array(nonBlank(1000)).min(1),
	must_nots: z.array(nonBlank(1000)).min(1),
	continuity_model: nonBlank(2000),
	audio_approach: nonBlank(2000),
	success_criteria: z.array(nonBlank(1000)).min(1),
	content_hash: sha256Schema,
	created_at: rfc3339Schema
});
export type BriefVersion = z.infer<typeof briefVersionSchema>;
export const briefStateSchema = z.object({
	versions: z.array(briefVersionSchema),
	current_version: z.number().int().positive().nullable()
});
export const briefApprovalSchema = z.object({
	event: z.literal('brief_locked'),
	brief_id: idSchema,
	brief_version: z.number().int().positive(),
	brief_hash: sha256Schema,
	operator: z.string().min(1),
	timestamp: rfc3339Schema
});
export type BriefApproval = z.infer<typeof briefApprovalSchema>;

export const seedSchema = z.object({
	seed_id: idSchema,
	title: z.string().min(1).max(200),
	brief: z.string().max(5000),
	creative_focus: z.enum(['full room', 'image-grid', 'teaser', 'logline-summary']),
	created_by: z.string().min(1)
});

export type Seed = z.infer<typeof seedSchema>;

// ---------------------------------------------------------------------------
// Live Creative Room provider catalog (FR-005..012)
// ---------------------------------------------------------------------------

export const catalogModelSchema = z.object({
	label: z.string().min(1).max(100),
	/** Exact external model/agent identifier; legacy field name retained in v1 records. */
	raycast_agent: z.string().min(1).max(200),
	model_class: z.enum(['raycast_ai', 'kimi_api']),
	provider: z.enum(['raycast', 'kimi']).default('raycast')
});

export type CatalogModel = z.infer<typeof catalogModelSchema>;

export const rosterSlotSchema = catalogModelSchema.extend({
	pinned: z.boolean()
});

export type RosterSlot = z.infer<typeof rosterSlotSchema>;

export const catalogSnapshotSchema = z.object({
	bridge_version: z.string().min(1),
	harvested_at: rfc3339Schema,
	catalog_hash: sha256Schema,
	source: z.enum(['agents_file', 'built_in_defaults', 'kimi_config']),
	models: z.array(catalogModelSchema),
	requested_count: z.number().int().positive().max(20),
	selection_seed: z.string().min(1),
	selected: z.array(rosterSlotSchema),
	shortfall: z.number().int().nonnegative()
});

export type CatalogSnapshot = z.infer<typeof catalogSnapshotSchema>;

export const jobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const voiceParseStatusSchema = z.enum(['pending', 'valid', 'invalid', 'unknown']);

export const voiceSchema = z.object({
	voice_id: idSchema,
	label: z.string().min(1),
	raycast_agent: z.string().min(1),
	provider: z.enum(['raycast', 'kimi']).default('raycast'),
	job_status: jobStatusSchema,
	parse_status: voiceParseStatusSchema,
	/** Verbatim model output. Null until the bridge returns a row (NFR-002). */
	raw_text: z.string().nullable(),
	parse_errors: z.array(z.string()),
	content_hash: z.string().nullable(),
	prompt_hash: z.string().nullable(),
	answer_id: z.string().nullable(),
	title: z.string().nullable(),
	logline: z.string().nullable(),
	summary: z.string().nullable(),
	error: z.string().nullable()
});

export type Voice = z.infer<typeof voiceSchema>;

// ---------------------------------------------------------------------------
// End-to-end production workspace (story -> cards -> media -> assembly)
// ---------------------------------------------------------------------------

export const storyCardSchema = z.object({
	card_id: idSchema,
	order: z.number().int().nonnegative(),
	title: nonBlank(200),
	beat: nonBlank(4000),
	purpose: nonBlank(1000),
	duration_ms: z.number().int().positive().max(120_000),
	image_prompt: nonBlank(5000),
	video_prompt: nonBlank(5000),
	status: z.enum(['draft', 'approved']).default('draft'),
	/** The take chosen to represent this beat. Absent = newest live video, else newest live image. */
	pick_take_id: idSchema.optional(),
	/** Benched beats keep their place on the spine but are skipped wherever it is played or assembled. */
	benched: z.boolean().optional()
});
export type StoryCard = z.infer<typeof storyCardSchema>;

export const productionAssetSchema = z.object({
	asset_id: idSchema,
	card_id: idSchema,
	kind: z.enum(['image', 'video', 'audio']),
	name: nonBlank(500),
	mime_type: nonBlank(200),
	url: nonBlank(2000),
	/** Review trim for video takes: the usable span in seconds. Absent = whole clip. */
	in_s: z.number().nonnegative().optional(),
	out_s: z.number().positive().optional(),
	/** Speed ramp over the kept span (x 0..1), speed-up only. Absent = 1x. */
	speed: z.array(z.object({ x: z.number().min(0).max(1), rate: z.number().min(1).max(4) })).max(64).optional(),
	/** Rejected takes are kept but left out of cycling and selections. */
	rejected: z.boolean().optional(),
	/** Probed on intake (dropped files); stills under 2K on the long edge are flagged. */
	width: z.number().int().positive().optional(),
	height: z.number().int().positive().optional(),
	duration_s: z.number().positive().optional(),
	/** Generated takes: the provider's job id and what was asked for (Finalize and source info read these). */
	job_id: z.string().min(1).max(200).optional(),
	generation: z.object({
		provider: z.string(), model: z.string(), resolution: z.string(), prompt: z.string().max(10_000),
		duration_s: z.number().positive().optional(), generate_audio: z.boolean().optional(),
		/** A Seedance draft: finalizable to 1080p from the same render until seven days after draft_created_at. */
		draft: z.boolean().optional(),
		draft_created_at: rfc3339Schema.optional(),
		/** Set once finalized: the media is the 1080p render of the same job; the draft file is kept. */
		finalized_at: rfc3339Schema.optional(),
		finalize_job_id: z.string().min(1).max(200).optional(),
		draft_url: z.string().max(2000).optional()
	}).optional(),
	created_at: rfc3339Schema
});
export type ProductionAsset = z.infer<typeof productionAssetSchema>;

export const spineLinkSchema = z.object({ from: idSchema, to: idSchema });

// Cuts (CONTEXT.md: Cut, Push): a snapshot of a selection that owns its own trims, ramps and order.
export const cutEntrySchema = z.object({
	entry_id: idSchema,
	/** The beat and take this entry was pushed from; the take itself is never changed by the cut. */
	card_id: idSchema,
	asset_id: idSchema,
	in_s: z.number().nonnegative(),
	out_s: z.number().positive(),
	speed: z.array(z.object({ x: z.number().min(0).max(1), rate: z.number().min(1).max(4) })).max(64).optional()
});
export type CutEntry = z.infer<typeof cutEntrySchema>;

const layerSettingsSchema = z.object({
	/** Added on top of the automatic level, in dB. */
	gain_db: z.number().min(-60).max(24),
	mute: z.boolean()
});

/** A sound file placed on the added-effects layer at a time in the cut. */
export const placedEffectSchema = z.object({
	effect_id: idSchema,
	url: z.string().min(1).max(2000),
	name: nonBlank(300),
	at_s: z.number().nonnegative(),
	gain_db: z.number().min(-60).max(24),
	/** Proposed by the Agent and not yet kept by the operator (V1S-129). */
	suggested: z.boolean().optional()
});
export type PlacedEffect = z.infer<typeof placedEffectSchema>;

/** The sound for one locked picture version: four layers, placed effects, and the auto-mix settings. */
export const soundPlanSchema = z.object({
	layers: z.object({ take: layerSettingsSchema, ambience: layerSettingsSchema, music: layerSettingsSchema, effects: layerSettingsSchema }),
	/** The ambience bed: one file looped under the whole cut. */
	ambience: z.object({ url: z.string().min(1).max(2000), name: nonBlank(300) }).optional(),
	effects: z.array(placedEffectSchema).max(500),
	/** Length of the crossfade at every cut, seconds. */
	crossfade_s: z.number().min(0).max(1),
	/** How far music drops under hits, dialogue and effects, dB (negative). */
	duck_db: z.number().min(-40).max(0),
	/** True-peak ceiling of the limiter, dBFS. */
	limiter_db: z.number().min(-12).max(0),
	/** The last built mix of this plan. */
	mix: z.object({ url: z.string().min(1).max(2000), built_at: rfc3339Schema, report: z.array(z.string().max(500)).max(500) }).optional()
});
export type SoundPlan = z.infer<typeof soundPlanSchema>;

/** A locked picture version of a cut, kept readable after the cut is unlocked into the next version. */
export const cutVersionSchema = z.object({
	version: z.number().int().positive(),
	entries: z.array(cutEntrySchema).min(1).max(200),
	locked_at: rfc3339Schema,
	/** Sound belongs to an exact locked picture. */
	sound: soundPlanSchema.optional()
});
export type CutVersion = z.infer<typeof cutVersionSchema>;

/** A song attached to a cut: it plays from the cut's start, with its beat grid computed on attach. */
export const cutMusicSchema = z.object({
	url: z.string().min(1).max(2000),
	name: nonBlank(300),
	duration_s: z.number().positive(),
	bpm: z.number().nonnegative(),
	beats: z.array(z.number().nonnegative()).max(20_000)
});
export type CutMusic = z.infer<typeof cutMusicSchema>;

export const cutSchema = z.object({
	cut_id: idSchema,
	name: nonBlank(120),
	/** The picture version being worked on (or locked); unlocking moves to the next. */
	version: z.number().int().positive(),
	/** Locked cuts can no longer be trimmed, ramped, reordered, swapped or dropped. */
	locked: z.boolean(),
	locked_at: rfc3339Schema.optional(),
	/** Every version ever locked, oldest first, including the current one while it is locked. */
	versions: z.array(cutVersionSchema).max(500).optional(),
	/** The song the cut is matched and mixed to (not part of the picture, so it can change on a locked cut). */
	music: cutMusicSchema.optional(),
	entries: z.array(cutEntrySchema).min(1).max(200),
	created_at: rfc3339Schema,
	updated_at: rfc3339Schema
});
export type Cut = z.infer<typeof cutSchema>;

/** A generation sent from a beat (Animate) until its result lands as a take. */
export const generationSchema = z.object({
	request_id: z.string().min(1).max(200),
	card_id: idSchema,
	provider: z.literal('higgsfield'),
	model: z.string().min(1),
	prompt: z.string().min(1).max(10_000),
	duration_s: z.number().positive(),
	resolution: z.string(),
	estimate_credits: z.number().nonnegative(),
	/** A 480p draft, finalizable to 1080p from the same render for seven days. */
	draft: z.boolean().default(false),
	status: z.enum(['queued', 'in_progress', 'completed', 'failed', 'nsfw']),
	submitted_at: rfc3339Schema,
	settled_at: rfc3339Schema.optional(),
	take_id: idSchema.optional(),
	/** A finalize: on completion its 1080p video replaces this take's media instead of adding a take. */
	finalizes: idSchema.optional(),
	error: z.string().max(2000).optional()
});
export type Generation = z.infer<typeof generationSchema>;

export const productionStateSchema = z.object({
	status: z.enum(['empty', 'draft', 'approved']).default('empty'),
	title: z.string().max(200).default(''),
	logline: z.string().max(2000).default(''),
	premise: z.string().max(8000).default(''),
	theme: z.string().max(2000).default(''),
	cards: z.array(storyCardSchema).max(200).default([]),
	assets: z.array(productionAssetSchema).max(500).default([]),
	/** Spine links on the board (from 'seed' or a beat, to a beat). Absent = seed then beats in card order. */
	links: z.array(spineLinkSchema).max(400).optional(),
	/** Cuts pushed from selections; changed only by cut commands, never by board edits. */
	cuts: z.array(cutSchema).max(100).optional(),
	/** Generations sent from beats; a completed one points at the take it became. */
	generations: z.array(generationSchema).max(1000).optional(),
	updated_at: rfc3339Schema.nullable().default(null)
});
export type ProductionState = z.infer<typeof productionStateSchema>;

export const creativeRoomRunSchema = z.object({
	run_id: idSchema,
	/** Exact bridge comparison-run id (external correlation). */
	bridge_run_id: z.string().min(1),
	provider: z.enum(['raycast', 'kimi']).default('raycast'),
	catalog_hash: sha256Schema,
	prompt_hash: sha256Schema,
	status: jobStatusSchema,
	started_at: rfc3339Schema,
	updated_at: rfc3339Schema,
	message: z.string().nullable()
});

export type CreativeRoomRun = z.infer<typeof creativeRoomRunSchema>;

export const projectSchema = z.object({
	schema_version: z.literal(1),
	project_id: idSchema,
	title: z.string().min(1).max(200),
	created_at: rfc3339Schema,
	updated_at: rfc3339Schema,
	/** Aggregate version precondition (AD-3). */
	version: z.number().int().nonnegative(),
	stage: stageSchema,
	/** Gate audit trail (FR-003): default [] keeps pre-existing v1 records valid. */
	gate_history: z.array(gateHistoryEntrySchema).default([]),
	interview: interviewStateSchema.default({ status: 'BLOCKED', rounds: [] }),
	brief_state: briefStateSchema.default({ versions: [], current_version: null }),
	approval_history: z.array(briefApprovalSchema).default([]),
	seed: seedSchema,
	catalog_snapshot: catalogSnapshotSchema.nullable().default(null),
	creative_room: creativeRoomRunSchema.nullable().default(null),
	voices: z.array(voiceSchema).default([]),
	production: productionStateSchema.default({
		status: 'empty', title: '', logline: '', premise: '', theme: '', cards: [], assets: [], updated_at: null
	}),
	/** Agent model provider override + lock (V1S-117). Never holds keys. */
	agent_model: projectAgentModelSchema.default({ override: null, locked_at: null, history: [] })
});

export const Project = {
	schema: projectSchema
};

export type Project = z.infer<typeof projectSchema>;

export const projectSummarySchema = z.object({
	schema_version: z.literal(1),
	project_id: idSchema,
	title: z.string(),
	stage_id: z.string(),
	stage_state: stageStateSchema,
	updated_at: rfc3339Schema,
	version: z.number().int().nonnegative()
});

export type ProjectSummary = z.infer<typeof projectSummarySchema>;

// ---------------------------------------------------------------------------
// Canvas layout (FR-002 / AD-3): separate low-contention document,
// last-writer-wins, never contains canonical domain/audit records.
// ---------------------------------------------------------------------------

export const laneSchema = z.enum([
	'seeds',
	'voices',
	'sources',
	'storyboard',
	'trailer',
	'output'
]);

export type Lane = z.infer<typeof laneSchema>;

export const canvasNodeSchema = z.object({
	node_id: idSchema,
	type: z.enum(['seed', 'voice', 'story_card']),
	lane: laneSchema,
	x: z.number(),
	y: z.number(),
	width: z.number().positive(),
	height: z.number().positive()
});

export type CanvasNode = z.infer<typeof canvasNodeSchema>;

export const canvasLayoutSchema = z.object({
	schema_version: z.literal(1),
	project_id: idSchema,
	nodes: z.array(canvasNodeSchema),
	viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
	updated_at: rfc3339Schema
});

export type CanvasLayout = z.infer<typeof canvasLayoutSchema>;

// ---------------------------------------------------------------------------
// Ledger events (NFR-001): append-only envelope.
// ---------------------------------------------------------------------------

export const ledgerEventSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('project.created.v1'),
		event_id: idSchema,
		project_id: idSchema,
		timestamp: rfc3339Schema,
		payload: projectSchema
	}),
	z.object({
		type: z.literal('project.updated.v1'),
		event_id: idSchema,
		project_id: idSchema,
		timestamp: rfc3339Schema,
		payload: projectSchema
	}),
	z.object({
		/** Force-advance audit moment (FR-004): payload carries the advanced
		 * project including its appended gate_history entry. */
		type: z.literal('project.stage_forced.v1'),
		event_id: idSchema,
		project_id: idSchema,
		timestamp: rfc3339Schema,
		payload: projectSchema
	}),
	z.object({
		type: z.literal('project.interview_round_recorded.v1'), event_id: idSchema,
		project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema
	}),
	z.object({
		type: z.literal('project.brief_versioned.v1'), event_id: idSchema,
		project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema
	}),
	z.object({
		type: z.literal('project.brief_locked.v1'), event_id: idSchema,
		project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema
	}),
	z.object({
		type: z.literal('project.catalog_harvested.v1'),
		event_id: idSchema,
		project_id: idSchema,
		timestamp: rfc3339Schema,
		payload: projectSchema
	}),
	z.object({
		type: z.literal('project.creative_room_started.v1'),
		event_id: idSchema,
		project_id: idSchema,
		timestamp: rfc3339Schema,
		payload: projectSchema
	}),
	z.object({
		type: z.literal('project.creative_room_reconciled.v1'),
		event_id: idSchema,
		project_id: idSchema,
		timestamp: rfc3339Schema,
		payload: projectSchema
	}),
	z.object({
		type: z.literal('project.production_updated.v1'),
		event_id: idSchema,
		project_id: idSchema,
		timestamp: rfc3339Schema,
		payload: projectSchema
	}),
	z.object({ type: z.literal('project.take_picked.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema }),
	z.object({ type: z.literal('project.take_rejected.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema }),
	z.object({ type: z.literal('project.take_restored.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema }),
	z.object({ type: z.literal('project.beat_benched.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema }),
	z.object({ type: z.literal('project.beat_unbenched.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema }),
	z.object({ type: z.literal('project.spine_rewired.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema }),
	z.object({ type: z.literal('project.take_added.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema }),
	z.object({ type: z.literal('project.beat_added.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema }),
	// Agent model provider (V1S-117): override, first-run lock, explicit switch.
	z.object({
		type: z.literal('project.agent_model_set.v1'), event_id: idSchema,
		project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema
	}),
	z.object({
		type: z.literal('project.agent_model_locked.v1'), event_id: idSchema,
		project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema
	}),
	z.object({
		type: z.literal('project.agent_model_switched.v1'), event_id: idSchema,
		project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema
	}),
	// Cuts (V1S-121): push a selection, edit a cut's entries, rename it.
	z.object({ type: z.literal('project.cut_pushed.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema }),
	z.object({ type: z.literal('project.cut_edited.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema }),
	z.object({ type: z.literal('project.cut_renamed.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema }),
	z.object({ type: z.literal('project.cut_music_set.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema }),
	z.object({ type: z.literal('project.cut_sound_set.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema }),
	z.object({ type: z.literal('project.cut_locked.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema }),
	z.object({ type: z.literal('project.cut_unlocked.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema }),
	// Animate (V1S-120): a generation sent, then settled (its video lands as a take, or it failed).
	z.object({ type: z.literal('project.generation_sent.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema }),
	z.object({ type: z.literal('project.generation_settled.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema }),
	z.object({ type: z.literal('project.take_drafts_linked.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema }),
	z.object({ type: z.literal('project.finalize_sent.v1'), event_id: idSchema, project_id: idSchema, timestamp: rfc3339Schema, payload: projectSchema })
]);

export type LedgerEvent = z.infer<typeof ledgerEventSchema>;

// ---------------------------------------------------------------------------
// Commands (verb-first Zod payloads, AD-3)
// ---------------------------------------------------------------------------

export const createProjectCommandSchema = z.object({
	command: z.literal('create_project'),
	title: z.string().min(1).max(200),
	brief: z.string().max(5000),
	creative_focus: seedSchema.shape.creative_focus,
	created_by: z.string().min(1).default('gordo')
});

export const updateSeedCommandSchema = z.object({
	command: z.literal('update_seed'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	title: z.string().min(1).max(200).optional(),
	brief: z.string().max(5000).optional(),
	creative_focus: seedSchema.shape.creative_focus.optional()
});

export const saveCanvasLayoutCommandSchema = z.object({
	command: z.literal('save_canvas_layout'),
	project_id: idSchema,
	layout: canvasLayoutSchema
});

export const forceAdvanceStageCommandSchema = z.object({
	command: z.literal('force_advance_stage'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	reason: z.string().min(5).max(1000),
	operator: z.string().min(1).default('gordo')
});

export const recordInterviewRoundCommandSchema = z.object({
	command: z.literal('record_interview_round'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	questions: z.array(z.object({
		prompt: nonBlank(1000),
		answer: nonBlank(10_000)
	})).min(1).max(5),
	scores: z.array(confidenceScoreSchema).length(8),
	overall: z.number().int().min(0).max(100),
	resolutions: z.array(z.string().min(1).max(2000)).default([])
});

export const saveBriefCommandSchema = z.object({
	command: z.literal('save_brief'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	brief: briefVersionSchema.omit({ brief_id: true, version: true, content_hash: true, created_at: true })
});

export const lockBriefCommandSchema = z.object({
	command: z.literal('lock_brief'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	brief_version: z.number().int().positive(),
	brief_hash: sha256Schema,
	operator: z.string().min(1)
});

export const harvestCatalogCommandSchema = z.object({
	command: z.literal('harvest_catalog'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	requested_count: z.number().int().positive().max(20).default(5)
});

export const reshuffleRosterCommandSchema = z.object({
	command: z.literal('reshuffle_roster'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative()
});

export const startCreativeRoomCommandSchema = z.object({
	command: z.literal('start_creative_room'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative()
});

export const reconcileCreativeRoomCommandSchema = z.object({
	command: z.literal('reconcile_creative_room'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative()
});

export const saveProductionCommandSchema = z.object({
	command: z.literal('save_production'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	production: productionStateSchema
});

// Takes on beats: the pick and rejection are per-take commands, never a whole-production save.
export const setPickCommandSchema = z.object({
	command: z.literal('set_pick'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	card_id: idSchema,
	take_id: idSchema
});

export const rejectTakeCommandSchema = z.object({
	command: z.literal('reject_take'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	take_id: idSchema
});

export const restoreTakeCommandSchema = z.object({
	command: z.literal('restore_take'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	take_id: idSchema
});

export const benchBeatCommandSchema = z.object({
	command: z.enum(['bench_beat', 'unbench_beat']),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	card_id: idSchema
});

/** A take as it arrives on the board (a dropped file), before it belongs to a beat. */
export const newTakeSchema = productionAssetSchema.omit({ card_id: true, rejected: true, in_s: true, out_s: true, speed: true }).extend({
	kind: z.enum(['image', 'video'])
});

/** A dropped file on a beat: a new take that becomes the pick. */
export const addTakeCommandSchema = z.object({
	command: z.literal('add_take'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	card_id: idSchema,
	take: newTakeSchema
});

/** A dropped file on empty canvas: a new benched beat, off the spine, holding that take. */
export const addBeatCommandSchema = z.object({
	command: z.literal('add_beat'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	card_id: idSchema,
	title: nonBlank(200),
	take: newTakeSchema
});

/** Link existing takes to the Seedance draft jobs they came from (found by matching files), so they can be finalized. */
export const linkDraftJobsCommandSchema = z.object({
	command: z.literal('link_draft_jobs'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	links: z.array(z.object({
		take_id: idSchema,
		job_id: z.string().min(1).max(200),
		draft_created_at: rfc3339Schema,
		prompt: z.string().min(1).max(10_000),
		duration_s: z.number().positive(),
		generate_audio: z.boolean()
	})).min(1).max(500)
});

/** The board's full set of spine links after an unhook/rehook; the gateway derives and stores the new story order. */
export const rewireSpineCommandSchema = z.object({
	command: z.literal('rewire_spine'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	links: z.array(spineLinkSchema).max(400)
});

export type CreateProjectCommand = z.infer<typeof createProjectCommandSchema>;
export type UpdateSeedCommand = z.infer<typeof updateSeedCommandSchema>;
export type SaveCanvasLayoutCommand = z.infer<typeof saveCanvasLayoutCommandSchema>;
export type ForceAdvanceStageCommand = z.infer<typeof forceAdvanceStageCommandSchema>;
export type RecordInterviewRoundCommand = z.infer<typeof recordInterviewRoundCommandSchema>;
export type SaveBriefCommand = z.infer<typeof saveBriefCommandSchema>;
export type LockBriefCommand = z.infer<typeof lockBriefCommandSchema>;
export type HarvestCatalogCommand = z.infer<typeof harvestCatalogCommandSchema>;
export type ReshuffleRosterCommand = z.infer<typeof reshuffleRosterCommandSchema>;
export type StartCreativeRoomCommand = z.infer<typeof startCreativeRoomCommandSchema>;
export type ReconcileCreativeRoomCommand = z.infer<typeof reconcileCreativeRoomCommandSchema>;
export type SaveProductionCommand = z.infer<typeof saveProductionCommandSchema>;

// Agent model provider commands (V1S-117).
export const setProjectModelCommandSchema = z.object({
	command: z.literal('set_project_model'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	/** null = follow the app default (only before the project is locked). */
	choice: modelChoiceSchema.nullable(),
	operator: z.string().min(1),
	reason: z.string().trim().max(1000).nullable().default(null),
	confirm_switch: z.boolean().default(false)
});

export const lockProjectModelCommandSchema = z.object({
	command: z.literal('lock_project_model'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	choice: modelChoiceSchema,
	operator: z.string().min(1)
});

export type SetProjectModelCommand = z.infer<typeof setProjectModelCommandSchema>;
export type LockProjectModelCommand = z.infer<typeof lockProjectModelCommandSchema>;

// Cut commands (V1S-121). Entries carry their own trim and ramp; the gateway assigns ids on push.
const cutEntryInputSchema = cutEntrySchema.omit({ entry_id: true });

export const pushCutCommandSchema = z.object({
	command: z.literal('push_cut'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	name: nonBlank(120),
	entries: z.array(cutEntryInputSchema).min(1).max(200)
});

/** A cut's whole entry list after an edit: order, trims, ramps, dropped entries. */
export const editCutCommandSchema = z.object({
	command: z.literal('edit_cut'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	cut_id: idSchema,
	entries: z.array(cutEntrySchema).min(1).max(200)
});

export const renameCutCommandSchema = z.object({
	command: z.literal('rename_cut'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	cut_id: idSchema,
	name: nonBlank(120)
});

/** Lock freezes the cut's picture as its current version; unlock opens the next version from it. */
export const lockCutCommandSchema = z.object({
	command: z.enum(['lock_cut', 'unlock_cut']),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	cut_id: idSchema
});

/** Attach a song to a cut (or remove it with null). */
export const setCutMusicCommandSchema = z.object({
	command: z.literal('set_cut_music'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	cut_id: idSchema,
	music: cutMusicSchema.nullable()
});

/** Save the sound plan of a locked cut version. */
export const setSoundPlanCommandSchema = z.object({
	command: z.literal('set_sound_plan'),
	project_id: idSchema,
	expected_version: z.number().int().nonnegative(),
	cut_id: idSchema,
	version: z.number().int().positive(),
	plan: soundPlanSchema
});

export type PushCutCommand = z.infer<typeof pushCutCommandSchema>;
export type EditCutCommand = z.infer<typeof editCutCommandSchema>;
export type RenameCutCommand = z.infer<typeof renameCutCommandSchema>;

// ---------------------------------------------------------------------------
// Capability state (FR-032 / AR-06): real availability only, never fabricated.
// ---------------------------------------------------------------------------

export const capabilityStateSchema = z.enum([
	'available',
	'degraded',
	'offline',
	'planned',
	'not-configured',
	'not-checked'
]);

export type CapabilityState = z.infer<typeof capabilityStateSchema>;

export const capabilityReportSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	kind: z.enum(['host', 'machine', 'service', 'provider']),
	state: capabilityStateSchema,
	/** Real observed detail (error text, HTTP status, config note). */
	detail: z.string(),
	/** Null until a real check has run (NFR-002). */
	last_checked: rfc3339Schema.nullable()
});

export type CapabilityReport = z.infer<typeof capabilityReportSchema>;
