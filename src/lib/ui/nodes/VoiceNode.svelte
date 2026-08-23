<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import { Handle, Position } from '@xyflow/svelte';
	import type { Voice } from '$lib/domain/schemas';
	import { voiceStatusColor, voiceSurfaceStatus } from '$lib/ui/voice-display';

	let { data, selected }: NodeProps = $props();
	let voice = $derived(data as Voice);
	let surface = $derived(voiceSurfaceStatus(voice));
	let showRaw = $state(false);
</script>

<Handle type="target" position={Position.Top} />

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
			Voice
		</span>
		<span class="grow"></span>
		<span class="chip meta-label" style:color={voiceStatusColor[surface]} style:border-color="color-mix(in srgb, {voiceStatusColor[surface]} 55%, var(--color-border-default))">
			{surface}
		</span>
	</div>
	<h2 class="mt-3 text-[15px] font-semibold leading-snug">{voice.label}</h2>
	<p class="mt-1 font-mono text-[11px] text-text-dim">{voice.provider} · {voice.raycast_agent}</p>

	{#if voice.title}
		<p class="mt-2 text-[13px] font-medium">{voice.title}</p>
	{/if}
	{#if voice.logline}
		<p class="mt-1 line-clamp-3 text-text-muted">{voice.logline}</p>
	{:else if voice.raw_text}
		<p class="mt-1 line-clamp-3 text-text-muted">{voice.raw_text}</p>
	{:else if voice.error}
		<p class="mt-1 text-gate-failed">{voice.error}</p>
	{:else}
		<p class="mt-1 text-text-dim">Waiting for a verbatim reply from the selected Creative Room provider.</p>
	{/if}

	{#if voice.parse_errors.length > 0}
		<ul class="mt-2 grid gap-1">
			{#each voice.parse_errors as err, i (i)}
				<li class="text-[12px] text-gate-quoted">{err}</li>
			{/each}
		</ul>
	{/if}

	<div class="mt-3 flex items-center gap-2">
		<span class="chip meta-label text-gate-pending">DRAFT — not for Studio</span>
		<span class="grow"></span>
		{#if voice.raw_text}
			<button type="button" class="btn px-2 py-1" onclick={() => (showRaw = !showRaw)}>
				{showRaw ? 'Hide raw' : 'Raw'}
			</button>
		{/if}
	</div>

	{#if showRaw && voice.raw_text}
		<pre class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-sm border border-border-subtle bg-surface-base p-2 font-mono text-[11px] text-text-muted">{voice.raw_text}</pre>
	{/if}

	{#if voice.content_hash}
		<div class="meta-label mt-2 truncate text-text-dim" title={voice.content_hash}>sha {voice.content_hash.slice(0, 12)}</div>
	{/if}
</div>
