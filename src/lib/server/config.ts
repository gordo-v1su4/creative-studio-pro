import { env } from '$env/dynamic/private';
import { ProjectStore } from '$lib/adapters/project-store';
import type { ProjectStoreConfig } from '$lib/adapters/project-store';
import { RaycastBridge } from '$lib/adapters/m3-bridge';
import { checkRaycastBridgeConnected } from '$lib/adapters/capability';
import { ProjectCommandGateway } from '$lib/application/gateway';
import type { Project } from '$lib/domain/schemas';
import { createStageAgent } from '$lib/server/stage-agent';
import type { StageAgentResolution } from '$lib/server/stage-agent-handler';
import { createStoryBuilder } from '$lib/server/story-builder';
import type { StoryBuilder } from '$lib/server/story-builder';
import { AppSettingsStore, appSettingsPath } from '$lib/server/app-settings';
import { SeriesStore } from '$lib/server/series';
import { createOpenAICompatibleClient, resolveAgentModel } from '$lib/server/model-provider';
import type { ModelResolution, ProviderEnvironment, RaycastBridgeAccess } from '$lib/server/model-provider';
import type { ModelSettingsDeps } from '$lib/server/model-settings';
import type { AnimateDeps } from '$lib/server/animate';
import { cliRunner, createHiggsfieldCli, higgsfieldCliPath, type VideoGenerator, createHiggsfieldSfx, type SoundEffectGenerator } from '$lib/server/higgsfield';
import { probeMedia } from '$lib/server/media-probe';

/**
 * Runtime configuration (AD-14): environment-injected, explicit schema at
 * startup, fail closed on missing required values.
 */

let cachedStore: ProjectStore | null = null;
let cachedSettings: AppSettingsStore | null = null;

export function getProjectRoot(): string {
	const root = env.CSP_PROJECT_ROOT;
	if (!root || root.length === 0) {
		throw new Error('CSP_PROJECT_ROOT is not configured; refusing to start with an implicit project root');
	}
	return root;
}

export function getProjectStore(): ProjectStore {
	if (cachedStore) return cachedStore;
	const config: ProjectStoreConfig = { root: getProjectRoot() };
	cachedStore = new ProjectStore(config);
	return cachedStore;
}

export function getRaycastBridge(): RaycastBridge | null {
	const baseUrl = env.CSP_RAYCAST_BRIDGE_URL ?? env.CSP_M3_BRIDGE_URL;
	const token = env.CSP_RAYCAST_BRIDGE_TOKEN ?? env.CSP_M3_BRIDGE_TOKEN;
	if (!baseUrl || !token) return null;
	return new RaycastBridge({ baseUrl, token });
}

/** Legacy name retained for callers during CSP_M3_* migration. */
export const getM3Bridge = getRaycastBridge;

export function getGateway(): ProjectCommandGateway {
	return new ProjectCommandGateway(getProjectStore(), getRaycastBridge());
}

// --- Agent model provider (V1S-117) ---

/** App settings live beside the project root, never inside a project. */
export function getAppSettingsStore(): AppSettingsStore {
	if (cachedSettings) return cachedSettings;
	cachedSettings = new AppSettingsStore(appSettingsPath(getProjectRoot(), env.CSP_APP_SETTINGS_PATH));
	return cachedSettings;
}

/** Legacy KIMI_* stays the fallback default when no app default is picked. */
export function getProviderEnvironment(): ProviderEnvironment {
	return { KIMI_API_KEY: env.KIMI_API_KEY, KIMI_API_BASE: env.KIMI_API_BASE, KIMI_MODEL: env.KIMI_MODEL, HYPER_API_KEY: env.HYPER_API_KEY };
}

/** The Raycast bridge as a Model provider: offered only while its health check passes. */
export function getRaycastBridgeAccess(): RaycastBridgeAccess | null {
	const baseUrl = env.CSP_RAYCAST_BRIDGE_URL ?? env.CSP_M3_BRIDGE_URL;
	const token = env.CSP_RAYCAST_BRIDGE_TOKEN ?? env.CSP_M3_BRIDGE_TOKEN;
	if (!baseUrl || !token) return null;
	return { baseUrl, token, isConnected: () => checkRaycastBridgeConnected(baseUrl) };
}

export function getModelSettingsDeps(): ModelSettingsDeps {
	const bridge = getRaycastBridge();
	return {
		settings: getAppSettingsStore(),
		env: getProviderEnvironment(),
		raycast: getRaycastBridgeAccess(),
		raycastCatalog: bridge ? async () => (await bridge.getModelCatalog()).models.map((model) => model.label) : undefined
	};
}

export async function resolveProjectModel(project: Pick<Project, 'agent_model'> | null): Promise<ModelResolution> {
	return resolveAgentModel(project, {
		settings: await getAppSettingsStore().read(),
		env: getProviderEnvironment(),
		raycast: getRaycastBridgeAccess()
	});
}

export async function resolveStageAgent(project: Project): Promise<StageAgentResolution> {
	const resolved = await resolveProjectModel(project);
	if (!resolved.ok) return { ok: false, code: resolved.code, message: resolved.message };
	return { ok: true, agent: createStageAgent({ client: createOpenAICompatibleClient(resolved.connection) }) };
}

export async function resolveStoryBuilder(project: Project): Promise<{ ok: true; builder: StoryBuilder } | { ok: false; code: string; message: string }> {
	const resolved = await resolveProjectModel(project);
	if (!resolved.ok) return { ok: false, code: resolved.code, message: resolved.message };
	return { ok: true, builder: createStoryBuilder(createOpenAICompatibleClient(resolved.connection)) };
}

export function getOperatorId(): string {
	return env.CSP_OPERATOR_ID?.trim() || 'operator';
}

/** The Higgsfield CLI generator (operator's higgsfield.ai account), or null when the CLI isn't installed. */
export function getVideoGenerator(): VideoGenerator | null {
	const bin = higgsfieldCliPath(env.HIGGSFIELD_CLI);
	return bin ? createHiggsfieldCli(cliRunner(bin)) : null;
}

/** Sound-effect generation through the same CLI (V1S-129), or null when the CLI isn't installed. */
export function getSfxGenerator(): SoundEffectGenerator | null {
	const bin = higgsfieldCliPath(env.HIGGSFIELD_CLI);
	return bin ? createHiggsfieldSfx(cliRunner(bin)) : null;
}

/** The local sound-effects folder: Settings, else CSP_SFX_DIR, else none. */
export async function getSfxFolder(): Promise<string | null> {
	const settings = await getAppSettingsStore().read();
	return settings.sfx_folder?.trim() || env.CSP_SFX_DIR?.trim() || null;
}

/** Animate's dependencies. */
/** The Notion integration token (server-side only; the integration sees only the series root shared with it). */
export function getNotionToken(): string | null {
	return env.NOTION_TOKEN?.trim() || null;
}

export function getSeriesStore(): SeriesStore {
	return SeriesStore.beside(getProjectRoot());
}

export async function getAnimateDeps(): Promise<AnimateDeps> {
	return {
		gateway: getGateway(),
		store: getProjectStore(),
		projectRoot: getProjectRoot(),
		generator: getVideoGenerator(),
		probe: probeMedia,
		download: async (url) => {
			const response = await fetch(url);
			if (!response.ok) throw new Error(`Download failed: ${response.status}`);
			return new Uint8Array(await response.arrayBuffer());
		}
	};
}
