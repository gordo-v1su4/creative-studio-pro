import { z } from 'zod';

/**
 * Model provider (CONTEXT.md): where the Agent's language model runs. Pure
 * domain rules only — no network, no keys. Keys live in app settings
 * (server-side), never in a project or its ledger.
 */

export const HYPER_BASE_URL = 'https://hyper.charm.land/v1';
export const LEGACY_KIMI_BASE_URL = 'https://api.kimi.com/coding/v1';
export const LEGACY_KIMI_MODEL = 'k3';

/** `kimi` is the legacy env-configured provider (KIMI_API_KEY/BASE/MODEL). */
export const MODEL_PROVIDER_KINDS = ['hyper', 'custom', 'raycast', 'kimi'] as const;
export const modelProviderKindSchema = z.enum(MODEL_PROVIDER_KINDS);
export type ModelProviderKind = z.infer<typeof modelProviderKindSchema>;

export const PROVIDER_LABELS: Record<ModelProviderKind, string> = {
	hyper: 'Hyper',
	custom: 'Custom endpoint',
	raycast: 'Raycast bridge',
	kimi: 'Environment (KIMI_*)'
};

const httpUrl = z.string().trim().max(500).regex(/^https?:\/\/\S+$/, 'Base URL must start with http:// or https://');

/** A provider + model pick. Non-secret: safe to persist in a project. */
export const modelChoiceSchema = z.object({
	provider: modelProviderKindSchema,
	model: z.string().trim().min(1).max(200),
	/** Endpoint the model was reached at; pins custom endpoints. */
	base_url: httpUrl.nullable().default(null)
});
export type ModelChoice = z.infer<typeof modelChoiceSchema>;

export const modelHistoryEntrySchema = z.object({
	event: z.enum(['override_set', 'locked', 'switched']),
	from: modelChoiceSchema.nullable(),
	to: modelChoiceSchema.nullable(),
	reason: z.string().max(1000).nullable(),
	operator: z.string().min(1),
	timestamp: z.string()
});
export type ModelHistoryEntry = z.infer<typeof modelHistoryEntrySchema>;

/**
 * Per-project override. `override: null` follows the app default until the
 * project first runs the Agent; then `locked_at` is set and `override` holds
 * the model that ran. After that only an explicit switch changes it.
 */
export const projectAgentModelSchema = z.object({
	override: modelChoiceSchema.nullable().default(null),
	locked_at: z.string().nullable().default(null),
	history: z.array(modelHistoryEntrySchema).max(500).default([])
});
export type ProjectAgentModel = z.infer<typeof projectAgentModelSchema>;

export const emptyProjectAgentModel = (): ProjectAgentModel => ({ override: null, locked_at: null, history: [] });

export function sameModelChoice(a: ModelChoice | null, b: ModelChoice | null): boolean {
	if (!a || !b) return a === b;
	return a.provider === b.provider && a.model === b.model && (a.base_url ?? null) === (b.base_url ?? null);
}

/** A pin without an endpoint (base_url null) matches that model on any endpoint. */
export function matchesPinnedChoice(pinned: ModelChoice, actual: ModelChoice): boolean {
	return pinned.provider === actual.provider && pinned.model === actual.model
		&& (pinned.base_url === null || pinned.base_url === actual.base_url);
}

export function describeModelChoice(choice: ModelChoice | null): string {
	return choice ? `${PROVIDER_LABELS[choice.provider]} · ${choice.model}` : 'app default';
}

/** Explicit project model change: free before the lock, confirmed + reasoned after. */
export function applyProjectModelChoice(
	state: ProjectAgentModel,
	input: { choice: ModelChoice | null; operator: string; reason: string | null; confirm_switch: boolean; now: string }
): { state: ProjectAgentModel; event: 'override_set' | 'switched' } {
	if (sameModelChoice(state.override, input.choice)) throw new Error(`The project already uses ${describeModelChoice(input.choice)}`);
	if (!state.locked_at) {
		return {
			event: 'override_set',
			state: {
				...state,
				override: input.choice,
				history: [...state.history, { event: 'override_set', from: state.override, to: input.choice, reason: input.reason, operator: input.operator, timestamp: input.now }]
			}
		};
	}
	if (!input.choice) throw new Error('The project model is locked; pick a specific model to switch to');
	if (!input.confirm_switch) throw new Error('The project model is locked; switching must be confirmed explicitly');
	if (!input.reason || input.reason.trim().length < 3) throw new Error('The project model is locked; give a reason for the switch');
	return {
		event: 'switched',
		state: {
			...state,
			override: input.choice,
			history: [...state.history, { event: 'switched', from: state.override, to: input.choice, reason: input.reason.trim(), operator: input.operator, timestamp: input.now }]
		}
	};
}

