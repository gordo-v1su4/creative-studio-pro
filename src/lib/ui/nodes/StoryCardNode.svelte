<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import { Handle, Position } from '@xyflow/svelte';
	import { untrack } from 'svelte';
	import type { StoryCard } from '$lib/domain/schemas';
	import type { SpeedPoint } from '$lib/media/speed-curve';
	import ClipHoverPlayer from '$lib/ui/ClipHoverPlayer.svelte';
	import { reviewSequence } from '$lib/ui/review-sequence.svelte';

	type CardFace = 'text' | 'image' | 'video';
	type StoryCardNodeData = {
		card: StoryCard | null;
		order: number;
		imageUrl?: string | null;
		videoUrl?: string | null;
		videoAssetId?: string | null;
		videoIn?: number | null;
		videoOut?: number | null;
		videoSpeed?: SpeedPoint[] | null;
	};

	let { data, selected }: NodeProps = $props();
	let story = $derived(data as StoryCardNodeData);
	let card = $derived(story.card);
	// Open on the result: video, then image, then the beat text.
	let face = $state<CardFace>(untrack(() => (story.videoUrl ? 'video' : story.imageUrl ? 'image' : 'text')));
	const faces: CardFace[] = ['text', 'image', 'video'];
	let inSequence = $derived(card ? reviewSequence.position(card.card_id) : 0);

	// Shift-click adds the card's clip to the review sequence (click order = play order).
	function pick(event: MouseEvent) {
		if (!event.shiftKey || !card || !story.videoUrl || !story.videoAssetId) return;
		event.stopPropagation();
		reviewSequence.toggle({ id: card.card_id, title: card.title, src: story.videoUrl, assetId: story.videoAssetId });
	}
</script>

<Handle type="target" position={Position.Left} />
<Handle type="source" position={Position.Right} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<article
	onclick={pick}
	class={[
		'story-node w-[240px] overflow-hidden border bg-[#10151b]',
		inSequence ? 'border-[#f2c14e] shadow-[0_0_18px_rgba(242,193,78,.18)]' : selected ? 'border-[#55dfd5] shadow-[0_0_18px_rgba(85,223,213,.14)]' : 'border-[#26383f]'
	]}
	aria-label={card ? `Story card ${story.order + 1}, ${card.title}` : `Story card ${story.order + 1}, awaiting draft`}
>
	<header class="flex items-center gap-2 border-b border-[#24343b] px-2 py-1.5">
		{#if inSequence}<span class="bg-[#f2c14e] px-1 font-mono text-[10px] font-bold text-black" title="Sequence position">{inSequence}</span>{/if}
		<span class="font-mono text-[10px] font-bold text-[#55dfd5]">{String(story.order + 1).padStart(2, '0')}</span>
		<strong class="min-w-0 grow truncate text-[11px] text-[#bce6e8]">{card?.title ?? `Story beat ${story.order + 1}`}</strong>
		<span class="font-mono text-[9px] uppercase text-[#55747c]">{card ? `${card.duration_ms / 1000}s` : 'placeholder'}</span>
	</header>

	<nav class="nodrag grid grid-cols-3 bg-[#0b0f13] px-1 py-0.5" aria-label="Card face">
		{#each faces as item}
			<button
				type="button"
				class:active={face === item}
				class="face-tab"
				onclick={() => (face = item)}
				aria-pressed={face === item}
			>{item}</button>
		{/each}
	</nav>

	<div class="aspect-video bg-[#05070a]" aria-live="polite">
		{#key face}
			<div class="card-face h-full">
				{#if !card}
					<div class="flex h-full flex-col items-center justify-center px-6 text-center">
						<span class="font-mono text-[9px] uppercase tracking-[.12em] text-[#4f747b]">Awaiting story draft</span>
						<p class="mt-2 text-[11px] leading-5 text-[#66858c]">This slot becomes a connected story beat when NERATE builds the spine.</p>
					</div>
				{:else if face === 'text'}
					<div class="h-full overflow-auto p-3">
						<p class="text-[11px] leading-5 text-[#8eb3bb]">{card.beat}</p>
						<p class="mt-3 border-l border-[#31545a] pl-2 font-mono text-[9px] leading-4 text-[#5f848b]"><b class="text-[#55d8d0]">PURPOSE</b> · {card.purpose}</p>
					</div>
				{:else if face === 'image'}
					{#if story.imageUrl}
						<img src={story.imageUrl} alt={`${card.title} result`} class="h-full w-full object-contain" />
					{:else}
						<div class="flex h-full flex-col justify-end bg-[linear-gradient(145deg,#101a20,#0a0d12)] p-3">
							<span class="font-mono text-[9px] text-[#55d8d0]">IMAGE PROMPT</span>
							<p class="mt-2 line-clamp-6 text-[10px] leading-4 text-[#6f949c]">{card.image_prompt}</p>
						</div>
					{/if}
				{:else}
					{#if story.videoUrl}
						<ClipHoverPlayer src={story.videoUrl} label={card.title} inS={story.videoIn} outS={story.videoOut} speed={story.videoSpeed} />
					{:else}
						<div class="flex h-full flex-col justify-end bg-[linear-gradient(145deg,#111723,#090c11)] p-3">
							<span class="font-mono text-[9px] text-[#6dbff3]">VIDEO PROMPT</span>
							<p class="mt-2 line-clamp-6 text-[10px] leading-4 text-[#6f889c]">{card.video_prompt}</p>
						</div>
					{/if}
				{/if}
			</div>
		{/key}
	</div>

</article>

<style>
	.face-tab { border: 0; background: transparent; padding: 3px 4px; color: #55747c; font: 600 9px var(--font-mono); text-transform: uppercase; transition: background 120ms ease, color 120ms ease; }
	.face-tab:hover { background: #14232a; color: #84cbd0; }
	.face-tab.active { background: linear-gradient(120deg, rgba(77, 224, 208, .16), rgba(78, 174, 244, .1), rgba(118, 104, 220, .08)); color: #7de5dc; }
	.card-face { animation: face-in 140ms ease-out; }
	@keyframes face-in { from { opacity: .35; transform: translateX(4px); } }
	@media (prefers-reduced-motion: reduce) { .card-face { animation: none; } }
</style>
