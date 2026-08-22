import { z } from 'zod';
import { catalogModelSchema } from '$lib/domain/schemas';
import type { CatalogModel } from '$lib/domain/schemas';

/**
 * M3 Raycast bridge adapter (FR-005, FR-009, AR-06, NFR-005): the only path
 * for catalog harvest, prompt dispatch, and verbatim capture. Calls stay
 * server-side. No silent fallback to another machine or provider.
 */

export class M3BridgeError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly retryable: boolean
	) {
		super(message);
		this.name = 'M3BridgeError';
	}
}

export interface M3BridgeConfig {
	baseUrl: string;
	token: string;
}

const catalogOutputSchema = z.object({
	bridge_version: z.string(),
	harvested_at: z.string(),
	catalog_hash: z.string().length(64),
	models: z.array(catalogModelSchema),
	source: z.enum(['agents_file', 'built_in_defaults'])
});

export type BridgeCatalog = z.infer<typeof catalogOutputSchema>;

const createRunOutputSchema = z.object({
	run_id: z.string().min(1),
	title: z.string(),
	capture_mode: z.enum(['manual', 'automated']),
	run_status: z.string(),
	models_requested: z.array(z.string()),
	next_step: z.string()
});

const prepareCaptureOutputSchema = z.object({
	run_id: z.string().min(1),
	title: z.string(),
	active_capture_path: z.string(),
	prompt_file: z.string(),
	prompt_copied_to_clipboard: z.boolean(),
	capture_commands: z.object({
		chatgpt: z.string(),
		claude: z.string()
	}),
	message: z.string()
});

export type BridgePrepareCapture = z.infer<typeof prepareCaptureOutputSchema>;

const runCaptureOutputSchema = z.object({
	run_id: z.string().min(1),
	started: z.boolean(),
	workflow: z.literal('computer_use'),
	log_file: z.string().optional(),
	message: z.string()
});

const captureStatusOutputSchema = z.object({
	run_id: z.string().min(1),
	run_status: z.string(),
	capture_job_status: z.enum(['idle', 'running', 'complete']).optional(),
	models: z.array(
		z.object({
			label: z.string(),
			raycast_agent: z.string(),
			status: z.enum(['pending', 'captured', 'invalid']),
			answer_id: z.string().optional()
		})
	),
	answers_count: z.number().int().nonnegative(),
	captured_valid_count: z.number().int().nonnegative(),
	invalid_count: z.number().int().nonnegative(),
	pending_count: z.number().int().nonnegative(),
	ready_for_projects: z.boolean()
});

const conceptAnswerSchema = z.looseObject({
	answer_id: z.string(),
	run_id: z.string(),
	model_name: z.string(),
	answer_text: z.string(),
	structure_status: z.string(),
	structure_errors: z.array(z.string()),
	created_at: z.string(),
	content_sha256: z.string(),
	prompt_sha256: z.string().nullable(),
	structured_prompt: z.record(z.string(), z.unknown()).nullable()
});

const readAnswersOutputSchema = z.object({
	run_id: z.string().min(1),
	answers: z.array(conceptAnswerSchema),
	answers_count: z.number().int().nonnegative()
});

export type BridgeCaptureStatus = z.infer<typeof captureStatusOutputSchema>;
export type BridgeConceptAnswer = z.infer<typeof conceptAnswerSchema>;

const TIMEOUTS = {
	catalog: 10_000,
	submit: 60_000,
	poll: 30_000
} as const;

export class M3Bridge {
	constructor(private readonly config: M3BridgeConfig) {}

	async getModelCatalog(): Promise<BridgeCatalog> {
		return this.call('get_model_catalog', {}, catalogOutputSchema, TIMEOUTS.catalog);
	}

	async createComparisonRun(input: {
		title: string;
		question: string;
		models_requested: string[];
	}): Promise<z.infer<typeof createRunOutputSchema>> {
		return this.call(
			'create_comparison_run',
			{
				title: input.title,
				question: input.question,
				capture_mode: 'automated',
				models_requested: input.models_requested,
				target_models: ['sora-2']
			},
			createRunOutputSchema,
			TIMEOUTS.submit
		);
	}

	async prepareConceptCapture(runId: string): Promise<BridgePrepareCapture> {
		return this.call(
			'prepare_concept_capture',
			{ run_id: runId },
			prepareCaptureOutputSchema,
			TIMEOUTS.submit
		);
	}

	async runConceptCapture(runId: string, prepareFirst = false): Promise<z.infer<typeof runCaptureOutputSchema>> {
		return this.call(
			'run_concept_capture',
			{ run_id: runId, prepare_first: prepareFirst },
			runCaptureOutputSchema,
			TIMEOUTS.submit
		);
	}

	async getConceptCaptureStatus(runId: string): Promise<BridgeCaptureStatus> {
		return this.call(
			'get_concept_capture_status',
			{ run_id: runId },
			captureStatusOutputSchema,
			TIMEOUTS.poll
		);
	}

	async readConceptAnswers(runId: string): Promise<z.infer<typeof readAnswersOutputSchema>> {
		return this.call(
			'read_concept_answers',
			{ run_id: runId },
			readAnswersOutputSchema,
			TIMEOUTS.poll
		);
	}

	private async call<T>(
		tool: string,
		body: unknown,
		schema: z.ZodType<T>,
		timeoutMs: number
	): Promise<T> {
		const url = `${this.config.baseUrl.replace(/\/$/, '')}/tools/${tool}`;
		let response: Response;
		try {
			response = await fetch(url, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${this.config.token}`,
					'content-type': 'application/json',
					'x-caller': 'creative-studio-pro'
				},
				body: JSON.stringify(body ?? {}),
				signal: AbortSignal.timeout(timeoutMs)
			});
		} catch (e) {
			const timeout = e instanceof Error && e.name === 'TimeoutError';
			throw new M3BridgeError(
				timeout ? 'TIMEOUT' : 'OFFLINE',
				timeout
					? `M3 bridge did not respond to ${tool} within ${timeoutMs / 1000}s`
					: e instanceof Error
						? e.message
						: 'M3 bridge connection failed',
				true
			);
		}

		const json: unknown = await response.json().catch(() => null);
		if (!response.ok) {
			const message =
				json && typeof json === 'object' && json !== null && 'error' in json
					? String((json as { error?: { message?: string } }).error?.message ?? response.status)
					: `HTTP ${response.status} from ${tool}`;
			throw new M3BridgeError(
				response.status === 401 || response.status === 403 ? 'UNAUTHORIZED' : 'BRIDGE_ERROR',
				message,
				response.status >= 500
			);
		}

		const envelope = z.object({ ok: z.literal(true), result: schema }).safeParse(json);
		if (!envelope.success) {
			throw new M3BridgeError(
				'INVALID_RESPONSE',
				`M3 bridge ${tool} returned a payload that does not match the contract`,
				false
			);
		}
		return envelope.data.result;
	}
}

export function matchAnswerToLabel(modelName: string, slots: CatalogModel[]): CatalogModel | undefined {
	const exact = slots.find((slot) => slot.label === modelName);
	if (exact) return exact;
	const lower = modelName.toLowerCase();
	return slots.find(
		(slot) =>
			lower.includes(slot.label.toLowerCase()) || slot.label.toLowerCase().includes(lower)
	);
}
