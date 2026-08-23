<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import { Handle, Position } from '@xyflow/svelte';
	import type { CatalogSnapshot, CreativeRoomRun, Seed } from '$lib/domain/schemas';

	type SeedNodeData = Seed & {
		projectVersion: number;
		stageId: string;
		catalog: CatalogSnapshot | null;
		room: CreativeRoomRun | null;
		catalogBusy?: boolean;
		roomBusy?: boolean;
		actionError?: string | null;
		onHarvest?: () => void;
		onReshuffle?: () => void;
		onRun?: () => void;
	};

	let { data, selected }: NodeProps = $props();
	let seed = $derived(data as SeedNodeData);
	let catalog = $derived(seed.catalog);
	let shortfallSlots = $derived(
		catalog ? Array.from({ length: catalog.shortfall }, (_, i) => `shortfall-${i}`) : []
	);
	let briefReady = $derived(seed.brief.trim().length >= 20);
	let roomActive = $derived(seed.room?.status === 'queued' || seed.room?.status === 'running');
	let canRun = $derived(Boolean(catalog && catalog.selected.length > 0 && briefReady && !roomActive && !seed.roomBusy));
</script>

<Handle type="source" position={Position.Bottom} />

<div
	class={[
		'w-[320px] max-w-full rounded-md border bg-surface-raised p-3.5 transition-[border-color,box-shadow] duration-150',
		selected
			? 'border-focus-ring shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-focus-ring)_35%,transparent),0_0_18px_color-mix(in_srgb,var(--color-focus-ring)_14%,transparent)]'
			: 'border-border-default shadow-[0_2px_10px_rgba(0,0,0,0.35)] hover:border-text-dim'
	]}
>
	<div class="flex items-center gap-2">
		<span class="meta-label flex items-center gap-1.5">
			<span class="block h-1.5 w-1.5 rounded-[1px] bg-voice-1"></span>
			Seed · {seed.stageId}
		</span>
		<span class="grow"></span>
		<span
			class="chip meta-label border-[color-mix(in_srgb,var(--color-gate-pending)_55%,var(--color-border-default))] bg-[color-mix(in_srgb,var(--color-gate-pending)_8%,transparent)] text-gate-pending"
		>
			{seed.stageId}
		</span>
	</div>
	<h2 class="mt-3 text-[15px] font-semibold leading-snug">{seed.title || 'Untitled creative spurt'}</h2>
	<p class="mt-1 line-clamp-3 text-text-muted">
		{seed.brief || 'Drop a rough idea. Exact model labels appear only after the selected Creative Room provider returns a catalog.'}
	</p>
	<div class="my-3 h-px bg-border-subtle"></div>
	<div class="flex items-center gap-2">
		<div class="meta-label">
			Live roster · requested {catalog?.requested_count ?? 5}
		</div>
		<span class="grow"></span>
		{#if catalog}
			<span class="meta-label text-text-dim">{catalog.selected.length} of {catalog.models.length}</span>
		{/if}
	</div>
	<div class="mt-2 flex flex-wrap gap-1.5">
		{#if catalog}
			{#each catalog.selected as slot (slot.label)}
				<span class={['chip meta-label', slot.pinned ? 'border-border-default text-text-muted' : 'border-border-subtle text-text-muted']}>
					{slot.pinned ? `PINNED · ${slot.label}` : slot.label}
				</span>
			{/each}
			{#each shortfallSlots as slot (slot)}
				<span class="chip meta-label border-dashed border-border-subtle text-text-dim">shortfall</span>
			{/each}
		{:else}
			<span class="chip meta-label border-dashed border-border-subtle text-text-dim">awaiting catalog</span>
		{/if}
	</div>
	{#if catalog && catalog.shortfall > 0}
		<p class="mt-2 text-[12px] text-text-dim">
			Bridge returned {catalog.models.length} voice{catalog.models.length === 1 ? '' : 's'}; requested {catalog.requested_count}.
		</p>
	{/if}
	{#if catalog}
		<p class="mt-2 font-mono text-[10px] text-text-dim">
			{catalog.bridge_version} · {catalog.source} · {new Date(catalog.harvested_at).toLocaleTimeString()}
		</p>
	{/if}
	{#if seed.actionError}
		<p class="mt-2 text-[12px] text-gate-failed" role="alert">{seed.actionError}</p>
	{/if}
	<div class="mt-3.5 flex flex-wrap gap-2">
		<button type="button" class="btn" onclick={() => seed.onHarvest?.()} disabled={seed.catalogBusy}>
			{seed.catalogBusy ? 'Harvesting…' : catalog ? 'Refresh catalog' : 'Harvest catalog'}
		</button>
		<button type="button" class="btn" onclick={() => seed.onReshuffle?.()} disabled={!catalog || seed.catalogBusy}>
			Reshuffle
		</button>
		<button
			type="button"
			class="btn"
			onclick={() => seed.onRun?.()}
			disabled={!canRun}
			title={!catalog ? 'Harvest a catalog first' : !briefReady ? 'Brief needs 20+ characters' : roomActive ? 'Run already in flight' : 'Dispatch through the selected Creative Room provider'}
		>
			{seed.roomBusy ? 'Dispatching…' : roomActive ? 'Capturing…' : 'Run creative room'}
		</button>
	</div>
</div>
