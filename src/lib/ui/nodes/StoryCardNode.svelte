<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import { Handle, Position } from '@xyflow/svelte';
	import { untrack } from 'svelte';
	import type { StoryCard } from '$lib/domain/schemas';
	import type { Take } from '$lib/domain/takes';
	import ClipHoverPlayer from '$lib/ui/ClipHoverPlayer.svelte';
	import { reviewSequence } from '$lib/ui/review-sequence.svelte';

	type CardFace = 'beat' | 'take';
	type StoryCardNodeData = {
		card: StoryCard | null;
		order: number;
		/** Every take on the beat in creation order, rejected ones included. */
		takes?: Take[];
		pickId?: string | null;
		onPick?: (takeId: string) => void;
		onReject?: (takeId: string) => void;
		onRestore?: (takeId: string) => void;
		onBench?: (benched: boolean) => void;
	};

	let { data, selected }: NodeProps = $props();
	let story = $derived(data as StoryCardNodeData);
	let card = $derived(story.card);
	let benched = $derived(card?.benched === true);
	let takes = $derived(story.takes ?? []);
	let pick = $derived(takes.find((take) => take.asset_id === story.pickId) ?? null);
	let rejectedCount = $derived(takes.filter((take) => take.rejected).length);
	// Rejected takes stay hidden until revealed; a revealed one can be viewed and restored, never picked.
	let showRejected = $state(false);
	let viewingId = $state<string | null>(null);
	let cycle = $derived(showRejected ? takes : takes.filter((take) => !take.rejected));
	let shown = $derived(cycle.find((take) => take.asset_id === viewingId) ?? pick);
	let shownIndex = $derived(shown ? cycle.indexOf(shown) : -1);
	// Open on the result when there is one, else the beat text.
	let face = $state<CardFace>(untrack(() => (story.pickId ? 'take' : 'beat')));
	const faces: CardFace[] = ['beat', 'take'];
	let inSequence = $derived(card ? reviewSequence.position(card.card_id) : 0);

	// What you see is what plays: a selected beat follows its pick, and leaves the selection when benched.
	$effect(() => {
		const id = card?.card_id;
		const item = card && !benched && pick?.kind === 'video' ? { id: card.card_id, title: card.title, src: pick.url, assetId: pick.asset_id } : null;
		if (id) untrack(() => reviewSequence.sync(id, item));
	});

	$effect(() => {
		if (!showRejected) untrack(() => (viewingId = null));
	});

	function step(direction: -1 | 1) {
		if (cycle.length < 2) return;
		const next = cycle[(Math.max(shownIndex, 0) + direction + cycle.length) % cycle.length];
		face = 'take';
		if (next.rejected) { viewingId = next.asset_id; return; }
		viewingId = null;
		story.onPick?.(next.asset_id);
	}

	function reject() {
		if (!shown || shown.rejected) return;
		story.onReject?.(shown.asset_id);
	}

	function restore() {
		if (!shown?.rejected) return;
		story.onRestore?.(shown.asset_id);
		viewingId = null;
	}

	// Shift-click adds the beat's pick to the review selection (click order = play order).
	function select(event: MouseEvent) {
		if (!event.shiftKey || !card || benched || pick?.kind !== 'video') return;
		event.stopPropagation();
		reviewSequence.toggle({ id: card.card_id, title: card.title, src: pick.url, assetId: pick.asset_id });
	}
</script>

<Handle type="target" position={Position.Left} />
<Handle type="source" position={Position.Right} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<article
	onclick={select}
	class={[
		'story-node w-[240px] overflow-hidden border bg-[#10151b]',
		benched && 'benched',
		inSequence ? 'border-[#f2c14e] shadow-[0_0_18px_rgba(242,193,78,.18)]' : selected ? 'border-[#55dfd5] shadow-[0_0_18px_rgba(85,223,213,.14)]' : 'border-[#26383f]'
	]}
	aria-label={card ? `Story card ${story.order + 1}, ${card.title}` : `Story card ${story.order + 1}, awaiting draft`}
