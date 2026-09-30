import { env } from '$env/dynamic/private';
import { ProjectStore } from '$lib/adapters/project-store';
import type { ProjectStoreConfig } from '$lib/adapters/project-store';
import { RaycastBridge } from '$lib/adapters/m3-bridge';
import { ProjectCommandGateway } from '$lib/application/gateway';
import { createStageAgent } from '$lib/server/stage-agent';
import type { StageAgent } from '$lib/server/stage-agent';
import { createStoryBuilder } from '$lib/server/story-builder';
import type { StoryBuilder } from '$lib/server/story-builder';

/**
 * Runtime configuration (AD-14): environment-injected, explicit schema at
 * startup, fail closed on missing required values.
 */

let cachedStore: ProjectStore | null = null;
let cachedStageAgent: StageAgent | null | undefined;
let cachedStoryBuilder: StoryBuilder | null | undefined;

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

export function getStageAgent(): StageAgent | null {
	if (cachedStageAgent !== undefined) return cachedStageAgent;
	if (!env.KIMI_API_KEY) {
		cachedStageAgent = null;
		return cachedStageAgent;
	}
	cachedStageAgent = createStageAgent({
		apiKey: env.KIMI_API_KEY,
		baseURL: env.KIMI_API_BASE ?? 'https://api.kimi.com/coding/v1',
		model: env.KIMI_MODEL ?? 'k3'
	});
	return cachedStageAgent;
}

export function getStoryBuilder(): StoryBuilder | null {
	if (cachedStoryBuilder !== undefined) return cachedStoryBuilder;
	if (!env.KIMI_API_KEY) return (cachedStoryBuilder = null);
	return (cachedStoryBuilder = createStoryBuilder({
		apiKey: env.KIMI_API_KEY,
		baseURL: env.KIMI_API_BASE?.trim() || 'https://api.kimi.com/coding/v1',
		model: env.KIMI_MODEL?.trim() || 'k3'
	}));
}
