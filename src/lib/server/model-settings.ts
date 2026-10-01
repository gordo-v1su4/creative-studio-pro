import { z } from 'zod';
import {
	HYPER_BASE_URL,
	PROVIDER_LABELS,
	isKnownVisionModel,
	modelChoiceSchema,
	modelProviderKindSchema,
	modelTestKey,
	parseModelList,
	visionModelsOnly
} from '$lib/domain/model-provider';
import type { ModelChoice, ModelProviderKind, ModelSettingsView, ModelTestResult, ProviderModel, ProviderOption } from '$lib/domain/model-provider';
import { publicAppSettings } from '$lib/server/app-settings';
import type { AppSettingsStore } from '$lib/server/app-settings';
import { createOpenAICompatibleClient, fetchProviderModels, legacyEnvChoice, providerConnection, runModelTest } from '$lib/server/model-provider';
import type { AgentModelClient, FetchLike, ModelConnection, ProviderEnvironment, RaycastBridgeAccess } from '$lib/server/model-provider';

/**
 * Settings → Agent model (V1S-117): provider presets, live vision-only model
 * lists, pick-time model test, app default. Keys go in, never come out.
 */

export interface ModelSettingsDeps {
	settings: AppSettingsStore;
	env: ProviderEnvironment;
	raycast: RaycastBridgeAccess | null;
	fetch?: FetchLike;
	createClient?: (connection: ModelConnection) => AgentModelClient;
	/** Raycast bridge catalog labels, used when the bridge has no `/v1/models`. */
	raycastCatalog?: () => Promise<string[]>;
}

export type SettingsResult<T> = { ok: true; data: T } | { ok: false; status: number; error: { code: string; message: string } };

const fail = (status: number, code: string, message: string): SettingsResult<never> => ({ ok: false, status, error: { code, message } });

export async function getModelSettingsView(deps: ModelSettingsDeps): Promise<ModelSettingsView> {
	const settings = await deps.settings.read();
	const raycastConnected = deps.raycast ? await deps.raycast.isConnected() : false;
	const envFallback = legacyEnvChoice(deps.env);
	const providers: ProviderOption[] = [
		{ id: 'hyper', label: PROVIDER_LABELS.hyper, configured: Boolean(settings.hyper.api_key || deps.env.HYPER_API_KEY?.trim()), base_url: HYPER_BASE_URL },
		{ id: 'custom', label: PROVIDER_LABELS.custom, configured: Boolean(settings.custom.base_url && settings.custom.api_key), base_url: settings.custom.base_url }
	];
	// Only offered while connected: the operator's personal provider never confuses anyone else.
	if (raycastConnected) providers.push({ id: 'raycast', label: PROVIDER_LABELS.raycast, configured: true, base_url: null });
	return {
		settings: publicAppSettings(settings),
		providers,
		raycast_connected: raycastConnected,
		env_fallback: envFallback,
		effective_default: settings.default_model ?? envFallback
	};
}

async function connectionFor(deps: ModelSettingsDeps, provider: ModelProviderKind) {
	return providerConnection(provider, { settings: await deps.settings.read(), env: deps.env, raycast: deps.raycast });
}

/** Live model list for a provider, vision-capable models only. */
export async function listVisionModels(deps: ModelSettingsDeps, provider: ModelProviderKind): Promise<SettingsResult<{ provider: ModelProviderKind; models: ProviderModel[]; hidden_non_vision: number }>> {
	if (provider === 'kimi') return fail(400, 'INVALID_COMMAND', 'The KIMI_* environment model is configured by env, not picked here');
	const connection = await connectionFor(deps, provider);
	if (!connection.ok) return fail(connection.code === 'NOT_CONFIGURED' ? 503 : 409, connection.code, connection.message);
	let all: ProviderModel[];
	try {
		all = await fetchProviderModels(connection.baseURL, connection.apiKey, deps.fetch);
	} catch (cause) {
		if (provider !== 'raycast' || !deps.raycastCatalog) return fail(502, 'PROVIDER_ERROR', cause instanceof Error ? cause.message : 'Model list failed');
		try { all = parseModelList((await deps.raycastCatalog()).map((id) => ({ id }))); }
		catch (fallback) { return fail(502, 'PROVIDER_ERROR', fallback instanceof Error ? fallback.message : 'Raycast bridge catalog failed'); }
	}
	const models = visionModelsOnly(all);
	return { ok: true, data: { provider, models, hidden_non_vision: all.length - models.length } };
}

function choiceFor(provider: ModelProviderKind, model: string, baseURL: string): ModelChoice {
	return { provider, model, base_url: provider === 'raycast' ? null : baseURL };
}

