<script lang="ts">
	import { fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { ui } from '$lib/ui/app-state.svelte';
	import type { CapabilityState } from '$lib/domain/schemas';

	const stateStyles: Record<CapabilityState, { label: string; color: string }> = {
		available: { label: 'AVAILABLE', color: 'var(--color-gate-approved)' },
		degraded: { label: 'DEGRADED', color: 'var(--color-gate-pending)' },
		offline: { label: 'OFFLINE', color: 'var(--color-gate-failed)' },
		planned: { label: 'PLANNED', color: 'var(--color-gate-quoted)' },
		'not-configured': { label: 'NOT CONFIGURED', color: 'var(--color-text-dim)' },
		'not-checked': { label: 'NOT CHECKED', color: 'var(--color-capability-offline)' }
	};

	function formatChecked(iso: string | null): string {
		if (!iso) return 'never checked';
		return `checked ${new Date(iso).toLocaleTimeString()}`;
	}

	$effect(() => {
		if (ui.capabilitiesOpen && !ui.capabilitiesChecked && !ui.capabilitiesLoading) {
			void ui.refreshCapabilities();
		}
	});
</script>

{#if ui.capabilitiesOpen}
	<aside
		class="fixed inset-y-0 right-0 z-40 flex w-[360px] max-w-[92vw] flex-col border-l border-border-default bg-surface-raised shadow-[-16px_0_48px_rgba(0,0,0,0.55)]"
		transition:fly={{ x: 400, duration: 340, easing: quintOut }}
		aria-label="Capability Drawer"
	>
		<header class="flex items-center gap-2 border-b border-border-subtle px-3.5 py-3">
			<span class="font-mono text-[13px] text-text-dim">╭─</span>
			<span class="font-mono text-[12px] font-semibold tracking-[0.08em] uppercase">Capabilities</span>
			<span class="grow"></span>
			<button
				type="button"
				class="btn px-2 py-1 text-[11px]"
				onclick={() => void ui.refreshCapabilities()}
				disabled={ui.capabilitiesLoading}
			>
				{ui.capabilitiesLoading ? 'Checking…' : 'Recheck'}
			</button>
			<button
				type="button"
				class="btn px-2 py-1 font-mono text-[11px]"
				onclick={() => (ui.capabilitiesOpen = false)}
				aria-label="Close capability drawer"
			>
				esc
			</button>
		</header>

		<div class="grow space-y-2.5 overflow-y-auto px-3.5 py-4">
			{#if ui.capabilitiesError}
				<div
					class="rounded-sm border border-[color-mix(in_srgb,var(--color-gate-failed)_55%,var(--color-border-default))] bg-surface-raised-2 p-2.5 text-gate-failed"
					role="alert"
				>
					{ui.capabilitiesError}
				</div>
			{/if}

			{#if ui.capabilitiesLoading && !ui.capabilitiesChecked}
				<div class="font-mono text-[12px] text-text-dim" aria-live="polite">Running health checks…</div>
			{/if}

			{#each ui.capabilities as cap (cap.id)}
				{@const style = stateStyles[cap.state]}
				<div class="rounded-sm border border-border-default bg-surface-raised-2 p-2.5">
					<div class="flex items-center gap-2">
						<span class="block h-1.5 w-1.5 rounded-full" style:background={style.color}></span>
						<b class="text-[13px]">{cap.name}</b>
						<span class="grow"></span>
						<span class="meta-label" style:color={style.color}>{style.label}</span>
					</div>
					<div class="mt-1.5 flex items-baseline justify-between gap-2">
						<span class="text-text-muted">{cap.detail}</span>
						<span class="meta-label shrink-0 text-text-dim">{formatChecked(cap.last_checked)}</span>
					</div>
				</div>
			{/each}
		</div>

		<footer class="border-t border-border-subtle px-3.5 py-2 font-mono text-[10px] tracking-[0.06em] text-text-dim">
			health checks are non-billable · nothing falls back automatically
		</footer>
	</aside>
{/if}
