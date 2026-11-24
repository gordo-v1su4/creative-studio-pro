<script lang="ts">
	/**
	 * A shot at rest (DESIGN.md: Shot card): its pick as a 16:9 frame, one upright mark per take,
	 * then title, number, status and version. Selecting it changes its fill and nothing else.
	 */
	import type { StoryCard } from '$lib/domain/schemas';
	import type { Take } from '$lib/domain/takes';
	import type { ShotCardFacts } from '$lib/domain/shot-card';
	import { referenceImageUrl } from '$lib/media/reference-images';
	import { posterUrl, stripUrl } from '$lib/media/gpu/clipBanks';
	import { stripFrameStyle, stripIndexInSpan, warmStrip } from '$lib/media/strips';
	import { SHOT_DRAG } from '$lib/ui/shots/SelectionStrip.svelte';
	import ClipHoverPlayer from '$lib/ui/ClipHoverPlayer.svelte';

	let { card, facts, pick, selected = false, position = 0, onselect, onopen }: {
		card: StoryCard;
		facts: ShotCardFacts;
		pick: Take | null;
		selected?: boolean;
		/** Its place in the selection (1 = first), or 0 when it is not in it. */
		position?: number;
		/** Clicked; `gather` is true for a shift-click, which also adds it to the selection or takes it out. */
		onselect: (gather: boolean) => void;
		/** Asked to play the shot in the viewer (double-click, Enter or Space). */
		onopen: () => void;
	} = $props();

	// Hover-scrub: moving across the frame walks the pick's kept span through its frame strip, with no video decoded.
	const strip = $derived(pick?.kind === 'video' ? stripUrl(pick.url) : null);
	const poster = $derived(pick?.kind === 'video' ? posterUrl(pick.url, pick.in_s ?? 0) : null);
	/** How far across the frame the pointer is (0 to 1), or null when it is not over it. */
	let along = $state<number | null>(null);
	const shape = $derived(pick?.width && pick.height ? pick.width / pick.height : 16 / 9);

	function scrub(event: PointerEvent) {
		if (event.pointerType === 'touch') return;
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
		along = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
	}

	/** Fetches the strip once the card is on screen, so the first hover does not wait for it. */
	function onScreen(node: HTMLElement) {
		if (typeof IntersectionObserver === 'undefined') return;
		const watch = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) warmStrip(strip); }, { rootMargin: '200px' });
		watch.observe(node);
		return { destroy: () => watch.disconnect() };
	}
</script>

<div
	class={['shot', selected && 'selected', card.benched && 'benched']}
	data-status={facts.status}
	role="button"
	aria-label={`Shot ${facts.number}, ${card.title}, ${facts.statusLabel}`}
	aria-pressed={selected}
	tabindex="0"
	draggable="true"
	ondragstart={(event) => { event.dataTransfer?.setData(SHOT_DRAG, card.card_id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copyMove'; along = null; }}
	onclick={(event) => onselect(event.shiftKey)}
	ondblclick={(event) => { if (!event.shiftKey) onopen(); }}
	onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onselect(false); onopen(); } }}
	use:onScreen
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="frame" onpointermove={strip ? scrub : undefined} onpointerleave={() => (along = null)}>
		{#if pick?.kind === 'video' && strip && poster}
			<img src={poster} alt="" draggable="false" loading="lazy" decoding="async" />
			{#if along !== null}
				<i class="scrubbed" style={`${stripFrameStyle(strip, stripIndexInSpan(along, pick.duration_s, pick.in_s, pick.out_s))} aspect-ratio: ${shape}; ${shape >= 16 / 9 ? 'height' : 'width'}: 100%;`}></i>
				<i class="along" style:width={`${along * 100}%`}></i>
			{/if}
		{:else if pick?.kind === 'video'}
			<ClipHoverPlayer src={pick.url} label={card.title} maxHeight={270} inS={pick.in_s} outS={pick.out_s} speed={pick.speed} />
		{:else if pick}
			<img src={referenceImageUrl(pick.url, 'small')} alt="" draggable="false" loading="lazy" decoding="async" />
		{:else}
			<span class="none">No take · planned {facts.length}</span>
		{/if}
		{#if facts.takes.length > 1}
			<span class="marks" aria-hidden="true">{#each facts.takes as take (take.id)}<i class:pick={take.pick} class:excluded={take.excluded}></i>{/each}</span>
		{/if}
		{#if position}<span class="place" title="Its place in the selection">{position}</span>{/if}
		{#if pick}<span class="length">{facts.length}</span>{/if}
	</div>
	<div class="line"><span class="title">{card.title}</span><span class="code">{facts.number}</span></div>
	<div class="line cp">
		<span class="status">{facts.statusLabel}</span>
		{#if card.benched}<span class="bench">Benched</span>{/if}
		{#if facts.takesLabel}<span>{facts.takesLabel}</span>{/if}
		<span class="code end">{facts.version}</span>
	</div>
</div>

<style>
	.shot { display: flex; min-width: 0; flex-direction: column; gap: 4px; border-radius: 8px; padding: 5px 5px 6px; cursor: default; user-select: none; }
	.shot.selected { background: var(--color-selected); }
	.shot.benched .frame { opacity: 0.45; }
	.shot:focus-visible { outline: 2px solid var(--color-teal); outline-offset: -2px; }
	.frame { position: relative; display: flex; aspect-ratio: 16 / 9; align-items: center; justify-content: center; overflow: hidden; border-radius: 5px; background: var(--color-raised); }
	.frame img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
	.scrubbed { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: var(--color-raised); background-repeat: no-repeat; pointer-events: none; }
	.along { position: absolute; bottom: 0; left: 0; height: 2px; background: linear-gradient(90deg, #123a35, #8be0c6); pointer-events: none; }
	.none { color: var(--color-ink-3); font-size: 11.5px; white-space: nowrap; }
	.marks { position: absolute; bottom: 5px; left: 5px; display: flex; gap: 2px; pointer-events: none; }
	.marks i { width: 3px; height: 9px; background: rgb(255 255 255 / 0.35); }
	.marks i.pick { background: var(--color-teal); }
	.marks i.excluded { background: rgb(255 255 255 / 0.14); }
	.length { position: absolute; right: 4px; bottom: 4px; border-radius: 3px; background: rgb(0 0 0 / 0.72); padding: 0 4px; color: var(--color-ink); font: 10.5px var(--font-mono); pointer-events: none; }
	.place { position: absolute; top: 4px; left: 4px; border-radius: 3px; background: var(--color-teal-deep); padding: 0 5px; color: var(--color-teal-ink); font: 10.5px var(--font-mono); pointer-events: none; }
	.line { display: flex; align-items: baseline; gap: 8px; overflow: hidden; padding: 0 1px; white-space: nowrap; }
	.title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; color: var(--color-ink); font-size: 12px; }
	.shot.selected .title { color: var(--color-teal-ink); }
	.code { color: var(--color-ink-3); font: 10.5px var(--font-mono); letter-spacing: 0.01em; }
	.line.cp { gap: 10px; color: var(--color-ink-3); }
	.end { margin-left: auto; }
	.status { color: var(--color-ink-3); }
	.shot[data-status='approved'] .status { color: var(--color-teal); }
	.shot[data-status='awaiting'] .status { color: var(--color-amber); }
	.shot[data-status='changes'] .status { color: #ff7a6b; }
	.shot[data-status='progress'] .status { color: #7fb2ff; }
	.bench { color: var(--color-amber); }
</style>