export const modelTestRequestSchema = z.object({ provider: modelProviderKindSchema, model: z.string().trim().min(1).max(200) });

/** Pick-time test: small image, structured answer, rule following. Result is remembered. */
export async function testModel(deps: ModelSettingsDeps, raw: unknown): Promise<SettingsResult<{ choice: ModelChoice; result: ModelTestResult }>> {
	const parsed = modelTestRequestSchema.safeParse(raw);
	if (!parsed.success) return fail(400, 'INVALID_COMMAND', parsed.error.issues[0]?.message ?? 'Invalid model test request');
	const connection = await connectionFor(deps, parsed.data.provider);
	if (!connection.ok) return fail(connection.code === 'NOT_CONFIGURED' ? 503 : 409, connection.code, connection.message);
	const choice = choiceFor(parsed.data.provider, parsed.data.model, connection.baseURL);
	const client = (deps.createClient ?? createOpenAICompatibleClient)({ choice, baseURL: connection.baseURL, apiKey: connection.apiKey });
	let result: ModelTestResult;
	try { result = await runModelTest(client); }
	catch (cause) { return fail(502, 'PROVIDER_ERROR', `Model test could not reach ${parsed.data.model}: ${cause instanceof Error ? cause.message : 'request failed'}`); }
	await deps.settings.update((current) => ({ ...current, model_tests: { ...current.model_tests, [modelTestKey(choice)]: result } }));
	return { ok: true, data: { choice, result } };
}

const keyInput = z.string().trim().max(4000).nullable().optional();

export const saveModelSettingsSchema = z.object({
	/** undefined = keep, null or '' = clear. Keys are write-only. */
	hyper_api_key: keyInput,
	custom_base_url: z.string().trim().max(500).regex(/^(https?:\/\/\S+)?$/, 'Base URL must start with http:// or https://').nullable().optional(),
	custom_api_key: keyInput,
	default_model: z.object({ provider: modelProviderKindSchema, model: z.string().trim().min(1).max(200) }).nullable().optional()
});

const blankToNull = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);

/** Vision gate for a new default: allowlist, provider metadata, or a passed image test. */
async function confirmVision(deps: ModelSettingsDeps, choice: ModelChoice): Promise<boolean> {
	if (isKnownVisionModel(choice.model)) return true;
	const settings = await deps.settings.read();
	if (settings.model_tests[modelTestKey(choice)]?.checks.image) return true;
	const listed = await listVisionModels(deps, choice.provider);
	return listed.ok && listed.data.models.some((model) => model.id === choice.model);
}

export async function saveModelSettings(deps: ModelSettingsDeps, raw: unknown): Promise<SettingsResult<ModelSettingsView>> {
	const parsed = saveModelSettingsSchema.safeParse(raw);
	if (!parsed.success) return fail(400, 'INVALID_COMMAND', parsed.error.issues[0]?.message ?? 'Invalid model settings');
	const input = parsed.data;
	await deps.settings.update((current) => ({
		...current,
		hyper: input.hyper_api_key === undefined ? current.hyper : { api_key: blankToNull(input.hyper_api_key) },
		custom: {
			base_url: input.custom_base_url === undefined ? current.custom.base_url : blankToNull(input.custom_base_url),
			api_key: input.custom_api_key === undefined ? current.custom.api_key : blankToNull(input.custom_api_key)
		}
	}));
	if (input.default_model !== undefined) {
		if (input.default_model === null) {
			await deps.settings.update((current) => ({ ...current, default_model: null }));
		} else {
			const prepared = await prepareVisionChoice(deps, input.default_model.provider, input.default_model.model);
			if (!prepared.ok) return prepared;
			await deps.settings.update((current) => ({ ...current, default_model: prepared.data }));
		}
	}
	return { ok: true, data: await getModelSettingsView(deps) };
}

/** A pickable choice: provider reachable/configured and the model vision-capable. */
export async function prepareVisionChoice(deps: ModelSettingsDeps, provider: ModelProviderKind, model: string): Promise<SettingsResult<ModelChoice>> {
	if (provider === 'kimi') return fail(400, 'INVALID_COMMAND', 'The KIMI_* environment model is the fallback; it is not picked here');
	const connection = await connectionFor(deps, provider);
	if (!connection.ok) return fail(connection.code === 'NOT_CONFIGURED' ? 503 : 409, connection.code, connection.message);
	const choice = modelChoiceSchema.parse(choiceFor(provider, model, connection.baseURL));
	if (!(await confirmVision(deps, choice))) {
		return fail(400, 'NOT_VISION_CAPABLE', `${model} is not known to read images. Only vision-capable models can run the Agent; run the model test to prove it can.`);
	}
	return { ok: true, data: choice };
}
