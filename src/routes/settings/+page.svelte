<script lang="ts">
	import { onMount } from 'svelte';
	import { ui } from '$lib/ui/app-state.svelte';
	import type { CapabilityState } from '$lib/domain/schemas';
	import ModelProviderSettings from '$lib/ui/settings/ModelProviderSettings.svelte';
	import GenerationSettings from '$lib/ui/settings/GenerationSettings.svelte';
	import SfxSettings from '$lib/ui/settings/SfxSettings.svelte';

	const stateColor: Record<CapabilityState, string> = {
		available: 'var(--color-gate-approved)',
		degraded: 'var(--color-gate-pending)',
		offline: 'var(--color-gate-failed)',
		planned: 'var(--color-gate-quoted)',
		'not-configured': 'var(--color-text-dim)',
		'not-checked': 'var(--color-capability-offline)'
	};

	onMount(() => {
		if (!ui.capabilitiesChecked && !ui.capabilitiesLoading) void ui.refreshCapabilities();
	});
</script>

<svelte:head><title>Settings — Narrate</title></svelte:head>

<div class="h-full overflow-y-auto p-6">
	<div class="mx-auto max-w-[720px]">
		<div class="meta-label">Settings</div>
		<h1 class="mt-1 text-[18px] font-semibold">Service contracts</h1>
		<p class="mt-1 text-text-muted">
			Endpoints are environment-injected server-side (NFR-004). Secrets never reach this page —
			only configuration presence and observed health.
		</p>

		<div class="mt-6 flex items-center justify-between">
			<div class="meta-label">Capability health</div>
			<button
				type="button"
				class="btn px-2.5 py-1"
				onclick={() => void ui.refreshCapabilities()}
				disabled={ui.capabilitiesLoading}
			>
				{ui.capabilitiesLoading ? 'Checking…' : 'Recheck all'}
			</button>
		</div>

		{#if ui.capabilitiesError}
			<div class="mt-3 rounded-sm border border-[color-mix(in_srgb,var(--color-gate-failed)_55%,var(--color-border-default))] bg-surface-raised p-2.5 text-gate-failed" role="alert">
				{ui.capabilitiesError}
			</div>
		{/if}

		<div class="mt-3 grid gap-2">
			{#each ui.capabilities as cap (cap.id)}
				<div class="flex items-center gap-3 rounded-sm border border-border-default bg-surface-raised px-3 py-2.5">
					<span class="block h-1.5 w-1.5 shrink-0 rounded-full" style:background={stateColor[cap.state]}></span>
					<div class="min-w-0">
						<b class="block truncate text-[13px]">{cap.name}</b>
						<span class="text-text-muted">{cap.detail}</span>
					</div>
					<span class="grow"></span>
					<span class="meta-label shrink-0" style:color={stateColor[cap.state]}>
						{cap.state.replace('-', ' ').toUpperCase()}
					</span>
				</div>
			{:else}
				{#if !ui.capabilitiesLoading}
					<div class="rounded-md border border-dashed border-border-default bg-surface-raised p-6 text-center text-text-dim">
						Not checked yet.
					</div>
				{/if}
			{/each}
		</div>

		<ModelProviderSettings />
		<GenerationSettings />
		<SfxSettings />

		<div class="meta-label mt-8">Endpoint configuration</div>
		<p class="mt-1 text-text-muted">
			Set these in the server environment, then recheck:
		</p>
		<ul class="mt-2 grid gap-1 font-mono text-[12px] text-text-muted">
			<li><b class="text-text-primary">CSP_RAYCAST_BRIDGE_URL</b> — raycast-pro-bridge on this Windows PC or another allowed host</li>
			<li><b class="text-text-primary">CSP_RAYCAST_BRIDGE_TOKEN</b> — server-side bearer token; never sent to the browser (legacy CSP_M3_* names remain supported)</li>
			<li><b class="text-text-primary">CSP_SPLITTER_URL</b> — hosted Splitter service</li>
			<li><b class="text-text-primary">CSP_DESKTOP_URL</b> — desktop generation stack health endpoint</li>
			<li><b class="text-text-primary">KIMI_API_KEY / KIMI_API_BASE / KIMI_MODEL</b> — fallback Agent model when no app default is picked</li>
			<li><b class="text-text-primary">CSP_APP_SETTINGS_PATH</b> — optional; where provider keys are stored (default: beside CSP_PROJECT_ROOT, never inside it)</li>
		</ul>
	</div>
</div>
