import { z } from 'zod';

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
	status: z.enum(['draft', 'approved']).default('draft')
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
	created_at: rfc3339Schema
});
export type ProductionAsset = z.infer<typeof productionAssetSchema>;

export const productionStateSchema = z.object({
	status: z.enum(['empty', 'draft', 'approved']).default('empty'),
	title: z.string().max(200).default(''),
	logline: z.string().max(2000).default(''),
	premise: z.string().max(8000).default(''),
	theme: z.string().max(2000).default(''),
	cards: z.array(storyCardSchema).max(40).default([]),
	assets: z.array(productionAssetSchema).max(500).default([]),
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
	})
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
	})
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
