<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import type { PaletteAction } from '$lib/ui/app-state.svelte';

	let {
		open = $bindable(false),
		actions = []
	}: { open?: boolean; actions?: PaletteAction[] } = $props();

	let query = $state('');
	let activeIndex = $state(0);

	let filtered = $derived(
		actions.filter((a) => a.label.toLowerCase().includes(query.trim().toLowerCase()))
	);

	function close() {
		open = false;
		query = '';
		activeIndex = 0;
	}

	function runAction(action: PaletteAction | undefined) {
		if (!action || action.disabled) return;
		close();
		action.run?.();
	}

	function onInputKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			activeIndex = Math.min(activeIndex + 1, filtered.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIndex = Math.max(activeIndex - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			runAction(filtered[activeIndex]);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			close();
		}
	}
</script>

{#if open}
	<!-- Backdrop -->
	<button
		type="button"
		class="fixed inset-0 z-50 cursor-default bg-black/50 backdrop-blur-[2px]"
		transition:fade={{ duration: 160 }}
		onclick={close}
		aria-label="Close command palette"
		tabindex="-1"
	></button>

	<div
		class="charm-ring fixed left-1/2 top-[18vh] z-50 w-[440px] max-w-[92vw] -translate-x-1/2 rounded-md bg-surface-raised shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
		transition:fly={{ y: -14, duration: 240, easing: quintOut }}
		role="dialog"
		aria-label="Command palette"
	>
		<div class="flex items-center gap-2 border-b border-border-subtle px-3.5 py-3">
			<span class="charm-gradient-text font-mono text-[13px] font-bold">❯</span>
			<input
				{@attach (node: HTMLInputElement) => node.focus()}
				bind:value={query}
				oninput={() => (activeIndex = 0)}
				onkeydown={onInputKeydown}
				class="grow bg-transparent font-mono text-[12px] text-text-primary outline-none placeholder:text-text-dim"
				style="caret-color: var(--color-charm-mint)"
				placeholder="type a command…"
				aria-label="Search commands"
			/>
			<span class="meta-label text-text-dim">⌘K</span>
		</div>

		<ul class="max-h-[280px] overflow-y-auto p-1.5" role="listbox">
			{#each filtered as action, i (action.id)}
				<li role="option" aria-selected={i === activeIndex}>
					<button
						type="button"
						class={[
							'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left font-mono text-[12px] transition-colors',
							action.disabled
								? 'cursor-not-allowed text-text-dim'
								: i === activeIndex
									? 'bg-[color-mix(in_srgb,var(--color-charm-purple)_9%,var(--color-surface-raised-2))] text-text-primary'
									: 'text-text-muted hover:bg-surface-raised-2'
						]}
						onclick={() => runAction(action)}
						onmouseenter={() => {
							if (!action.disabled) activeIndex = i;
						}}
						disabled={action.disabled}
					>
						<span
							class={[
								'font-bold',
								i === activeIndex && !action.disabled ? 'charm-gradient-text' : 'text-text-dim'
							]}
						>
							{i === activeIndex && !action.disabled ? '❯' : '·'}
						</span>
						{action.label}
						<span class="grow"></span>
						{#if action.hint}
							<span class="meta-label text-text-dim">{action.hint}</span>
						{/if}
					</button>
				</li>
			{:else}
				<li class="px-3 py-4 text-center font-mono text-[12px] text-text-dim">no matches ⠿</li>
			{/each}
		</ul>

		<div
			class="flex items-center justify-between border-t border-border-subtle px-3.5 py-2 font-mono text-[10px] tracking-[0.06em] text-text-dim"
		>
			<span><b class="text-text-muted">↑↓</b> navigate · <b class="text-charm-mint">enter</b> run</span>
			<span><b class="text-text-muted">esc</b> close</span>
		</div>
	</div>
{/if}
