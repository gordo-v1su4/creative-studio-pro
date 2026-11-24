import { RenderProviderError, type RenderProvider } from './types';

/** SwarmUI on the desktop: listed so the queue can name it, never set up (decision 32). */
export function createSwarmUiProvider(): RenderProvider {
	const no = (): never => { throw new RenderProviderError('SwarmUI on the desktop is not connected yet', 'error'); };
	return {
		id: 'swarmui',
		label: 'SwarmUI (desktop)',
		models: [],
		resolutions: [],
		async setup() { return { ready: false, reason: 'Not connected yet' }; },
		async price() { return no(); },
		async send() { return no(); },
		async check() { return no(); }
	};
}
