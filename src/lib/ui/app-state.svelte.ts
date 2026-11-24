import type { CapabilityReport, Project } from '$lib/domain/schemas';
import type { StoryLevel } from '$lib/domain/story-levels';

/**
 * Shared UI chrome state (drawers, palette, capability cache). UI-only:
 * canonical project truth stays server-side behind the command gateway.
 */

export type PaletteAction = {
	id: string;
	label: string;
	hint?: string;
	disabled?: boolean;
	run?: () => void;
};

class AppUiState {
	chatOpen = $state(false);
	chatMode = $state<'focus' | 'dock'>('focus');
	paletteOpen = $state(false);
	/** The story plan level open on the Story stage; null follows the next level that is not approved. */
	storyLevel = $state<StoryLevel | null>(null);
	/** What the Agent does first for a project just started at the front door, unasked (story 6). Taken once, by the screen that does it. */
	agentAsk = $state<{ projectId: string; action: 'draft_brief' | 'pitch' } | null>(null);
	capabilitiesOpen = $state(false);
	/** Canvas page context surfaced in global chrome (agent drawer). */
	activeProjectTitle = $state('');
	activeProject = $state<Project | null>(null);
	activeProjectUpdater: ((project: Project) => void) | null = null;
	/** Page-contributed palette actions, merged after the global set. */
	pageActions = $state<PaletteAction[]>([]);
	capabilities = $state<CapabilityReport[]>([]);
	capabilitiesLoading = $state(false);
	capabilitiesError = $state<string | null>(null);

	get capabilitiesChecked(): boolean {
		return this.capabilities.length > 0;
	}

	adoptActiveProject(project: Project): void {
		if (this.activeProjectUpdater) this.activeProjectUpdater(project);
		else this.activeProject = project;
	}

	async refreshCapabilities(): Promise<void> {
		this.capabilitiesLoading = true;
		this.capabilitiesError = null;
		try {
			const response = await fetch('/api/capabilities');
			if (!response.ok) throw new Error(`GET /api/capabilities failed: ${response.status}`);
			const body = (await response.json()) as { ok: boolean; data: CapabilityReport[] };
			if (!body.ok) throw new Error('Capability check rejected');
			this.capabilities = body.data;
		} catch (e) {
			this.capabilitiesError = e instanceof Error ? e.message : 'Capability check failed';
		} finally {
			this.capabilitiesLoading = false;
		}
	}
}

export const ui = new AppUiState();
