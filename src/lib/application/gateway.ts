import { createHash } from 'node:crypto';
import type { ProjectStore } from '$lib/adapters/project-store';
import { RaycastBridge, RaycastBridgeError, matchAnswerToLabel } from '$lib/adapters/m3-bridge';
import {
	createProjectCommandSchema,
	updateSeedCommandSchema,
	saveCanvasLayoutCommandSchema,
	forceAdvanceStageCommandSchema,
	harvestCatalogCommandSchema,
	reshuffleRosterCommandSchema,
	startCreativeRoomCommandSchema,
	reconcileCreativeRoomCommandSchema,
	saveProductionCommandSchema,
	setProjectModelCommandSchema,
	lockProjectModelCommandSchema,
	recordInterviewRoundCommandSchema,
	saveBriefCommandSchema,
	lockBriefCommandSchema,
	setPickCommandSchema,
	rejectTakeCommandSchema,
	restoreTakeCommandSchema,
	benchBeatCommandSchema,
	rewireSpineCommandSchema,
	addTakeCommandSchema,
	addBeatCommandSchema,
	linkDraftJobsCommandSchema
} from '$lib/domain/schemas';
import { applyForceAdvance, applyInterviewRound, evaluateInterviewRound, applyBriefLock, isCurrentBriefLocked } from '$lib/domain/gates';
import { applyProjectModelChoice, applyProjectModelLock } from '$lib/domain/model-provider';
import { uuid7ish, randomSeedHex } from '$lib/domain/ids';
import { DEFAULT_ROSTER_COUNT, selectRoster } from '$lib/domain/roster';
import { applySetPick, applyRejectTake, applyRestoreTake, type TakeResult } from '$lib/domain/takes';
import { applyBench } from '$lib/domain/bench';
import { applyRewire } from '$lib/domain/spine';
import { applyAddBeat, applyAddTake } from '$lib/domain/media';
import { applyRecordGeneration, applySettleGeneration } from '$lib/domain/animate';
import { applyLinkDraftJobs } from '$lib/domain/finalize';
import type { Generation, ProductionAsset, TrailerHouse } from '$lib/domain/schemas';
import { trailerHouseSchema } from '$lib/domain/schemas';
import { applyTrailerHouse } from '$lib/domain/trailer-house';
import type { Project, ProjectSummary, CanvasLayout, Voice, LedgerEvent } from '$lib/domain/schemas';
import { pushCutCommandSchema, editCutCommandSchema, renameCutCommandSchema, lockCutCommandSchema, setCutMusicCommandSchema, setSoundPlanCommandSchema, groupCommandSchema } from '$lib/domain/schemas';
import { applyCreateGroup, applyMoveBeats, applyRenameGroup, applySplitIntoShots, MAIN_GROUP } from '$lib/domain/groups';
import { applyPushCut, applyEditCut, applyRenameCut, applyLockCut, applyUnlockCut, applySetCutMusic, applySetSoundPlan, keepStoredCuts } from '$lib/domain/cuts';

type LedgerEventType = LedgerEvent['type'];

/**
 * Application layer (AD-3): the only mutation entry point. Typed commands
 * through one project command gateway.
 */

export interface CommandResult<T> {
	ok: true;
	data: T;
}

export interface CommandFailure {
	ok: false;
	error: { code: string; message: string; retryable: boolean; source: string };
}

export type CommandOutcome<T> = CommandResult<T> | CommandFailure;

const notFound = (message: string): CommandFailure => ({
	ok: false,
	error: { code: 'NOT_FOUND', message, retryable: false, source: 'project-store' }
});

const conflict = (message: string): CommandFailure => ({
	ok: false,
	error: { code: 'VERSION_CONFLICT', message, retryable: true, source: 'project-store' }
});

const invalid = (message: string): CommandFailure => ({
	ok: false,
	error: { code: 'INVALID_COMMAND', message, retryable: false, source: 'application' }
});

const unavailable = (message: string): CommandFailure => ({
	ok: false,
	error: { code: 'CAPABILITY_UNAVAILABLE', message, retryable: false, source: 'm3-bridge' }
});

const bridgeFailure = (e: unknown): CommandFailure => {
	if (e instanceof RaycastBridgeError) {
		return { ok: false, error: { code: e.code, message: e.message, retryable: e.retryable, source: 'm3-bridge' } };
	}
	return {
		ok: false,
		error: {
			code: 'BRIDGE_ERROR',
			message: e instanceof Error ? e.message : 'Raycast bridge call failed',
			retryable: true,
			source: 'm3-bridge'
		}
	};
};

function sha256(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex');
}

function structuredString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

export class ProjectCommandGateway {
	constructor(
		private readonly store: ProjectStore,
		private readonly bridge: RaycastBridge | null = null
	) {}

