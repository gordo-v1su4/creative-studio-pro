import type { CapabilityReport } from '$lib/domain/schemas';

/**
 * Capability health adapter (FR-032, AR-06, AR-13): non-billable, explicitly
 * time-bounded checks against configured endpoints. States are never
 * fabricated (NFR-002): an unset endpoint is `not-configured`, a timeout or
 * network failure is `offline` with the real error, and nothing falls back.
 */

export interface CapabilityEndpoints {
	m3BridgeUrl: string | undefined;
	splitterUrl: string | undefined;
	desktopUrl: string | undefined;
}

/** AR-13: connect timeout 10s. */
const HEALTH_TIMEOUT_MS = 10_000;

async function probe(
	url: string,
	path: string
): Promise<{ state: 'available' | 'degraded' | 'offline'; detail: string }> {
	const target = url.replace(/\/$/, '') + path;
	try {
		const response = await fetch(target, {
			method: 'GET',
			signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
		});
		if (response.ok) {
			return { state: 'available', detail: `HTTP ${response.status} from ${path}` };
		}
		return { state: 'degraded', detail: `HTTP ${response.status} from ${path}` };
	} catch (e) {
		const message =
			e instanceof Error && e.name === 'TimeoutError'
				? `No response within ${HEALTH_TIMEOUT_MS / 1000}s`
				: e instanceof Error
					? e.message
					: 'Connection failed';
		return { state: 'offline', detail: message };
	}
}

export async function checkCapabilities(
	endpoints: CapabilityEndpoints
): Promise<CapabilityReport[]> {
	const now = new Date().toISOString();

	const checked = async (
		id: string,
		name: string,
		kind: CapabilityReport['kind'],
		url: string | undefined,
		path: string,
		configNote: string
	): Promise<CapabilityReport> => {
		if (!url) {
			return { id, name, kind, state: 'not-configured', detail: configNote, last_checked: null };
		}
		const result = await probe(url, path);
		return { id, name, kind, state: result.state, detail: result.detail, last_checked: now };
	};

	const [m3, splitter, desktop] = await Promise.all([
		checked('m3-bridge', 'M3 Raycast bridge', 'machine', endpoints.m3BridgeUrl, '/health', 'CSP_M3_BRIDGE_URL is not set'),
		checked('splitter', 'Hosted Splitter service', 'service', endpoints.splitterUrl, '/openapi.json', 'CSP_SPLITTER_URL is not set'),
		checked('desktop-stack', 'Desktop generation stack (SwarmUI/ComfyUI)', 'machine', endpoints.desktopUrl, '/health', 'CSP_DESKTOP_URL is not set')
	]);

	return [
		{
			id: 'racknerd-host',
			name: 'Racknerd host',
			kind: 'host',
			state: 'available',
			detail: 'Serving this application',
			last_checked: now
		},
		{
			id: 'home-server',
			name: 'Home server target',
			kind: 'host',
			// EXPERIENCE.md: home-server target is PLANNED, not offline.
			state: 'planned',
			detail: 'Phase 0 runs on Racknerd; contracts stay portable (AR-12)',
			last_checked: null
		},
		m3,
		splitter,
		desktop,
		{
			id: 'providers',
			name: 'Generation providers',
			kind: 'provider',
			state: 'not-configured',
			detail: 'No provider adapters configured yet (Phase 2+)',
			last_checked: null
		}
	];
}