/** First Agent run pins the model that ran. Already locked: no change. */
export function applyProjectModelLock(
	state: ProjectAgentModel,
	input: { choice: ModelChoice; operator: string; now: string }
): { state: ProjectAgentModel; changed: boolean } {
	if (state.locked_at) {
		if (!state.override || !matchesPinnedChoice(state.override, input.choice)) {
			throw new Error(`The project model is locked to ${describeModelChoice(state.override)}; switch explicitly before running ${describeModelChoice(input.choice)}`);
		}
		return { state, changed: false };
	}
	if (state.override && !matchesPinnedChoice(state.override, input.choice)) {
		throw new Error(`The project override is ${describeModelChoice(state.override)}, not ${describeModelChoice(input.choice)}`);
	}
	return {
		changed: true,
		state: {
			override: input.choice,
			locked_at: input.now,
			history: [...state.history, { event: 'locked', from: null, to: input.choice, reason: null, operator: input.operator, timestamp: input.now }]
		}
	};
}

// ---------------------------------------------------------------------------
// Vision capability: models-endpoint metadata first, allowlist second.
// ---------------------------------------------------------------------------

export const DEFAULT_AGENT_MODEL = 'deepseek-v4.1-flash';

/** Small known-vision allowlist, used only when the endpoint gives no metadata. */
export const KNOWN_VISION_MODELS: { pattern: RegExp; label: string }[] = [
	{ pattern: /deepseek[-_.\s/]?v4\.1[-_.\s]?flash/i, label: 'DeepSeek V4.1 Flash' },
	{ pattern: /glm[-_.\s/]?5\.3[-_.\s]?flash/i, label: 'GLM 5.3 Flash' }
];

export type VisionSource = 'metadata' | 'allowlist';

export interface ProviderModel {
	id: string;
	label: string;
	vision: boolean;
	vision_source: VisionSource;
}

const IMAGE_WORDS = new Set(['image', 'images', 'vision', 'image_input', 'image-input']);

function listMentionsImage(value: unknown): boolean | null {
	if (!Array.isArray(value)) return null;
	return value.some((item) => typeof item === 'string' && IMAGE_WORDS.has(item.toLowerCase()));
}

/** Reads the common metadata shapes; null when the entry says nothing about input modalities. */
export function visionFromMetadata(entry: Record<string, unknown>): boolean | null {
	for (const key of ['supports_vision', 'vision', 'supports_images', 'image_input']) {
		if (typeof entry[key] === 'boolean') return entry[key] as boolean;
	}
	const capabilities = entry.capabilities;
	if (capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)) {
		const record = capabilities as Record<string, unknown>;
		for (const key of ['vision', 'image_input', 'supports_vision', 'images']) {
			if (typeof record[key] === 'boolean') return record[key] as boolean;
		}
		const nested = listMentionsImage(record.input_modalities ?? record.input);
		if (nested !== null) return nested;
	}
	const fromList = listMentionsImage(capabilities);
	if (fromList) return true;
	const direct = listMentionsImage(entry.input_modalities);
	if (direct !== null) return direct;
	const modalities = entry.modalities;
	const flat = listMentionsImage(modalities);
	if (flat !== null) return flat;
	if (modalities && typeof modalities === 'object') {
		const input = listMentionsImage((modalities as Record<string, unknown>).input);
		if (input !== null) return input;
	}
	const architecture = entry.architecture;
	if (architecture && typeof architecture === 'object') {
		const record = architecture as Record<string, unknown>;
		const input = listMentionsImage(record.input_modalities);
		if (input !== null) return input;
		if (typeof record.modality === 'string') return /image/i.test(record.modality.split('->')[0] ?? '');
	}
	return null;
}

export function isKnownVisionModel(id: string): boolean {
	return KNOWN_VISION_MODELS.some((known) => known.pattern.test(id));
}

/** Parses an OpenAI-compatible `/models` body (`{data:[...]}`, `{models:[...]}` or a bare array). */
export function parseModelList(body: unknown): ProviderModel[] {
	const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
	const rows = Array.isArray(body) ? body : Array.isArray(record?.data) ? record.data : Array.isArray(record?.models) ? record.models : null;
	if (!rows) throw new Error('Models endpoint returned no model list');
	const models: ProviderModel[] = [];
	const seen = new Set<string>();
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue;
		const entry = row as Record<string, unknown>;
		const id = typeof entry.id === 'string' ? entry.id.trim() : '';
		if (!id || seen.has(id)) continue;
		seen.add(id);
		const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id;
		const metadata = visionFromMetadata(entry);
		models.push({
			id,
			label: name,
			vision: metadata ?? (isKnownVisionModel(id) || isKnownVisionModel(name)),
			vision_source: metadata === null ? 'allowlist' : 'metadata'
		});
	}
	return models;
}

