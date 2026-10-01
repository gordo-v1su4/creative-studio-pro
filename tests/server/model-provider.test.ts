import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ModelChoice } from '../../src/lib/domain/model-provider';
import { AppSettingsStore, appSettingsPath, emptyAppSettings, publicAppSettings } from '../../src/lib/server/app-settings';
import { AgentRuleBreakError, generateStructured, resolveAgentModel, runModelTest } from '../../src/lib/server/model-provider';
import type { AgentModelClient, ModelImage, RaycastBridgeAccess } from '../../src/lib/server/model-provider';
import { getModelSettingsView, listVisionModels, saveModelSettings, testModel } from '../../src/lib/server/model-settings';
import type { ModelSettingsDeps } from '../../src/lib/server/model-settings';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const HYPER = 'https://hyper.charm.land/v1';
const choice: ModelChoice = { provider: 'hyper', model: 'deepseek-v4.1-flash', base_url: HYPER };

/** Fake provider: canned answers in order; records prompts and images. */
function fakeClient(answers: string[], options: { choice?: ModelChoice; calls?: { prompt: string; images: ModelImage[] }[] } = {}): AgentModelClient {
	let index = 0;
	return {
		choice: options.choice ?? choice,
		async generate({ prompt, images = [] }) {
			options.calls?.push({ prompt, images });
			return answers[Math.min(index++, answers.length - 1)] ?? '';
		}
	};
}

const parseGreeting = (value: unknown) => {
	if (!value || typeof value !== 'object' || typeof (value as { greeting?: unknown }).greeting !== 'string') throw new Error('greeting must be a string');
	return value as { greeting: string };
};

describe('Structured answers: one retry, then a visible stop', () => {
	test('good answer passes through in one call', async () => {
		const calls: { prompt: string; images: ModelImage[] }[] = [];
		const result = await generateStructured(fakeClient(['{"greeting":"hi"}'], { calls }), { system: 's', prompt: 'p' }, parseGreeting);
		expect(result.greeting).toBe('hi');
		expect(calls).toHaveLength(1);
	});

	test('a rule-breaking answer is retried once with the error', async () => {
		const calls: { prompt: string; images: ModelImage[] }[] = [];
		const result = await generateStructured(fakeClient(['{"greeting":7}', '{"greeting":"fixed"}'], { calls }), { system: 's', prompt: 'p' }, parseGreeting);
		expect(result.greeting).toBe('fixed');
		expect(calls).toHaveLength(2);
		expect(calls[1]?.prompt).toContain('YOUR PREVIOUS ANSWER BROKE THE RULES: greeting must be a string');
	});

	test('a second rule break stops the Agent and names the model; no other model is tried', async () => {
		const calls: { prompt: string; images: ModelImage[] }[] = [];
		const error = await generateStructured(fakeClient(['not json', 'still not json'], { calls }), { system: 's', prompt: 'p' }, parseGreeting).catch((cause) => cause);
		expect(error).toBeInstanceOf(AgentRuleBreakError);
		expect((error as Error).message).toContain('deepseek-v4.1-flash');
		expect((error as Error).message).toContain('No other model was tried');
		expect(calls).toHaveLength(2);
	});

	test('transport failures are not rule breaks and are not retried', async () => {
		let calls = 0;
		const client: AgentModelClient = { choice, async generate() { calls += 1; throw new Error('provider unavailable'); } };
		await expect(generateStructured(client, { system: 's', prompt: 'p' }, parseGreeting)).rejects.toThrow('provider unavailable');
		expect(calls).toBe(1);
	});
});

describe('Pick-time model test', () => {
	test('sends a real PNG and passes a vision model that follows the rules', async () => {
		const calls: { prompt: string; images: ModelImage[] }[] = [];
		const result = await runModelTest(fakeClient(['{"color":"red","word_count":3,"echo":"narrate-check"}'], { calls }));
		expect(result.passed).toBeTrue();
		const image = calls[0]?.images[0];
		expect(image?.mediaType).toBe('image/png');
		expect(Array.from(image?.data.slice(1, 4) ?? [])).toEqual([0x50, 0x4e, 0x47]);
	});

	test('fails a model that cannot see the image', async () => {
		const result = await runModelTest(fakeClient(['{"color":"unknown","word_count":3,"echo":"narrate-check"}']));
		expect(result.passed).toBeFalse();
		expect(result.checks.image).toBeFalse();
		expect(result.detail).toContain('could not read the image');
	});

	test('fails a model that breaks the answer shape', async () => {
		const result = await runModelTest(fakeClient(['Sure! The image is red.']));
		expect(result.checks.structured).toBeFalse();
		expect(result.passed).toBeFalse();
	});
});

