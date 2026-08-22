<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { ui } from '$lib/ui/app-state.svelte';
	import type { PaletteAction } from '$lib/ui/app-state.svelte';
	import AgentChat from '$lib/ui/chat/AgentChat.svelte';
	import CommandPalette from '$lib/ui/CommandPalette.svelte';
	import CapabilityDrawer from '$lib/ui/CapabilityDrawer.svelte';

	let { children } = $props();

	const navItems = [
		{ label: 'Canvas', href: '/' },
		{ label: 'Library', href: '/library' },
		{ label: 'Runs', href: '/runs' },
		{ label: 'Settings', href: '/settings' }
	];

	const globalActions: PaletteAction[] = [
		{ id: 'nav-canvas', label: 'go to canvas', hint: '/', run: () => void goto('/') },
		{ id: 'nav-library', label: 'go to library', hint: '/library', run: () => void goto('/library') },
		{ id: 'nav-runs', label: 'go to runs', hint: '/runs', run: () => void goto('/runs') },
		{ id: 'nav-settings', label: 'go to settings', hint: '/settings', run: () => void goto('/settings') },
		{ id: 'toggle-chat', label: 'toggle agent chat', hint: '✦ agent', run: () => (ui.chatOpen = !ui.chatOpen) },
		{ id: 'toggle-caps', label: 'open capability drawer', hint: 'status', run: () => (ui.capabilitiesOpen = true) }
	];

	let paletteActions = $derived([...ui.pageActions, ...globalActions]);

	let capabilityChip = $derived.by(() => {
		if (!ui.capabilitiesChecked) return { label: 'NOT CHECKED', color: 'var(--color-capability-offline)' };
		const available = ui.capabilities.filter((c) => c.state === 'available').length;
		const offline = ui.capabilities.filter((c) => c.state === 'offline' || c.state === 'degraded').length;
		return {
			label: `${available}/${ui.capabilities.length} UP`,
			color: offline > 0 ? 'var(--color-gate-pending)' : 'var(--color-gate-approved)'
		};
	});

	function onGlobalKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			ui.paletteOpen = !ui.paletteOpen;
			return;
		}
		if (e.key === 'Escape' && !ui.paletteOpen) {
			if (ui.capabilitiesOpen) ui.capabilitiesOpen = false;
			else if (ui.chatOpen) ui.chatOpen = false;
		}
	}
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<svelte:window onkeydown={onGlobalKeydown} />

<div class="flex h-screen flex-col bg-surface-base text-text-primary">
	<!-- Top nav (48px), shared across all surfaces -->
	<header class="flex h-12 shrink-0 items-center justify-between border-b border-border-default bg-surface-base px-4">
		<div class="flex items-center gap-2.5">
			<span class="block h-2 w-2 rounded-[1px] bg-voice-1 shadow-[0_0_8px_color-mix(in_srgb,var(--color-voice-1)_45%,transparent)]"></span>
			<span class="text-[13px] font-semibold tracking-[0.06em]">CREATIVE STUDIO PRO</span>
		</div>
		<nav class="hidden items-center gap-1 md:flex" aria-label="Primary">
			{#each navItems as item (item.href)}
				{@const active = page.url.pathname === item.href}
				<a
					href={item.href}
					class={[
						'rounded-sm px-2.5 py-1 transition-colors',
						active
							? 'bg-surface-raised-2 font-medium text-text-primary'
							: 'text-text-dim hover:text-text-muted'
					]}
					aria-current={active ? 'page' : undefined}
				>
					{item.label}
				</a>
			{/each}
		</nav>
		<div class="flex items-center gap-2">
			<button type="button" class="btn btn-charm" onclick={() => (ui.chatOpen = !ui.chatOpen)}>
				<span class="charm-gradient-text font-bold">✦</span>
				Agent
			</button>
			<button
				type="button"
				class="chip meta-label cursor-pointer transition-colors hover:border-text-dim"
				style:color={capabilityChip.color}
				onclick={() => (ui.capabilitiesOpen = !ui.capabilitiesOpen)}
				title="Open Capability Drawer"
			>
				<span class="mr-1.5 block h-1.5 w-1.5 rounded-full" style:background={capabilityChip.color}></span>
				{capabilityChip.label}
			</button>
		</div>
	</header>

	<div class="min-h-0 grow">
		{@render children()}
	</div>
</div>

<AgentChat bind:open={ui.chatOpen} projectTitle={ui.activeProjectTitle} project={ui.activeProject} />
<CapabilityDrawer />
<CommandPalette bind:open={ui.paletteOpen} actions={paletteActions} />
