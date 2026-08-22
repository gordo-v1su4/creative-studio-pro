import { env } from '$env/dynamic/private';
import { ProjectStore } from '$lib/adapters/project-store';
import type { ProjectStoreConfig } from '$lib/adapters/project-store';
import { RaycastBridge } from '$lib/adapters/m3-bridge';
import { ProjectCommandGateway } from '$lib/application/gateway';

/**
 * Runtime configuration (AD-14): environment-injected, explicit schema at
 * startup, fail closed on missing required values.
 */

let cachedStore: ProjectStore | null = null;

export function getProjectStore(): ProjectStore {
	if (cachedStore) return cachedStore;
	const root = env.CSP_PROJECT_ROOT;
	if (!root || root.length === 0) {
		throw new Error('CSP_PROJECT_ROOT is not configured; refusing to start with an implicit project root');
	}
	const config: ProjectStoreConfig = { root };
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