describe('Model resolution: project lock → app default → KIMI_* env, never a fallback model', () => {
	const env = { KIMI_API_KEY: 'kimi-secret', KIMI_MODEL: 'k3' };
	const locked = (override: ModelChoice) => ({ agent_model: { override, locked_at: '2026-01-01T00:00:00Z', history: [] } });

	test('legacy env stays the default when nothing is picked', async () => {
		const resolved = await resolveAgentModel(null, { settings: emptyAppSettings(), env, raycast: null });
		expect(resolved.ok && resolved.connection.choice).toEqual({ provider: 'kimi', model: 'k3', base_url: 'https://api.kimi.com/coding/v1' });
		expect(resolved.ok && resolved.source).toBe('env');
	});

	test('app default wins over env for an unlocked project', async () => {
		const settings = { ...emptyAppSettings(), hyper: { api_key: 'hyper-secret' }, default_model: choice };
		const resolved = await resolveAgentModel({ agent_model: { override: null, locked_at: null, history: [] } }, { settings, env, raycast: null });
		expect(resolved.ok && resolved.connection).toEqual({ choice, baseURL: HYPER, apiKey: 'hyper-secret' });
	});

	test('a locked project keeps its model even when the app default changes', async () => {
		const settings = { ...emptyAppSettings(), hyper: { api_key: 'hyper-secret' }, default_model: { ...choice, model: 'glm-5.3-flash' } };
		const resolved = await resolveAgentModel(locked(choice), { settings, env, raycast: null });
		expect(resolved.ok && resolved.connection.choice.model).toBe('deepseek-v4.1-flash');
		expect(resolved.ok && resolved.locked).toBeTrue();
	});

	test('a locked project whose provider lost its key stops instead of using env', async () => {
		const resolved = await resolveAgentModel(locked(choice), { settings: emptyAppSettings(), env, raycast: null });
		expect(resolved.ok).toBeFalse();
		if (!resolved.ok) {
			expect(resolved.code).toBe('NOT_CONFIGURED');
			expect(resolved.message).toContain('locked to Hyper · deepseek-v4.1-flash');
			expect(resolved.message).toContain('No other model');
		}
	});

	test('a moved custom endpoint is a different model, not the locked one', async () => {
		const pinned: ModelChoice = { provider: 'custom', model: 'glm-5.3-flash', base_url: 'https://old.example/v1' };
		const settings = { ...emptyAppSettings(), custom: { base_url: 'https://new.example/v1', api_key: 'k' } };
		const resolved = await resolveAgentModel(locked(pinned), { settings, env, raycast: null });
		expect(!resolved.ok && resolved.code).toBe('MODEL_UNAVAILABLE');
	});

	test('a disconnected Raycast bridge is unavailable, not replaced', async () => {
		const raycast: RaycastBridgeAccess = { baseUrl: 'http://bridge', token: 't', isConnected: async () => false };
		const resolved = await resolveAgentModel(locked({ provider: 'raycast', model: 'glm-5.3-flash', base_url: null }), { settings: emptyAppSettings(), env, raycast });
		expect(!resolved.ok && resolved.message).toContain('not connected');
	});
});

async function settingsDeps(overrides: Partial<ModelSettingsDeps> = {}): Promise<ModelSettingsDeps & { root: string }> {
	const root = await mkdtemp(join(tmpdir(), 'csp-settings-')); roots.push(root);
	const store = new AppSettingsStore(appSettingsPath(join(root, 'projects')));
	return { root, settings: store, env: {}, raycast: null, ...overrides };
}

const hyperModels = { data: [
	{ id: 'deepseek-v4.1-flash' },
	{ id: 'glm-5.3-flash', architecture: { input_modalities: ['text', 'image'] } },
	{ id: 'text-only-1', architecture: { input_modalities: ['text'] } },
	{ id: 'mystery' }
] };

