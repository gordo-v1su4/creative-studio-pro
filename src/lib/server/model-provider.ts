import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
	HYPER_BASE_URL,
	LEGACY_KIMI_BASE_URL,
	LEGACY_KIMI_MODEL,
	MODEL_TEST_IMAGE_PNG_BASE64,
	MODEL_TEST_PROMPT,
	MODEL_TEST_SYSTEM,
	PROVIDER_LABELS,
	gradeModelTest,
	parseModelList
} from '$lib/domain/model-provider';
import type { ModelChoice, ModelProviderKind, ModelSource, ModelTestResult, ProviderModel } from '$lib/domain/model-provider';
import type { Project } from '$lib/domain/schemas';
import type { AppSettings } from '$lib/server/app-settings';

/**
 * Model provider runtime (V1S-117): one OpenAI-compatible client shape for
 * Hyper, a custom endpoint, the Raycast bridge and the legacy KIMI_* env.
 * A rule-breaking answer is retried once with the error, then the Agent
 * stops. Nothing here ever falls back to another model.
 */

export type ModelImage = { data: Uint8Array; mediaType: string };

export interface AgentModelClient {
	readonly choice: ModelChoice;
	generate(input: { system: string; prompt: string; images?: ModelImage[]; maxOutputTokens?: number; timeoutMs?: number }): Promise<string>;
}

export interface ModelConnection {
	choice: ModelChoice;
	baseURL: string;
	apiKey: string;
}

export function createOpenAICompatibleClient(connection: ModelConnection): AgentModelClient {
	const provider = createOpenAICompatible({ name: connection.choice.provider, apiKey: connection.apiKey, baseURL: connection.baseURL });
	return {
		choice: connection.choice,
		async generate({ system, prompt, images = [], maxOutputTokens = 1800, timeoutMs = 60_000 }) {
			const common = { model: provider(connection.choice.model), system, maxOutputTokens, abortSignal: AbortSignal.timeout(timeoutMs) };
			const result = images.length === 0
				? await generateText({ ...common, prompt })
				: await generateText({
					...common,
					messages: [{
						role: 'user',
						content: [
							{ type: 'text', text: prompt },
							...images.map((image) => ({ type: 'file' as const, mediaType: image.mediaType, data: image.data }))
						]
					}]
				});
			return result.text;
		}
	};
}

export function extractJsonObject(text: string): unknown {
	const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
	const start = trimmed.indexOf('{');
	const end = trimmed.lastIndexOf('}');
	if (start < 0 || end < start) throw new Error('Model returned no JSON object');
	return JSON.parse(trimmed.slice(start, end + 1));
}

/** The Agent stopped after a rule-breaking answer and one retry. */
export class AgentRuleBreakError extends Error {
	constructor(public readonly choice: ModelChoice, public readonly issue: string) {
		super(`The Agent stopped: ${PROVIDER_LABELS[choice.provider]} · ${choice.model} broke the answer rules twice (${issue}). No other model was tried — retry, or switch the project model explicitly.`);
		this.name = 'AgentRuleBreakError';
	}
}

