import type { RenderProviderId } from '$lib/domain/schemas';
import type { CliRunner } from '../higgsfield';
import { createFalProvider } from './fal';
import { createHiggsfieldProvider } from './higgsfield';
import { createSwarmUiProvider } from './swarmui';
import { describeProvider, type RenderProvider, type RenderProviderInfo } from './types';

export * from './types';

export type RenderProviders = Record<RenderProviderId, RenderProvider>;

/** Every render provider the queue can name, in the order they are listed. Higgsfield is where every entry starts. */
export function createRenderProviders(input: { higgsfield: CliRunner | null; falKey?: string | null; fetcher?: typeof fetch }): RenderProviders {
	return { higgsfield: createHiggsfieldProvider(input.higgsfield), fal: createFalProvider(input.falKey, input.fetcher), swarmui: createSwarmUiProvider() };
}

export const describeProviders = (providers: RenderProviders): Promise<RenderProviderInfo[]> => Promise.all(Object.values(providers).map(describeProvider));