>
	<header class="flex items-center gap-2 border-b border-[#24343b] px-2 py-1.5">
		{#if inSequence}<span class="bg-[#f2c14e] px-1 font-mono text-[10px] font-bold text-black" title="Sequence position">{inSequence}</span>{/if}
		<span class="font-mono text-[10px] font-bold text-[#55dfd5]">{String(story.order + 1).padStart(2, '0')}</span>
		<strong class="min-w-0 grow truncate text-[11px] text-[#bce6e8]">{card?.title ?? `Story beat ${story.order + 1}`}</strong>
		{#if benched}<span class="benched-mark">Benched</span>{/if}
		<span class="font-mono text-[9px] uppercase text-[#55747c]">{card ? `${card.duration_ms / 1000}s` : 'placeholder'}</span>
		{#if card}
			<button
				type="button"
				class="nodrag take-btn"
				onclick={(event) => { event.stopPropagation(); story.onBench?.(!benched); }}
				aria-pressed={benched}
				aria-label={benched ? `Unbench ${card.title}` : `Bench ${card.title}`}
				title={benched ? 'Unbench: play this beat again' : 'Bench: keep it here but skip it'}
			>{benched ? 'Unbench' : 'Bench'}</button>
		{/if}
	</header>

	<nav class="nodrag grid grid-cols-2 bg-[#0b0f13] px-1 py-0.5" aria-label="Card face">
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
			<div class="card-face relative h-full">
				{#if !card}
					<div class="flex h-full flex-col items-center justify-center px-6 text-center">
						<span class="font-mono text-[9px] uppercase tracking-[.12em] text-[#4f747b]">Awaiting story draft</span>
						<p class="mt-2 text-[11px] leading-5 text-[#66858c]">This slot becomes a connected story beat when the Agent builds the spine.</p>
					</div>
				{:else if face === 'beat'}
					<div class="h-full overflow-auto p-3">
						<p class="text-[11px] leading-5 text-[#8eb3bb]">{card.beat}</p>
						<p class="mt-3 border-l border-[#31545a] pl-2 font-mono text-[9px] leading-4 text-[#5f848b]"><b class="text-[#55d8d0]">PURPOSE</b> · {card.purpose}</p>
					</div>
				{:else if shown}
					{#key shown.asset_id}
						<div class={['h-full', shown.rejected && 'opacity-40']}>
							{#if shown.kind === 'video'}
								<ClipHoverPlayer src={shown.url} label={card.title} inS={shown.in_s} outS={shown.out_s} speed={shown.speed} />
							{:else}
								<img src={shown.url} alt={`${card.title} take`} class="h-full w-full object-contain" />
							{/if}
						</div>
					{/key}
					{#if shown.rejected}<span class="rejected-mark">Rejected</span>{/if}
				{:else}
					<div class="flex h-full flex-col justify-end bg-[#0a0d12] p-3">
						<span class="font-mono text-[9px] text-[#6dbff3]">VIDEO PROMPT</span>
						<p class="mt-2 line-clamp-6 text-[10px] leading-4 text-[#6f889c]">{card.video_prompt}</p>
					</div>
				{/if}
			</div>
		{/key}
	</div>

	{#if card && (cycle.length >= 2 || shown || rejectedCount > 0)}
		<footer class="nodrag flex items-center gap-1 border-t border-[#24343b] px-1 py-0.5">
			{#if cycle.length >= 2}
				<button type="button" class="take-btn" onclick={() => step(-1)} aria-label={`Previous take for ${card.title}`}>‹</button>
				<span class="font-mono text-[9px] text-[#84cbd0]" aria-live="polite">Take {shownIndex + 1} of {cycle.length}</span>
				<button type="button" class="take-btn" onclick={() => step(1)} aria-label={`Next take for ${card.title}`}>›</button>
			{/if}
			<span class="grow"></span>
			{#if rejectedCount > 0}
				<button type="button" class="take-btn" class:active={showRejected} onclick={() => (showRejected = !showRejected)} aria-pressed={showRejected}>{rejectedCount} rejected</button>
			{/if}
			{#if shown?.rejected}
				<button type="button" class="take-btn" onclick={restore}>Restore</button>
			{:else if shown}
				<button type="button" class="take-btn" onclick={reject} aria-label={`Reject this take of ${card.title}`}>Reject</button>
			{/if}
		</footer>
	{/if}
</article>

<style>
	.face-tab { border: 0; background: transparent; padding: 3px 4px; color: #55747c; font: 600 9px var(--font-mono); text-transform: uppercase; transition: background 120ms ease, color 120ms ease; }
	.face-tab:hover { background: #14232a; color: #84cbd0; }
	.face-tab.active { background: linear-gradient(120deg, rgba(77, 224, 208, .16), rgba(78, 174, 244, .1), rgba(118, 104, 220, .08)); color: #7de5dc; }
	.take-btn { border: 0; background: transparent; padding: 2px 6px; color: #55747c; font: 600 9px var(--font-mono); text-transform: uppercase; transition: background 120ms ease, color 120ms ease; }
	.take-btn:hover, .take-btn.active { background: #14232a; color: #84cbd0; }
	.rejected-mark { position: absolute; top: 6px; left: 6px; border: 1px solid #6b3a3a; background: #1a0f10; padding: 1px 5px; color: #d98a8a; font: 600 9px var(--font-mono); text-transform: uppercase; }
	.benched > :not(header) { opacity: .4; }
	.benched header { opacity: .7; }
	.benched-mark { border: 1px solid #4a4f3a; padding: 0 4px; color: #c9c08a; font: 600 9px var(--font-mono); text-transform: uppercase; }
	.card-face { animation: face-in 140ms ease-out; }
	@keyframes face-in { from { opacity: .35; transform: translateX(4px); } }
	@media (prefers-reduced-motion: reduce) { .card-face { animation: none; } }
</style>