function issueText(cause: unknown): string {
	if (cause && typeof cause === 'object' && 'issues' in cause && Array.isArray((cause as { issues: unknown[] }).issues)) {
		return (cause as { issues: { path?: PropertyKey[]; message?: string }[] }).issues
			.slice(0, 5)
			.map((issue) => `${issue.path?.length ? issue.path.join('.') + ': ' : ''}${issue.message ?? 'invalid'}`)
			.join('; ');
	}
	return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Structured call: parse → on a schema/JSON failure, retry once with the
 * error → on a second failure throw AgentRuleBreakError. Transport errors
 * propagate untouched (they are not rule breaks).
 */
export async function generateStructured<T>(
	client: AgentModelClient,
	input: { system: string; prompt: string; images?: ModelImage[]; maxOutputTokens?: number; timeoutMs?: number },
	parse: (value: unknown) => T
): Promise<T> {
	const attempt = async (prompt: string): Promise<{ ok: true; value: T } | { ok: false; issue: string }> => {
		const raw = await client.generate({ ...input, prompt });
		try { return { ok: true, value: parse(extractJsonObject(raw)) }; }
		catch (cause) { return { ok: false, issue: issueText(cause) }; }
	};
	const first = await attempt(input.prompt);
	if (first.ok) return first.value;
	const second = await attempt(`${input.prompt}\n\nYOUR PREVIOUS ANSWER BROKE THE RULES: ${first.issue}\nReturn only the corrected JSON object that satisfies every rule.`);
	if (second.ok) return second.value;
	throw new AgentRuleBreakError(client.choice, second.issue);
}

/** Pick-time model test: a small image, a structured answer, rule following. */
export async function runModelTest(client: AgentModelClient, now: () => number = Date.now): Promise<ModelTestResult> {
	const started = now();
	const raw = await client.generate({
		system: MODEL_TEST_SYSTEM,
		prompt: MODEL_TEST_PROMPT,
		images: [{ data: Uint8Array.from(Buffer.from(MODEL_TEST_IMAGE_PNG_BASE64, 'base64')), mediaType: 'image/png' }],
		maxOutputTokens: 200,
		timeoutMs: 45_000
	});
	let parsed: unknown = null;
	try { parsed = extractJsonObject(raw); } catch { parsed = null; }
	return gradeModelTest(parsed, now() - started, new Date().toISOString());
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Live `/models` listing with vision flags (metadata first, allowlist second). */
export async function fetchProviderModels(baseURL: string, apiKey: string, fetchImpl: FetchLike = fetch): Promise<ProviderModel[]> {
	const url = `${baseURL.replace(/\/$/, '')}/models`;
	let response: Response;
	try {
		response = await fetchImpl(url, { headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
	} catch (cause) {
		throw new Error(cause instanceof Error && cause.name === 'TimeoutError' ? 'Models endpoint did not answer within 15s' : `Models endpoint unreachable: ${cause instanceof Error ? cause.message : 'connection failed'}`);
	}
	if (!response.ok) throw new Error(`Models endpoint returned HTTP ${response.status}`);
	return parseModelList(await response.json().catch(() => null));
}

// ---------------------------------------------------------------------------
// Resolution: project lock/override → app default → legacy KIMI_* env.
// ---------------------------------------------------------------------------

export interface ProviderEnvironment {
	KIMI_API_KEY?: string;
	KIMI_API_BASE?: string;
	KIMI_MODEL?: string;
	HYPER_API_KEY?: string;
}

export interface RaycastBridgeAccess {
	baseUrl: string;
	token: string;
	/** Same health probe as the capability check. */
	isConnected(): Promise<boolean>;
}

export type ModelResolution =
	| { ok: true; connection: ModelConnection; source: ModelSource; locked: boolean }
	| { ok: false; code: 'NOT_CONFIGURED' | 'MODEL_UNAVAILABLE'; message: string; choice: ModelChoice | null; source: ModelSource | null };

const trimmed = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);

export function legacyEnvChoice(env: ProviderEnvironment): ModelChoice | null {
	if (!trimmed(env.KIMI_API_KEY)) return null;
	return { provider: 'kimi', model: trimmed(env.KIMI_MODEL) ?? LEGACY_KIMI_MODEL, base_url: trimmed(env.KIMI_API_BASE) ?? LEGACY_KIMI_BASE_URL };
}

export function raycastBaseUrl(bridgeUrl: string): string {
	return `${bridgeUrl.replace(/\/$/, '')}/v1`;
}

/** Connection for a provider (key + base URL), independent of the model. */
export async function providerConnection(
	provider: ModelProviderKind,
	deps: { settings: AppSettings; env: ProviderEnvironment; raycast: RaycastBridgeAccess | null }
): Promise<{ ok: true; baseURL: string; apiKey: string } | { ok: false; code: 'NOT_CONFIGURED' | 'MODEL_UNAVAILABLE'; message: string }> {
	switch (provider) {
		case 'hyper': {
			const apiKey = trimmed(deps.settings.hyper.api_key) ?? trimmed(deps.env.HYPER_API_KEY);
			return apiKey ? { ok: true, baseURL: HYPER_BASE_URL, apiKey } : { ok: false, code: 'NOT_CONFIGURED', message: 'No Hyper key is saved. Add it in Settings → Agent model.' };
		}
		case 'custom': {
			const baseURL = trimmed(deps.settings.custom.base_url);
			const apiKey = trimmed(deps.settings.custom.api_key);
			if (!baseURL || !apiKey) return { ok: false, code: 'NOT_CONFIGURED', message: 'The custom endpoint needs a base URL and key in Settings → Agent model.' };
			return { ok: true, baseURL, apiKey };
		}
		case 'raycast': {
			if (!deps.raycast) return { ok: false, code: 'NOT_CONFIGURED', message: 'The Raycast bridge is not configured (CSP_RAYCAST_BRIDGE_URL/TOKEN).' };
			if (!(await deps.raycast.isConnected())) return { ok: false, code: 'MODEL_UNAVAILABLE', message: 'The Raycast bridge is not connected.' };
			return { ok: true, baseURL: raycastBaseUrl(deps.raycast.baseUrl), apiKey: deps.raycast.token };
		}
		case 'kimi': {
			const apiKey = trimmed(deps.env.KIMI_API_KEY);
			return apiKey
				? { ok: true, baseURL: trimmed(deps.env.KIMI_API_BASE) ?? LEGACY_KIMI_BASE_URL, apiKey }
				: { ok: false, code: 'NOT_CONFIGURED', message: 'KIMI_API_KEY is not configured.' };
		}
	}
}

export async function resolveAgentModel(
	project: Pick<Project, 'agent_model'> | null,
	deps: { settings: AppSettings; env: ProviderEnvironment; raycast: RaycastBridgeAccess | null }
): Promise<ModelResolution> {
	const projectChoice = project?.agent_model.override ?? null;
	const locked = Boolean(project?.agent_model.locked_at);
	const choice = projectChoice ?? deps.settings.default_model ?? legacyEnvChoice(deps.env);
	const source: ModelSource = projectChoice ? 'project' : deps.settings.default_model ? 'app-default' : 'env';
	if (!choice) {
		return { ok: false, code: 'NOT_CONFIGURED', message: 'No Agent model is configured. Pick one in Settings → Agent model (or set KIMI_API_KEY).', choice: null, source: null };
	}
	const connection = await providerConnection(choice.provider, deps);
	const who = `${PROVIDER_LABELS[choice.provider]} · ${choice.model}`;
	const prefix = locked ? `This project is locked to ${who}` : `The ${source === 'project' ? 'project' : 'app default'} model is ${who}`;
	if (!connection.ok) return { ok: false, code: connection.code, message: `${prefix}, but: ${connection.message} No other model is used in its place.`, choice, source };
	// A pinned endpoint that moved is a different model, not the locked one.
	if (choice.base_url && choice.provider !== 'raycast' && choice.base_url.replace(/\/$/, '') !== connection.baseURL.replace(/\/$/, '')) {
		return { ok: false, code: 'MODEL_UNAVAILABLE', message: `${prefix} at ${choice.base_url}, but the configured endpoint is now ${connection.baseURL}. Switch the project model explicitly.`, choice, source };
	}
	return { ok: true, source, locked, connection: { choice: { ...choice, base_url: choice.base_url ?? connection.baseURL }, baseURL: connection.baseURL, apiKey: connection.apiKey } };
}