/** Vision-capable models only, default first (DeepSeek V4.1 Flash, then GLM 5.3 Flash). */
export function visionModelsOnly(models: ProviderModel[]): ProviderModel[] {
	const rank = (model: ProviderModel) => {
		const index = KNOWN_VISION_MODELS.findIndex((known) => known.pattern.test(model.id));
		return index < 0 ? KNOWN_VISION_MODELS.length : index;
	};
	return models.filter((model) => model.vision).sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// Model test (pick-time check): image input, structured answer, rule following.
// ---------------------------------------------------------------------------

export const modelTestResultSchema = z.object({
	passed: z.boolean(),
	checks: z.object({ image: z.boolean(), structured: z.boolean(), rules: z.boolean() }),
	detail: z.string().max(2000),
	tested_at: z.string(),
	latency_ms: z.number().int().nonnegative()
});
export type ModelTestResult = z.infer<typeof modelTestResultSchema>;

export const MODEL_TEST_ECHO = 'narrate-check';
export const MODEL_TEST_SYSTEM = 'You are a model check. Follow every rule exactly. Return only one JSON object with no markdown and no commentary.';
export const MODEL_TEST_PROMPT = `Look at the attached image. Return exactly {"color": "<the single dominant color, one lowercase English word>", "word_count": 3, "echo": "${MODEL_TEST_ECHO}"}. Rules: color is one lowercase word; word_count is the number 3; echo is exactly "${MODEL_TEST_ECHO}"; no other keys.`;
/** 64x64 solid red PNG. */
export const MODEL_TEST_IMAGE_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAg0lEQVR4nO3RQQkAMAwEwYiIf2UVUxF9DIWFE5DMztn9esMv6AFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWAFNWIH1ii+7qsVA8Q8GuokAAAAASUVORK5CYII=';

const RED_WORDS = new Set(['red', 'crimson', 'scarlet']);

/** Grades a test answer. `parsed` is the extracted JSON, or null if none could be extracted. */
export function gradeModelTest(parsed: unknown, latencyMs: number, now: string): ModelTestResult {
	const structured = !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
		&& Object.keys(parsed).sort().join(',') === 'color,echo,word_count';
	const record = structured ? (parsed as Record<string, unknown>) : {};
	const color = typeof record.color === 'string' ? record.color : '';
	const rules = structured && /^[a-z]+$/.test(color) && record.word_count === 3 && record.echo === MODEL_TEST_ECHO;
	const image = RED_WORDS.has(color.trim().toLowerCase());
	const failures = [
		!structured && 'answer was not the exact JSON shape',
		structured && !rules && 'answer broke a rule',
		!image && `could not read the image (said "${color || 'nothing'}", expected red)`
	].filter(Boolean);
	return {
		passed: structured && rules && image,
		checks: { image, structured, rules },
		detail: failures.length ? `Failed: ${failures.join('; ')}` : 'Passed: read the image, answered in shape, followed the rules',
		tested_at: now,
		latency_ms: Math.max(0, Math.round(latencyMs))
	};
}

// ---------------------------------------------------------------------------
// Browser-safe views (no keys, ever).
// ---------------------------------------------------------------------------

export type ModelSource = 'project' | 'app-default' | 'env';

export interface PublicAppSettings {
	hyper: { has_key: boolean };
	custom: { base_url: string | null; has_key: boolean };
	default_model: ModelChoice | null;
	model_tests: Record<string, ModelTestResult>;
}

export interface ProviderOption {
	id: ModelProviderKind;
	label: string;
	configured: boolean;
	base_url: string | null;
}

export interface ModelSettingsView {
	settings: PublicAppSettings;
	providers: ProviderOption[];
	raycast_connected: boolean;
	env_fallback: ModelChoice | null;
	effective_default: ModelChoice | null;
}

export interface ProjectModelView {
	override: ModelChoice | null;
	locked_at: string | null;
	history: ModelHistoryEntry[];
	effective: ModelChoice | null;
	source: ModelSource | null;
	available: boolean;
	message: string | null;
}

export function modelTestKey(choice: Pick<ModelChoice, 'provider' | 'model'> & { base_url?: string | null }): string {
	return `${choice.provider}|${choice.base_url ?? ''}|${choice.model}`;
}
