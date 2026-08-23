<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import { Handle, Position } from '@xyflow/svelte';
	import type { StoryCard } from '$lib/domain/schemas';

	type CardFace = 'text' | 'image' | 'video';
	type StoryCardNodeData = {
		card: StoryCard | null;
		order: number;
		imageUrl?: string | null;
		videoUrl?: string | null;
	};

	let { data, selected }: NodeProps = $props();
	let story = $derived(data as StoryCardNodeData);
	let card = $derived(story.card);
	let face = $state<CardFace>('text');
	const faces: CardFace[] = ['text', 'image', 'video'];

	function moveFace(direction: -1 | 1) {
		const next = (faces.indexOf(face) + direction + faces.length) % faces.length;
		face = faces[next];
	}
</script>

<Handle type="target" position={Position.Left} />
<Handle type="source" position={Position.Right} />

<article
	class={[
		'story-node w-[320px] overflow-hidden border bg-[#10151b]',
		selected ? 'border-[#55dfd5] shadow-[0_0_18px_rgba(85,223,213,.14)]' : 'border-[#26383f]'
	]}
	aria-label={card ? `Story card ${story.order + 1}, ${card.title}` : `Story card ${story.order + 1}, awaiting draft`}
>
	<header class="flex items-center gap-2 border-b border-[#24343b] px-3 py-2.5">
		<span class="font-mono text-[10px] font-bold text-[#55dfd5]">{String(story.order + 1).padStart(2, '0')}</span>
		<strong class="min-w-0 grow truncate text-[12px] text-[#bce6e8]">{card?.title ?? `Story beat ${story.order + 1}`}</strong>
		<span class="font-mono text-[9px] uppercase text-[#55747c]">{card ? `${card.duration_ms / 1000}s` : 'placeholder'}</span>
	</header>

	<nav class="nodrag grid grid-cols-3 bg-[#0b0f13] p-1" aria-label="Card face">
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

	<div class="h-[184px] bg-[#0d1217]" aria-live="polite">
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
						<img src={story.imageUrl} alt={`${card.title} result`} class="h-full w-full object-cover" />
					{:else}
						<div class="flex h-full flex-col justify-end bg-[linear-gradient(145deg,#101a20,#0a0d12)] p-3">
							<span class="font-mono text-[9px] text-[#55d8d0]">IMAGE PROMPT</span>
							<p class="mt-2 line-clamp-6 text-[10px] leading-4 text-[#6f949c]">{card.image_prompt}</p>
						</div>
					{/if}
				{:else}
					{#if story.videoUrl}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video src={story.videoUrl} controls preload="metadata" class="nodrag h-full w-full object-cover"></video>
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

	<footer class="nodrag flex items-center justify-between border-t border-[#24343b] px-2 py-1.5">
		<button type="button" class="face-arrow" onclick={() => moveFace(-1)} aria-label="Previous card face">←</button>
		<span class="font-mono text-[8px] uppercase tracking-[.1em] text-[#4f7178]">{face} face</span>
		<button type="button" class="face-arrow" onclick={() => moveFace(1)} aria-label="Next card face">→</button>
	</footer>
</article>

<style>
	.face-tab { border: 0; background: transparent; padding: 5px 4px; color: #55747c; font: 600 9px var(--font-mono); text-transform: uppercase; transition: background 120ms ease, color 120ms ease; }
	.face-tab:hover { background: #14232a; color: #84cbd0; }
	.face-tab.active { background: linear-gradient(120deg, rgba(77, 224, 208, .16), rgba(78, 174, 244, .1), rgba(118, 104, 220, .08)); color: #7de5dc; }
	.face-arrow { border: 0; background: transparent; padding: 2px 8px; color: #668d95; }
	.face-arrow:hover { background: #15242a; color: #7de5dc; }
	.card-face { animation: face-in 140ms ease-out; }
	@keyframes face-in { from { opacity: .35; transform: translateX(4px); } }
	@media (prefers-reduced-motion: reduce) { .card-face { animation: none; } }
</style>
