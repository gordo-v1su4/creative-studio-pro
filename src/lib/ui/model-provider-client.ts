import type { ModelChoice, ModelProviderKind, ModelSettingsView, ModelTestResult, ProjectModelView, ProviderModel } from '$lib/domain/model-provider';
import type { Project } from '$lib/domain/schemas';

/** Thin browser calls for Settings → Agent model and the project model panel. Keys go up, never down. */

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { message: string } };

async function call<T>(input: string, init?: RequestInit): Promise<T> {
	const response = await fetch(input, init);
	const body = await response.json().catch(() => null) as Envelope<T> | null;
	if (!body) throw new Error(`${init?.method ?? 'GET'} ${input} failed: HTTP ${response.status}`);
	if (!body.ok) throw new Error(body.error.message);
	return body.data;
}

const jsonInit = (method: string, body: unknown, headers: Record<string, string> = {}): RequestInit => ({
	method,
	headers: { 'content-type': 'application/json', ...headers },
	body: JSON.stringify(body)
});

export const loadModelSettings = () => call<ModelSettingsView>('/api/settings/model-provider');

export const saveModelSettings = (patch: {
	hyper_api_key?: string | null;
	custom_base_url?: string | null;
	custom_api_key?: string | null;
	default_model?: { provider: ModelProviderKind; model: string } | null;
}) => call<ModelSettingsView>('/api/settings/model-provider', jsonInit('PUT', patch));

export const loadVisionModels = (provider: ModelProviderKind) =>
	call<{ provider: ModelProviderKind; models: ProviderModel[]; hidden_non_vision: number }>(`/api/settings/model-provider/models?provider=${encodeURIComponent(provider)}`);

export const testModel = (provider: ModelProviderKind, model: string) =>
	call<{ choice: ModelChoice; result: ModelTestResult }>('/api/settings/model-provider/test', jsonInit('POST', { provider, model }));

export const loadProjectModel = (projectId: string) => call<ProjectModelView>(`/api/projects/${projectId}/model`);

export const changeProjectModel = (projectId: string, token: string, body: {
	expected_version: number;
	choice: { provider: ModelProviderKind; model: string } | null;
	reason?: string | null;
	confirm_switch?: boolean;
}) => call<Project>(`/api/projects/${projectId}/model`, jsonInit('POST', body, { authorization: `Bearer ${token}` }));
