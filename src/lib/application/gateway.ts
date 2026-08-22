import { createHash } from 'node:crypto';
import type { ProjectStore } from '$lib/adapters/project-store';
import { M3Bridge, M3BridgeError, matchAnswerToLabel } from '$lib/adapters/m3-bridge';
import {
	createProjectCommandSchema,
	updateSeedCommandSchema,
	saveCanvasLayoutCommandSchema,
	forceAdvanceStageCommandSchema,
	harvestCatalogCommandSchema,
	reshuffleRosterCommandSchema,
	startCreativeRoomCommandSchema,
	reconcileCreativeRoomCommandSchema
} from '$lib/domain/schemas';
import { applyForceAdvance } from '$lib/domain/gates';
import { uuid7ish, randomSeedHex } from '$lib/domain/ids';
import { DEFAULT_ROSTER_COUNT, selectRoster } from '$lib/domain/roster';
import type { Project, ProjectSummary, CanvasLayout, Voice } from '$lib/domain/schemas';

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
	if (e instanceof M3BridgeError) {
		return { ok: false, error: { code: e.code, message: e.message, retryable: e.retryable, source: 'm3-bridge' } };
	}
	return {
		ok: false,
		error: {
			code: 'BRIDGE_ERROR',
			message: e instanceof Error ? e.message : 'M3 bridge call failed',
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
		private readonly bridge: M3Bridge | null = null
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
			case 'harvest_catalog':
				return this.harvestCatalog(raw);
			case 'reshuffle_roster':
				return this.reshuffleRoster(raw);
			case 'start_creative_room':
				return this.startCreativeRoom(raw);
			case 'reconcile_creative_room':
				return this.reconcileCreativeRoom(raw);
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
			if (message.includes('no later stage')) return invalid(message);
			return { ok: false, error: { code: 'STORE_ERROR', message, retryable: true, source: 'project-store' } };
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
			return unavailable('CSP_M3_BRIDGE_URL or CSP_M3_BRIDGE_TOKEN is not configured');
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
			return unavailable('CSP_M3_BRIDGE_URL or CSP_M3_BRIDGE_TOKEN is not configured');
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
			// Official automated next_step from raycast-pro-bridge concept-run:
			// prepare_concept_capture, then Capture Active Run — ChatGPT/Claude.
			// Do not call run_concept_capture here — that driver types into Raycast
			// root search instead of opening the named agents.
			const prepared = await this.bridge.prepareConceptCapture(created.run_id);
			captureMessage = `Prepared ${created.run_id} · open Sora 2 - ChatGPT, paste, then ${prepared.capture_commands.chatgpt} · repeat with Sora 2 - Haiku + ${prepared.capture_commands.claude}`;
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
			return unavailable('CSP_M3_BRIDGE_URL or CSP_M3_BRIDGE_TOKEN is not configured');
		}
		const current = await this.store.readProject(parsed.data.project_id);
		if (!current) return notFound(`Project ${parsed.data.project_id} not found`);
		if (!current.creative_room) return invalid('No Creative Room run to reconcile');

		let status;
		let answers: Awaited<ReturnType<M3Bridge['readConceptAnswers']>> | null = null;
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

function applyReconcile(
	latest: Project,
	status: Awaited<ReturnType<M3Bridge['getConceptCaptureStatus']>>,
	answers: Awaited<ReturnType<M3Bridge['readConceptAnswers']>> | null
): { project: Project; changed: boolean } {
	if (!latest.creative_room) return { project: latest, changed: false };
	const captureDone =
		status.ready_for_projects ||
		status.capture_job_status === 'complete' ||
		status.pending_count === 0;
	const nextVoices = latest.voices.map((voice) => {
		const answer = answers?.answers.find(
			(row) => matchAnswerToLabel(row.model_name, [{ ...voice, model_class: 'raycast_ai' }])?.label === voice.label
		);
		if (!answer) {
			const lane = status.models.find((model) => model.label === voice.label);
			if (lane?.status === 'invalid' && voice.parse_status !== 'invalid') {
				return { ...voice, job_status: 'succeeded' as const, parse_status: 'invalid' as const };
			}
			if (
				captureDone &&
				lane?.status === 'pending' &&
				(voice.job_status === 'queued' || voice.job_status === 'running')
			) {
				return {
					...voice,
					job_status: 'failed' as const,
					parse_status: 'unknown' as const,
					error: 'Bridge capture finished without a verbatim reply for this voice.'
				};
			}
			return voice;
		}
		if (voice.answer_id === answer.answer_id && voice.raw_text === answer.answer_text) return voice;
		const structured = answer.structured_prompt ?? {};
		const valid = answer.structure_status === 'valid';
		return {
			...voice,
			job_status: 'succeeded' as const,
			parse_status: valid ? ('valid' as const) : ('invalid' as const),
			raw_text: answer.answer_text,
			parse_errors: answer.structure_errors,
			content_hash: answer.content_sha256,
			prompt_hash: answer.prompt_sha256 ?? voice.prompt_hash,
			answer_id: answer.answer_id,
			title: structuredString(structured.title),
			logline: structuredString(structured.logline),
			summary: structuredString(structured.summary),
			error: null
		};
	});
	const pending = nextVoices.filter((voice) => voice.job_status === 'queued' || voice.job_status === 'running').length;
	const failed = nextVoices.filter((voice) => voice.job_status === 'failed').length;
	const roomStatus =
		pending === 0 && (captureDone || failed === nextVoices.length)
			? failed === nextVoices.length
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