	async handle(raw: unknown): Promise<CommandOutcome<Project | CanvasLayout | ProjectSummary[]>> {
		const command = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).command : null;
		switch (command) {
			case 'create_project':
				return this.createProject(raw);
			case 'update_seed':
				return this.updateSeed(raw);
			case 'save_canvas_layout':
				return this.saveCanvasLayout(raw);
			case 'force_advance_stage':
				return this.forceAdvanceStage(raw);
			case 'record_interview_round':
				return this.recordInterviewRound(raw);
			case 'save_brief':
				return this.saveBrief(raw);
			case 'lock_brief':
				return this.lockBrief(raw);
			case 'harvest_catalog':
				return this.harvestCatalog(raw);
			case 'reshuffle_roster':
				return this.reshuffleRoster(raw);
			case 'start_creative_room':
				return this.startCreativeRoom(raw);
			case 'reconcile_creative_room':
				return this.reconcileCreativeRoom(raw);
			case 'save_production':
				return this.saveProduction(raw);
			case 'set_pick':
				return this.setPick(raw);
			case 'reject_take':
				return this.rejectTake(raw);
			case 'restore_take':
				return this.restoreTake(raw);
			case 'bench_beat':
			case 'unbench_beat':
				return this.benchBeat(raw);
			case 'rewire_spine':
				return this.rewireSpine(raw);
			case 'add_take':
				return this.addTake(raw);
			case 'add_beat':
				return this.addBeat(raw);
			case 'set_project_model':
				return this.setProjectModel(raw);
			case 'lock_project_model':
				return this.lockProjectModel(raw);
			case 'push_cut':
				return this.pushCut(raw);
			case 'edit_cut':
				return this.editCut(raw);
			case 'rename_cut':
				return this.renameCut(raw);
			case 'lock_cut':
			case 'unlock_cut':
				return this.lockCut(raw);
			case 'create_group':
			case 'rename_group':
			case 'move_beats':
				return this.changeGroups(raw);
			case 'set_cut_music':
				return this.setCutMusic(raw);
			case 'set_sound_plan':
				return this.setSoundPlan(raw);
			default:
				return invalid(`Unknown command: ${String(command)}`);
		}
	}

	async createProject(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = createProjectCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		try {
			return { ok: true, data: await this.store.createProject(parsed.data) };
		} catch (e) {
			return notFound(e instanceof Error ? e.message : 'create failed');
		}
	}

	async updateSeed(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = updateSeedCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		try {
			const project = await this.store.updateProject(
				parsed.data.project_id,
				parsed.data.expected_version,
				(current) => ({
					...current,
					title: parsed.data.title ?? current.title,
					seed: {
						...current.seed,
						...(parsed.data.title !== undefined && { title: parsed.data.title }),
						...(parsed.data.brief !== undefined && { brief: parsed.data.brief }),
						...(parsed.data.creative_focus !== undefined && {
							creative_focus: parsed.data.creative_focus
						})
					}
				})
			);
			return { ok: true, data: project };
		} catch (e) {
			const message = e instanceof Error ? e.message : 'update failed';
			if (message.includes('Version conflict')) return conflict(message);
			if (message.includes('not found')) return notFound(message);
			return { ok: false, error: { code: 'STORE_ERROR', message, retryable: true, source: 'project-store' } };
		}
	}

	/**
	 * Operator-only force-advance (FR-004): the gate engine computes the
	 * transition and audit entry; the store appends it as its own event type.
	 */
	async forceAdvanceStage(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = forceAdvanceStageCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		try {
			const project = await this.store.updateProject(
				parsed.data.project_id,
				parsed.data.expected_version,
				(current) => {
					const result = applyForceAdvance(current, {
						reason: parsed.data.reason,
						operator: parsed.data.operator,
						now: new Date().toISOString()
					});
					if (!result.ok) throw new Error(result.message);
					return result.project;
				},
				'project.stage_forced.v1'
			);
			return { ok: true, data: project };
		} catch (e) {
			const message = e instanceof Error ? e.message : 'force-advance failed';
			if (message.includes('Version conflict')) return conflict(message);
			if (message.includes('not found')) return notFound(message);
			if (message.includes('no later stage') || message.includes('cannot be skipped')) return invalid(message);
			return { ok: false, error: { code: 'STORE_ERROR', message, retryable: true, source: 'project-store' } };
		}
	}

	async saveProduction(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = saveProductionCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'Invalid production workspace');
		try {
			const project = await this.store.updateProject(
				parsed.data.project_id,
				parsed.data.expected_version,
				// Cuts change only through cut commands: a whole-production save keeps the stored ones.
				(current) => ({ ...current, production: { ...keepStoredCuts(parsed.data.production, current.production), updated_at: new Date().toISOString() } }),
				'project.production_updated.v1'
			);
			return { ok: true, data: project };
		} catch (e) {
			return this.storeError(e);
		}
	}

	async setPick(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = setPickCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		const { card_id, take_id } = parsed.data;
		return this.updateBoard(parsed.data, (production) => applySetPick(production, card_id, take_id), 'project.take_picked.v1');
	}

	async rejectTake(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = rejectTakeCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		return this.updateBoard(parsed.data, (production) => applyRejectTake(production, parsed.data.take_id), 'project.take_rejected.v1');
	}

	async restoreTake(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = restoreTakeCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		return this.updateBoard(parsed.data, (production) => applyRestoreTake(production, parsed.data.take_id), 'project.take_restored.v1');
	}

	async benchBeat(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = benchBeatCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		const bench = parsed.data.command === 'bench_beat';
		return this.updateBoard(
			parsed.data,
			(production) => applyBench(production, parsed.data.card_id, bench),
			bench ? 'project.beat_benched.v1' : 'project.beat_unbenched.v1'
		);
	}

	/** Animate (server-internal, after the send gate passed and the provider accepted): note the pending generation. */
	async linkDraftJobs(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = linkDraftJobsCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		return this.updateBoard(parsed.data, (production) => applyLinkDraftJobs(production, parsed.data.links), 'project.take_drafts_linked.v1');
	}

	/** Finalize (server-internal, after the price was confirmed and the provider accepted each job): note them as pending. */
	async recordFinalizes(projectId: string, expectedVersion: number, generations: Generation[]): Promise<CommandOutcome<Project>> {
		return this.updateBoard({ project_id: projectId, expected_version: expectedVersion }, (production) => {
			let next = production;
			for (const generation of generations) {
				const result = applyRecordGeneration(next, generation);
				if (!result.ok) return result;
				next = result.production;
			}
			return { ok: true, production: next };
		}, 'project.finalize_sent.v1');
	}

	async recordGeneration(projectId: string, expectedVersion: number, generation: Generation): Promise<CommandOutcome<Project>> {
		return this.updateBoard({ project_id: projectId, expected_version: expectedVersion }, (production) => applyRecordGeneration(production, generation), 'project.generation_sent.v1');
	}

	/** Animate: a generation's latest status; a completed one lands its video as a take. */
	async settleGeneration(
		projectId: string,
		expectedVersion: number,
		requestId: string,
		outcome: { status: Generation['status']; take?: Omit<ProductionAsset, 'card_id'>; error?: string }
	): Promise<CommandOutcome<Project>> {
		return this.updateBoard(
			{ project_id: projectId, expected_version: expectedVersion },
			(production) => applySettleGeneration(production, requestId, outcome, new Date().toISOString()),
			'project.generation_settled.v1'
		);
	}

	async addTake(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = addTakeCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		return this.updateBoard(parsed.data, (production) => applyAddTake(production, parsed.data.card_id, parsed.data.take), 'project.take_added.v1');
	}

	async addBeat(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = addBeatCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		const { card_id, title, take, group_id } = parsed.data;
		return this.updateBoard(parsed.data, (production) => {
			const added = applyAddBeat(production, card_id, title, take);
			return added.ok && group_id && group_id !== MAIN_GROUP ? applyMoveBeats(added.production, [card_id], group_id) : added;
		}, 'project.beat_added.v1');
	}

	/** Board groups (V1S-131): create, rename, move beats between them. */
	/** Trailer House: save the seeds, a round of loglines, the pick or its blueprint (the Agent call happens in the route). */
	async setTrailerHouse(projectId: string, expectedVersion: number, next: TrailerHouse): Promise<CommandOutcome<Project>> {
		const parsed = trailerHouseSchema.safeParse(next);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'Invalid Trailer House state');
		try {
			const project = await this.store.updateProject(projectId, expectedVersion, (current) => applyTrailerHouse(current, parsed.data, uuid7ish(), sha256), 'project.trailer_house_set.v1');
			return { ok: true, data: project };
		} catch (e) {
			return this.storeError(e);
		}
	}

	async changeGroups(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = groupCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		const command = parsed.data;
		return this.updateBoard(command, (production) => {
			if (command.command === 'create_group') return applyCreateGroup(production, command, new Date().toISOString());
			if (command.command === 'rename_group') return applyRenameGroup(production, command.group_id, command.name);
			return applyMoveBeats(production, command.card_ids, command.group_id);
		}, 'project.group_changed.v1');
	}

	/** A take split into shots (server-internal, after the splitter returned and the clips were saved). */
	async splitIntoShots(projectId: string, expectedVersion: number, input: Parameters<typeof applySplitIntoShots>[1]): Promise<CommandOutcome<Project>> {
		return this.updateBoard({ project_id: projectId, expected_version: expectedVersion }, (production) => applySplitIntoShots(production, input, new Date().toISOString()), 'project.take_split.v1');
	}

	async rewireSpine(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = rewireSpineCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		return this.updateBoard(parsed.data, (production) => applyRewire(production, parsed.data.links), 'project.spine_rewired.v1');
	}

	/** Board edits to beats and takes: a pure production change, refused as INVALID_COMMAND when it doesn't apply. */
	private async updateBoard(
		command: { project_id: string; expected_version: number },
		apply: (production: Project['production']) => TakeResult,
		eventType: Extract<LedgerEventType, `project.take_${string}` | `project.beat_${string}` | 'project.spine_rewired.v1' | `project.generation_${string}` | 'project.finalize_sent.v1' | 'project.group_changed.v1'>
	): Promise<CommandOutcome<Project>> {
		let refusal: string | null = null;
		try {
			const project = await this.store.updateProject(command.project_id, command.expected_version, (current) => {
				const result = apply(current.production);
				if (!result.ok) { refusal = result.message; throw new Error(result.message); }
				return { ...current, production: { ...result.production, updated_at: new Date().toISOString() } };
			}, eventType);
			return { ok: true, data: project };
		} catch (e) {
			return refusal ? invalid(refusal) : this.storeError(e);
		}
	}

	async recordInterviewRound(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = recordInterviewRoundCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		try {
			const project = await this.store.updateProject(
				parsed.data.project_id,
				parsed.data.expected_version,
				(current) => {
					const questions = parsed.data.questions.map((item) => ({ question_id: uuid7ish(), prompt: item.prompt }));
					const scores = parsed.data.scores;
					const lowest = scores.reduce((best, score) => score.score < best.score ? score : best);
					const round = evaluateInterviewRound({
						round_id: uuid7ish(),
						round_number: current.interview.rounds.length + 1,
						questions,
						answers: questions.map((question, index) => ({ question_id: question.question_id, raw_text: parsed.data.questions[index].answer })),
						scores,
						overall: parsed.data.overall,
						lowest_dimension: lowest.dimension,
						lowest_score: lowest.score,
						resolutions: parsed.data.resolutions,
						created_at: new Date().toISOString()
					});
					return applyInterviewRound(current, round);
				},
				'project.interview_round_recorded.v1'
			);
			return { ok: true, data: project };
		} catch (e) {
			const message = e instanceof Error ? e.message : 'interview round failed';
			if (message.includes('illegal') || message.includes('STALLED') || message.includes('must be') || message.includes('Lock the current brief')) return invalid(message);
			return this.storeError(e);
		}
	}

	async saveBrief(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = saveBriefCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'Complete every S2 brief field');
		try {
			const project = await this.store.updateProject(
				parsed.data.project_id,
				parsed.data.expected_version,
				(current) => {
					const preInterview = current.interview.rounds.length === 0 && (current.stage.id === 'S0' || current.stage.id === 'S1');
					const legacyPostInterview = current.interview.status === 'PASSED' && current.stage.id === 'S2' && current.stage.state !== 'PASSED';
					if (!preInterview && !legacyPostInterview) {
						throw new Error('The brief cannot change after interview evidence has been recorded');
					}
					if (isCurrentBriefLocked(current) && !preInterview) {
						throw new Error('The locked brief is immutable');
					}
					const version = (current.brief_state.current_version ?? 0) + 1;
					const created_at = new Date().toISOString();
					const content_hash = sha256(JSON.stringify(parsed.data.brief));
					const brief = { ...parsed.data.brief, brief_id: uuid7ish(), version, content_hash, created_at };
					return {
						...current,
						stage: preInterview ? { id: 'S0', state: 'BLOCKED', confidence: null } : current.stage,
						brief_state: { versions: [...current.brief_state.versions, brief], current_version: version }
					};
				},
				'project.brief_versioned.v1'
			);
			return { ok: true, data: project };
		} catch (e) {
			const message = e instanceof Error ? e.message : 'brief save failed';
			if (message.includes('cannot change') || message.includes('immutable')) return invalid(message);
			return this.storeError(e);
		}
	}

	async lockBrief(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = lockBriefCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		try {
			const project = await this.store.updateProject(
				parsed.data.project_id,
				parsed.data.expected_version,
				(current) => applyBriefLock(current, {
					briefVersion: parsed.data.brief_version,
					briefHash: parsed.data.brief_hash,
					operator: parsed.data.operator,
					now: new Date().toISOString()
				}),
				'project.brief_locked.v1'
			);
			return { ok: true, data: project };
		} catch (e) {
			const message = e instanceof Error ? e.message : 'brief lock failed';
			if (message.includes('requires') || message.includes('required') || message.includes('stale') || message.includes('locked') || message.includes('unavailable')) return invalid(message);
			return this.storeError(e);
		}
	}

	async saveCanvasLayout(raw: unknown): Promise<CommandOutcome<CanvasLayout>> {
		const parsed = saveCanvasLayoutCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		const existing = await this.store.readProject(parsed.data.project_id);
		if (!existing) return notFound(`Project ${parsed.data.project_id} not found`);
		try {
			return { ok: true, data: await this.store.writeCanvasLayout(parsed.data.project_id, parsed.data.layout) };
		} catch (e) {
			return { ok: false, error: { code: 'STORE_ERROR', message: e instanceof Error ? e.message : 'layout write failed', retryable: true, source: 'project-store' } };
		}
	}

	async harvestCatalog(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = harvestCatalogCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		if (!this.bridge) {
			return unavailable('CSP_RAYCAST_BRIDGE_URL/TOKEN is not configured (legacy CSP_M3_* aliases are supported)');
		}
		let harvested;
		try {
			harvested = await this.bridge.getModelCatalog();
		} catch (e) {
			return bridgeFailure(e);
		}
		const requested = parsed.data.requested_count ?? DEFAULT_ROSTER_COUNT;
		try {
			const project = await this.store.updateProject(
				parsed.data.project_id,
				parsed.data.expected_version,
				(current) => {
					const pinned = current.catalog_snapshot?.selected.filter((slot) => slot.pinned).map((slot) => slot.label) ?? [];
					const seed = current.catalog_snapshot?.selection_seed ?? randomSeedHex();
					const roster = selectRoster(harvested.models, requested, seed, pinned);
					return {
						...current,
						catalog_snapshot: {
							bridge_version: harvested.bridge_version,
							harvested_at: harvested.harvested_at,
							catalog_hash: harvested.catalog_hash,
							source: harvested.source,
							models: harvested.models,
							requested_count: requested,
							selection_seed: seed,
							selected: roster.selected,
							shortfall: roster.shortfall
						}
					};
				},
				'project.catalog_harvested.v1'
			);
			return { ok: true, data: project };
		} catch (e) {
			return this.storeError(e);
		}
	}

	async reshuffleRoster(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = reshuffleRosterCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		try {
			const project = await this.store.updateProject(
				parsed.data.project_id,
				parsed.data.expected_version,
				(current) => {
					if (!current.catalog_snapshot) {
						throw new Error('Harvest a live catalog before reshuffling the roster');
					}
					const seed = randomSeedHex();
					const pinned = current.catalog_snapshot.selected.filter((slot) => slot.pinned).map((slot) => slot.label);
					const roster = selectRoster(
						current.catalog_snapshot.models,
						current.catalog_snapshot.requested_count,
						seed,
						pinned
					);
					return {
						...current,
						catalog_snapshot: {
							...current.catalog_snapshot,
							selection_seed: seed,
							selected: roster.selected,
							shortfall: roster.shortfall
						}
					};
				}
			);
			return { ok: true, data: project };
		} catch (e) {
			const message = e instanceof Error ? e.message : 'reshuffle failed';
			if (message.includes('Harvest a live catalog')) return invalid(message);
			return this.storeError(e);
		}
	}

	async startCreativeRoom(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = startCreativeRoomCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		if (!this.bridge) {
			return unavailable('CSP_RAYCAST_BRIDGE_URL/TOKEN is not configured (legacy CSP_M3_* aliases are supported)');
		}
		const current = await this.store.readProject(parsed.data.project_id);
		if (!current) return notFound(`Project ${parsed.data.project_id} not found`);
		if (current.version !== parsed.data.expected_version) {
			return conflict(`Version conflict: expected ${parsed.data.expected_version}, current ${current.version}`);
		}
		if (!current.catalog_snapshot || current.catalog_snapshot.selected.length === 0) {
			return invalid('Harvest a live catalog before running the Creative Room');
		}
		const brief = current.seed.brief.trim();
		if (brief.length < 20) {
			return invalid('Brief must be at least 20 characters before dispatch — the bridge will reject a shorter question');
		}
		if (current.creative_room && (current.creative_room.status === 'queued' || current.creative_room.status === 'running')) {
			return invalid(`Creative Room run ${current.creative_room.bridge_run_id} is still ${current.creative_room.status}; reconcile it instead of dispatching again`);
		}

		const promptHash = sha256(brief);
		const labels = current.catalog_snapshot.selected.map((slot) => slot.label);
		let created;
		try {
			created = await this.bridge.createComparisonRun({
				title: current.seed.title,
				question: brief,
				models_requested: labels
			});
		} catch (e) {
			return bridgeFailure(e);
		}

		const now = new Date().toISOString();
		const voices: Voice[] = current.catalog_snapshot.selected.map((slot) => ({
			voice_id: uuid7ish(),
			label: slot.label,
			raycast_agent: slot.raycast_agent,
			provider: slot.provider,
			job_status: 'queued',
			parse_status: 'pending',
			raw_text: null,
			parse_errors: [],
			content_hash: null,
			prompt_hash: promptHash,
			answer_id: null,
			title: null,
			logline: null,
			summary: null,
			error: null
		}));

		let captureMessage: string | null = null;
		let captureFailed = false;
		try {
			const prepared = await this.bridge.prepareConceptCapture(created.run_id);
			const directApi = current.catalog_snapshot.selected.every((slot) => slot.provider === 'kimi');
			captureMessage = directApi
				? prepared.message
				: `Prepared ${created.run_id} · ${current.catalog_snapshot.selected.map((slot) => `open ${slot.raycast_agent} for exact label ${slot.label}, then ${prepared.capture_commands.by_label?.[slot.label] ?? `Capture Directors Cut Answer with label ${slot.label}`}`).join(' · ')}`;
		} catch (e) {
			captureFailed = true;
			captureMessage = e instanceof Error ? e.message : 'capture dispatch failed';
		}

		try {
			const project = await this.store.updateProject(
				parsed.data.project_id,
				parsed.data.expected_version,
				(latest) => ({
					...latest,
					creative_room: {
						run_id: uuid7ish(),
						bridge_run_id: created.run_id,
						provider: current.catalog_snapshot!.selected[0]?.provider ?? 'raycast',
						catalog_hash: latest.catalog_snapshot?.catalog_hash ?? current.catalog_snapshot!.catalog_hash,
						prompt_hash: promptHash,
						status: captureFailed ? 'failed' : 'running',
						started_at: now,
						updated_at: now,
						message: captureMessage
					},
					voices: voices.map((voice) => ({
						...voice,
						job_status: captureFailed ? 'failed' : 'running',
						error: captureFailed ? captureMessage : null
					}))
				}),
				'project.creative_room_started.v1'
			);
			await this.ensureVoiceNodes(project);
			return { ok: true, data: project };
		} catch (e) {
			return this.storeError(e);
		}
	}

	async reconcileCreativeRoom(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = reconcileCreativeRoomCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		if (!this.bridge) {
			return unavailable('CSP_RAYCAST_BRIDGE_URL/TOKEN is not configured (legacy CSP_M3_* aliases are supported)');
		}
		const current = await this.store.readProject(parsed.data.project_id);
		if (!current) return notFound(`Project ${parsed.data.project_id} not found`);
		if (!current.creative_room) return invalid('No Creative Room run to reconcile');

		let status;
		let answers: Awaited<ReturnType<RaycastBridge['readConceptAnswers']>> | null = null;
		try {
			status = await this.bridge.getConceptCaptureStatus(current.creative_room.bridge_run_id);
			if (status.answers_count > 0) {
				answers = await this.bridge.readConceptAnswers(current.creative_room.bridge_run_id);
			}
		} catch (e) {
			return bridgeFailure(e);
		}

		try {
			const currentExpected = parsed.data.expected_version;
			const preview = applyReconcile(current, status, answers);
			if (!preview.changed) return { ok: true, data: current };
			const project = await this.store.updateProject(
				parsed.data.project_id,
				currentExpected,
				(latest) => applyReconcile(latest, status, answers).project,
				'project.creative_room_reconciled.v1'
			);
			await this.ensureVoiceNodes(project);
			return { ok: true, data: project };
		} catch (e) {
			return this.storeError(e);
		}
	}

	// --- Agent model provider (V1S-117): override, first-run lock, explicit switch.

	async setProjectModel(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = setProjectModelCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		let eventType: 'project.agent_model_set.v1' | 'project.agent_model_switched.v1' = 'project.agent_model_set.v1';
		try {
			const preview = await this.store.readProject(parsed.data.project_id);
			if (preview?.agent_model.locked_at) eventType = 'project.agent_model_switched.v1';
			const project = await this.store.updateProject(
				parsed.data.project_id,
				parsed.data.expected_version,
				(current) => {
					const result = applyProjectModelChoice(current.agent_model, {
						choice: parsed.data.choice,
						operator: parsed.data.operator,
						reason: parsed.data.reason,
						confirm_switch: parsed.data.confirm_switch,
						now: new Date().toISOString()
					});
					if ((result.event === 'switched') !== (eventType === 'project.agent_model_switched.v1')) {
						throw new Error('Version conflict: project model lock changed during the switch');
					}
					return { ...current, agent_model: result.state };
				},
				eventType
			);
			return { ok: true, data: project };
		} catch (e) {
			const message = e instanceof Error ? e.message : 'model change failed';
			if (message.includes('already uses') || message.includes('is locked')) return invalid(message);
			return this.storeError(e);
		}
	}

	async lockProjectModel(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = lockProjectModelCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		const now = new Date().toISOString();
		try {
			const current = await this.store.readProject(parsed.data.project_id);
			if (!current) return notFound(`Project ${parsed.data.project_id} not found`);
			const preview = applyProjectModelLock(current.agent_model, { choice: parsed.data.choice, operator: parsed.data.operator, now });
			if (!preview.changed) return { ok: true, data: current };
			const project = await this.store.updateProject(
				parsed.data.project_id,
				parsed.data.expected_version,
				(latest) => ({ ...latest, agent_model: applyProjectModelLock(latest.agent_model, { choice: parsed.data.choice, operator: parsed.data.operator, now }).state }),
				'project.agent_model_locked.v1'
			);
			return { ok: true, data: project };
		} catch (e) {
			const message = e instanceof Error ? e.message : 'model lock failed';
			if (message.includes('is locked') || message.includes('override is')) return invalid(message);
			return this.storeError(e);
		}
	}

	// --- Cuts (V1S-121): push a selection into a named cut; edits change the cut only, never takes or beats.

	async pushCut(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = pushCutCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		const { name, entries } = parsed.data;
		return this.updateCuts(parsed.data, (production, now) => applyPushCut(production, { cut_id: uuid7ish(), name, entries }, uuid7ish, now), 'project.cut_pushed.v1');
	}

	async editCut(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = editCutCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		const { cut_id, entries } = parsed.data;
		return this.updateCuts(parsed.data, (production, now) => applyEditCut(production, cut_id, entries, now), 'project.cut_edited.v1');
	}

	async renameCut(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = renameCutCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		const { cut_id, name } = parsed.data;
		return this.updateCuts(parsed.data, (production, now) => applyRenameCut(production, cut_id, name, now), 'project.cut_renamed.v1');
	}

	/** Lock freezes a cut's current version; unlock opens the next version (V1S-125). */
	async lockCut(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = lockCutCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		const { cut_id, command } = parsed.data;
		return command === 'lock_cut'
			? this.updateCuts(parsed.data, (production, now) => applyLockCut(production, cut_id, now), 'project.cut_locked.v1')
			: this.updateCuts(parsed.data, (production, now) => applyUnlockCut(production, cut_id, now), 'project.cut_unlocked.v1');
	}

	/** Attach a song to a cut, or remove it (V1S-126). */
	async setCutMusic(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = setCutMusicCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		const { cut_id, music } = parsed.data;
		return this.updateCuts(parsed.data, (production, now) => applySetCutMusic(production, cut_id, music, now), 'project.cut_music_set.v1');
	}

	/** Save a locked version's sound plan (V1S-128). */
	async setSoundPlan(raw: unknown): Promise<CommandOutcome<Project>> {
		const parsed = setSoundPlanCommandSchema.safeParse(raw);
		if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid payload');
		const { cut_id, version, plan } = parsed.data;
		return this.updateCuts(parsed.data, (production, now) => applySetSoundPlan(production, cut_id, version, plan, now), 'project.cut_sound_set.v1');
	}

	/** A pure change to the project's cuts, refused as INVALID_COMMAND when it doesn't apply. */
	private async updateCuts(
		command: { project_id: string; expected_version: number },
		apply: (production: Project['production'], now: string) => TakeResult,
		eventType: Extract<LedgerEventType, `project.cut_${string}`>
	): Promise<CommandOutcome<Project>> {
		let refusal: string | null = null;
		try {
			const project = await this.store.updateProject(command.project_id, command.expected_version, (current) => {
				const now = new Date().toISOString();
				const result = apply(current.production, now);
				if (!result.ok) { refusal = result.message; throw new Error(result.message); }
				return { ...current, production: { ...result.production, updated_at: now } };
			}, eventType);
			return { ok: true, data: project };
		} catch (e) {
			return refusal ? invalid(refusal) : this.storeError(e);
		}
	}

	private storeError(e: unknown): CommandFailure {
		const message = e instanceof Error ? e.message : 'store failed';
		if (message.includes('Version conflict')) return conflict(message);
		if (message.includes('not found')) return notFound(message);
		return { ok: false, error: { code: 'STORE_ERROR', message, retryable: true, source: 'project-store' } };
	}

	private async ensureVoiceNodes(project: Project): Promise<void> {
		const layout = (await this.store.readCanvasLayout(project.project_id)) ?? {
			schema_version: 1 as const,
			project_id: project.project_id,
			nodes: [],
			viewport: { x: 0, y: 0, zoom: 1 },
			updated_at: new Date().toISOString()
		};
		const existing = new Set(layout.nodes.map((node) => node.node_id));
		const additions = project.voices
			.filter((voice) => !existing.has(voice.voice_id))
			.map((voice, index) => ({
				node_id: voice.voice_id,
				type: 'voice' as const,
				lane: 'voices' as const,
				x: 380,
				y: index * 200,
				width: 320,
				height: 280
			}));
		if (additions.length === 0) return;
		await this.store.writeCanvasLayout(project.project_id, {
			...layout,
			nodes: [...layout.nodes, ...additions]
		});
	}
}