describe('App settings and Settings → Agent model', () => {
	test('keys are stored beside the project root, never inside it, and never leave the server', async () => {
		const deps = await settingsDeps();
		expect(deps.settings.path).toBe(join(deps.root, 'app-settings.json'));
		expect(() => appSettingsPath(join(deps.root, 'projects'), join(deps.root, 'projects', 'p1', 'settings.json'))).toThrow('outside CSP_PROJECT_ROOT');
		const saved = await saveModelSettings(deps, { hyper_api_key: 'hyper-secret-key', custom_base_url: 'https://custom.example/v1', custom_api_key: 'custom-secret-key' });
		expect(saved.ok).toBeTrue();
		expect(JSON.stringify(saved)).not.toContain('secret-key');
		expect(saved.ok && saved.data.settings).toMatchObject({ hyper: { has_key: true }, custom: { base_url: 'https://custom.example/v1', has_key: true } });
		expect(await readFile(deps.settings.path, 'utf8')).toContain('hyper-secret-key');
		expect(JSON.stringify(publicAppSettings(await deps.settings.read()))).not.toContain('secret-key');
	});

	test('Raycast bridge is offered only while connected', async () => {
		let connected = false;
		const deps = await settingsDeps({ raycast: { baseUrl: 'http://bridge', token: 't', isConnected: async () => connected } });
		expect((await getModelSettingsView(deps)).providers.map((p) => p.id)).toEqual(['hyper', 'custom']);
		connected = true;
		expect((await getModelSettingsView(deps)).providers.map((p) => p.id)).toEqual(['hyper', 'custom', 'raycast']);
	});

	test('live Hyper list is fetched with the key and filtered to vision models', async () => {
		const seen: { url: string; auth: string | null }[] = [];
		const deps = await settingsDeps({
			fetch: async (url, init) => {
				seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
				return new Response(JSON.stringify(hyperModels), { status: 200 });
			}
		});
		await saveModelSettings(deps, { hyper_api_key: 'hk' });
		const listed = await listVisionModels(deps, 'hyper');
		expect(seen[0]).toEqual({ url: `${HYPER}/models`, auth: 'Bearer hk' });
		expect(listed.ok && listed.data.models.map((m) => m.id)).toEqual(['deepseek-v4.1-flash', 'glm-5.3-flash']);
		expect(listed.ok && listed.data.hidden_non_vision).toBe(2);
	});

	test('no-vision model cannot become the default until an image test proves it can see', async () => {
		const deps = await settingsDeps({
			fetch: async () => new Response(JSON.stringify(hyperModels), { status: 200 }),
			createClient: (connection) => fakeClient(['{"color":"unknown","word_count":3,"echo":"narrate-check"}'], { choice: connection.choice })
		});
		await saveModelSettings(deps, { hyper_api_key: 'hk' });
		const refused = await saveModelSettings(deps, { default_model: { provider: 'hyper', model: 'mystery' } });
		expect(!refused.ok && refused.error.code).toBe('NOT_VISION_CAPABLE');
		const blind = await testModel(deps, { provider: 'hyper', model: 'mystery' });
		expect(blind.ok && blind.data.result.passed).toBeFalse();
		expect((await saveModelSettings(deps, { default_model: { provider: 'hyper', model: 'mystery' } })).ok).toBeFalse();

		const sighted = { ...deps, createClient: (connection: Parameters<NonNullable<ModelSettingsDeps['createClient']>>[0]) => fakeClient(['{"color":"red","word_count":3,"echo":"narrate-check"}'], { choice: connection.choice }) };
		const passed = await testModel(sighted, { provider: 'hyper', model: 'mystery' });
		expect(passed.ok && passed.data.result.passed).toBeTrue();
		const accepted = await saveModelSettings(sighted, { default_model: { provider: 'hyper', model: 'mystery' } });
		expect(accepted.ok && accepted.data.settings.default_model).toEqual({ provider: 'hyper', model: 'mystery', base_url: HYPER });
	});

	test('known-vision default saves; env fallback is reported when no default is picked', async () => {
		const deps = await settingsDeps({ env: { KIMI_API_KEY: 'k' } });
		expect((await getModelSettingsView(deps)).effective_default?.provider).toBe('kimi');
		expect((await saveModelSettings(deps, { default_model: { provider: 'hyper', model: 'deepseek-v4.1-flash' } })).ok).toBeFalse();
		await saveModelSettings(deps, { hyper_api_key: 'hk' });
		const saved = await saveModelSettings(deps, { default_model: { provider: 'hyper', model: 'deepseek-v4.1-flash' } });
		expect(saved.ok && saved.data.effective_default).toEqual(choice);
	});
});
