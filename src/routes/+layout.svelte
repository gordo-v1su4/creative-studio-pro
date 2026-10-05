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
	import CapabilityChip from '$lib/ui/CapabilityChip.svelte';

	let { children } = $props();

	const navItems = [
		{ label: 'Project', href: '/' },
		{ label: 'Series', href: '/series' },
		{ label: 'Watch', href: '/watch' },
		{ label: 'Library', href: '/library' },
		{ label: 'Runs', href: '/runs' },
		{ label: 'Settings', href: '/settings' }
	];

	const globalActions: PaletteAction[] = [
		{ id: 'nav-canvas', label: 'go to project', hint: '/', run: () => void goto('/') },
		{ id: 'nav-library', label: 'go to library', hint: '/library', run: () => void goto('/library') },
		{ id: 'nav-runs', label: 'go to runs', hint: '/runs', run: () => void goto('/runs') },
		{ id: 'nav-settings', label: 'go to settings', hint: '/settings', run: () => void goto('/settings') },
		{ id: 'toggle-chat', label: 'toggle the Agent', hint: '✦ agent', run: () => { ui.chatMode = 'focus'; ui.chatOpen = !ui.chatOpen; } },
		{ id: 'toggle-caps', label: 'open capability drawer', hint: 'status', run: () => (ui.capabilitiesOpen = true) }
	];

	let paletteActions = $derived([...ui.pageActions, ...globalActions]);
	/** The public watch pages: read-only, no studio navigation, no Agent. */
	const watching = $derived(page.url.pathname === '/watch' || page.url.pathname.startsWith('/watch/'));

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

<svelte:window onkeydown={(event) => { if (!watching) onGlobalKeydown(event); }} />

{#if watching}
	<div class="flex h-screen flex-col bg-surface-base text-text-primary">
		<header class="flex h-12 shrink-0 items-center border-b border-border-default bg-surface-base px-4 max-sm:px-3">
			<a href="/watch" class="flex min-w-0 items-center gap-2.5">
				<span class="block h-2 w-2 shrink-0 rounded-[1px] bg-voice-1 shadow-[0_0_8px_color-mix(in_srgb,var(--color-voice-1)_45%,transparent)]"></span>
				<span class="truncate whitespace-nowrap text-[12px] font-semibold uppercase tracking-[0.22em] text-[#b8c4c8] max-sm:text-[11px] max-sm:tracking-[0.16em]">Creative Studio Pro</span>
			</a>
			<span class="ml-3 text-[11px] uppercase tracking-[0.16em] text-text-dim">Watch</span>
			{#if !page.data.publicSite}
				<!-- On the operator's machine only: the way back into the studio (visitors never see it). -->
				<a href="/" class="ml-auto shrink-0 rounded-sm border border-border-default px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-text-dim transition-colors hover:text-text-primary">← Studio</a>
			{/if}
		</header>
		<div class="min-h-0 grow overflow-y-auto">{@render children()}</div>
	</div>
{:else}
<div class="flex h-screen flex-col bg-surface-base text-text-primary">
	<!-- The project screen carries its own single navigation bar; other pages share this one. -->
	{#if page.url.pathname !== '/'}
		<header class="flex h-12 shrink-0 items-center border-b border-border-default bg-surface-base px-4 max-sm:px-3">
			<a href="/" class="flex min-w-0 items-center gap-2.5">
				<span class="block h-2 w-2 shrink-0 rounded-[1px] bg-voice-1 shadow-[0_0_8px_color-mix(in_srgb,var(--color-voice-1)_45%,transparent)]"></span>
				<span class="truncate whitespace-nowrap text-[12px] font-semibold uppercase tracking-[0.22em] text-[#b8c4c8] max-sm:text-[11px] max-sm:tracking-[0.16em]">Creative Studio Pro</span>
			</a>
			<nav class="ml-6 hidden items-center gap-1 md:flex" aria-label="Primary">
				{#each navItems as item (item.href)}
					{@const active = page.url.pathname === item.href}
					<a href={item.href} class={['rounded-sm px-2.5 py-1 transition-colors', active ? 'bg-surface-raised-2 font-medium text-text-primary' : 'text-text-dim hover:text-text-muted']} aria-current={active ? 'page' : undefined}>{item.label}</a>
				{/each}
			</nav>
			<div class="ml-auto flex shrink-0 items-center gap-2 pl-3">
				<button type="button" class="agent-key" title="The Agent: your assistant for this project" onclick={() => { ui.chatMode = 'focus'; ui.chatOpen = !ui.chatOpen; }}>
					<span class="glyph" aria-hidden="true">✦</span>Agent
				</button>
				<!-- The capability status is in the command palette too; on a phone it gives the header its room back. -->
				<span class="max-sm:hidden"><CapabilityChip /></span>
			</div>
		</header>
		<!-- Narrow screens: the page links as their own scrolling row under the header. -->
		<nav class="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border-default bg-surface-base px-2 md:hidden" aria-label="Primary">
			{#each navItems as item (item.href)}
				{@const active = page.url.pathname === item.href}
				<a href={item.href} class={['shrink-0 rounded-sm px-2.5 py-1 text-[13px] transition-colors', active ? 'bg-surface-raised-2 font-medium text-text-primary' : 'text-text-dim hover:text-text-muted']} aria-current={active ? 'page' : undefined}>{item.label}</a>
			{/each}
		</nav>
	{/if}

	<div class="min-h-0 grow">
		{@render children()}
	</div>
</div>

<AgentChat bind:open={ui.chatOpen} projectTitle={ui.activeProjectTitle} project={ui.activeProject} />
<CapabilityDrawer />
<CommandPalette bind:open={ui.paletteOpen} actions={paletteActions} />
{/if}