export function applyReconcile(
	latest: Project,
	status: Awaited<ReturnType<RaycastBridge['getConceptCaptureStatus']>>,
	answers: Awaited<ReturnType<RaycastBridge['readConceptAnswers']>> | null
): { project: Project; changed: boolean } {
	if (!latest.creative_room) return { project: latest, changed: false };
	const captureDone =
		status.ready_for_projects ||
		status.capture_job_status === 'complete' ||
		status.pending_count === 0;
	const nextVoices = latest.voices.map((voice) => {
		const lane = status.models.find((model) => model.label === voice.label);
		const raycastAgent = lane?.raycast_agent ?? voice.raycast_agent;
		const answer = answers?.answers.findLast(
			(row) => matchAnswerToLabel(row.model_name, [{ ...voice, model_class: 'raycast_ai' }])?.label === voice.label
		);
		if (!answer) {
			if (lane?.status === 'failed' && voice.job_status !== 'failed') {
				return {
					...voice,
					raycast_agent: raycastAgent,
					job_status: 'failed' as const,
					parse_status: 'unknown' as const,
					error: lane.error ?? 'Creative Room provider request failed.'
				};
			}
			if (lane?.status === 'invalid' && voice.parse_status !== 'invalid') {
				return { ...voice, raycast_agent: raycastAgent, job_status: 'failed' as const, parse_status: 'invalid' as const, error: 'Bridge returned an invalid structured capture.' };
			}
			if (
				captureDone &&
				lane?.status === 'pending' &&
				(voice.job_status === 'queued' || voice.job_status === 'running')
			) {
				return {
					...voice,
					raycast_agent: raycastAgent,
					job_status: 'failed' as const,
					parse_status: 'unknown' as const,
					error: 'Bridge capture finished without a verbatim reply for this voice.'
				};
			}
			return raycastAgent === voice.raycast_agent ? voice : { ...voice, raycast_agent: raycastAgent };
		}
		if (voice.answer_id === answer.answer_id && voice.raw_text === answer.answer_text) {
			return raycastAgent === voice.raycast_agent ? voice : { ...voice, raycast_agent: raycastAgent };
		}
		const structured = answer.structured_prompt ?? {};
		const valid = answer.structure_status === 'valid';
		return {
			...voice,
			raycast_agent: raycastAgent,
			job_status: valid ? ('succeeded' as const) : ('failed' as const),
			parse_status: valid ? ('valid' as const) : ('invalid' as const),
			raw_text: answer.answer_text,
			parse_errors: answer.structure_errors,
			content_hash: answer.content_sha256,
			prompt_hash: answer.prompt_sha256 ?? voice.prompt_hash,
			answer_id: answer.answer_id,
			title: structuredString(structured.title),
			logline: structuredString(structured.logline),
			summary: structuredString(structured.summary),
			error: valid ? null : `Invalid structured capture: ${answer.structure_errors.join('; ') || 'structure validation failed'}`
		};
	});
	const pending = nextVoices.filter((voice) => voice.job_status === 'queued' || voice.job_status === 'running').length;
	const failed = nextVoices.filter((voice) => voice.job_status === 'failed').length;
	const roomStatus =
		pending === 0 && (captureDone || failed > 0)
			? failed > 0
				? ('failed' as const)
				: ('succeeded' as const)
			: ('running' as const);
	const message = `${status.captured_valid_count} valid · ${status.invalid_count} invalid · ${status.pending_count} pending`;
	const voicesChanged = nextVoices.some((voice, i) => voice !== latest.voices[i]);
	const roomChanged = latest.creative_room.status !== roomStatus || latest.creative_room.message !== message;
	if (!voicesChanged && !roomChanged) return { project: latest, changed: false };
	return {
		changed: true,
		project: {
			...latest,
			creative_room: {
				...latest.creative_room,
				status: roomStatus,
				updated_at: new Date().toISOString(),
				message
			},
			voices: nextVoices
		}
	};
}
