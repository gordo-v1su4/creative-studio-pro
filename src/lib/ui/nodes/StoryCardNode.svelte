<script lang="ts">
	/**
	 * A shot on the canvas (DESIGN.md: Canvas): the same card the grid shows, at rest. Its actions (takes, bench,
	 * hold, animate, split, exclude, references) sit in a bar that floats beside the card while it is
	 * selected, so the card itself never changes size. The story beat and prompts are in the dock's Details tab.
	 */
	import { referenceImageUrl } from '$lib/media/reference-images';
	import type { NodeProps } from '@xyflow/svelte';
	import { Handle, NodeToolbar, Position } from '@xyflow/svelte';
	import { untrack } from 'svelte';
	import type { StoryCard } from '$lib/domain/schemas';
	import type { Take } from '$lib/domain/takes';
	import ShotCard from '$lib/ui/shots/ShotCard.svelte';
	import { shotCardFacts } from '$lib/domain/shot-card';
	import Toggle from '$lib/ui/controls/Toggle.svelte';
	import { reviewSequence } from '$lib/ui/review-sequence.svelte';
	import { isUnder2K } from '$lib/domain/media';

	type StoryCardNodeData = {
		card: StoryCard | null;
		order: number;
		/** 0-based place on the spine; null when off the spine. */
		spineIndex?: number | null;
		/** Every take on the shot in creation order, rejected ones included. */
		takes?: Take[];
		pickId?: string | null;
		onPick?: (takeId: string) => void;
		onReject?: (takeId: string) => void;
		onRestore?: (takeId: string) => void;
		onBench?: (benched: boolean) => void;
		onHold?: (options: { length_s: number; push_in: boolean; fade: boolean }) => void;
		onAnimate?: () => void;
		/** A generation from this shot is still running. */
		animating?: boolean;
		/** Split a video take into a group of shot beats (scene detection). */
		onSplit?: (takeId: string) => void;
		/** The take being split right now, if any. */
		splitting?: string | null;
		/** A series episode's shot: it has reference chips (V1S-326) and can take the previous shot's last frame (V1S-328). */
		series?: boolean;
		references?: Array<{ key: string; kind: 'series' | 'previous_frame'; label: string; url: string | null }>;
		canAttachPrevious?: boolean;
		onAttachPrevious?: () => void;
		onRemoveReference?: (key: string) => void;
		onDropReference?: (pageId: string) => void;
		/** The shot code inside its project (MRN_0020), once Review Room has given it one. */
		code?: string | null;
		/** A missing shot (no take yet) plays as this text card (V1S-495). */
		slate?: { src: string; assetId: string } | null;
	};

	let { data, selected }: NodeProps = $props();
	/** Drag type the References drawer sets on a thumbnail (V1S-326). */
	const REFERENCE_DRAG = 'application/x-csp-reference';
	let referenceOver = $state(false);
	let story = $derived(data as StoryCardNodeData);
	let hasPreviousFrame = $derived((story.references ?? []).some((reference) => reference.kind === 'previous_frame'));
	let card = $derived(story.card);
	let benched = $derived(card?.benched === true);
	// 1-based place on the spine; null when the shot is unhooked from the chain.
	let number = $derived(story.spineIndex === null || story.spineIndex === undefined ? null : story.spineIndex + 1);
	let takes = $derived(story.takes ?? []);
	let pick = $derived(takes.find((take) => take.asset_id === story.pickId) ?? null);
	let rejectedCount = $derived(takes.filter((take) => take.rejected).length);
	// Rejected takes stay hidden until revealed; a revealed one can be viewed and restored, never picked.
	let showRejected = $state(false);
	// A file is being dragged over this beat: dropping it adds a take (the board handles the drop).
	let dropping = $state(false);
	let viewingId = $state<string | null>(null);
	let cycle = $derived(showRejected ? takes : takes.filter((take) => !take.rejected));
	let shown = $derived(cycle.find((take) => take.asset_id === viewingId) ?? pick);
	let shownIndex = $derived(shown ? cycle.indexOf(shown) : -1);
	let inSequence = $derived(card ? reviewSequence.position(card.card_id) : 0);

	// What you see is what plays: a selected shot follows its pick, and leaves the selection when benched.
	$effect(() => {
		const id = card?.card_id;
		const item = playItem();
		if (id) untrack(() => reviewSequence.sync(id, item));
	});

	$effect(() => {
		if (!showRejected) untrack(() => (viewingId = null));
	});

	function step(direction: -1 | 1) {
		if (cycle.length < 2) return;
		const next = cycle[(Math.max(shownIndex, 0) + direction + cycle.length) % cycle.length];
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

	// Make Hold: a still pick held as a video take (rendered locally, no credits).
	let holdOpen = $state(false);
	let holdLength = $state(3);
	let holdPushIn = $state(true);
	let holdFade = $state(false);
	let canHold = $derived(!!shown && shown === pick && pick?.kind === 'image');
	/** "Shots" arms on the first click and splits on the second. */
	let armedSplit = $state<string | null>(null);


	function openHold() {
		holdLength = Math.min(30, Math.max(0.5, (card?.duration_ms ?? 3000) / 1000));
		holdOpen = true;
	}

	function makeHold() {
		story.onHold?.({ length_s: holdLength, push_in: holdPushIn, fade: holdFade });
		holdOpen = false;
	}

	// Shift-click adds the shot's pick to the selection (click order = play order).
	function gather() {
		const item = playItem();
		if (item) reviewSequence.toggle(item);
	}

	// What the card shows at rest: the grid's facts, numbered by its shot code or its place on the spine.
	let facts = $derived.by(() => {
		if (!card) return null;
		const fallback = number ? String(number).padStart(2, '0') : '--';
		return { ...shotCardFacts(card, takes, story.pickId ?? null, story.code ?? fallback), number: fallback };
	});
	/** One note over the frame: an excluded or under-2K take, or a generation still running. */
	let tag = $derived.by(() => {
		if (shown?.rejected) return { text: 'Excluded', tone: 'bad' as const };
		if (shown && isUnder2K(shown)) return { text: 'Under 2K', tone: 'bad' as const, title: `${shown.width}×${shown.height}: under 2K on the long edge` };
		if (story.animating) return { text: 'Animating…', tone: 'warn' as const, title: 'A Seedance generation from this shot is running' };
		return null;
	});

	/** What this shot plays as: its video pick, or its text card while it is a missing shot. */
	function playItem() {
		if (!card || benched) return null;
		if (pick?.kind === 'video') return { id: card.card_id, title: card.title, src: pick.url, assetId: pick.asset_id };
		return story.slate ? { id: card.card_id, title: card.title, src: story.slate.src, assetId: story.slate.assetId } : null;
	}
</script>

<Handle type="target" position={Position.Left} />
<Handle type="source" position={Position.Right} />

{#if card && facts}
	<NodeToolbar position={Position.Bottom} offset={6}>
		<div class="bar nodrag nopan" role="toolbar" aria-label={`Actions for ${card.title}`}>
			<div class="row">
				{#if cycle.length >= 2}
					<button type="button" class="tg" onclick={() => step(-1)} aria-label={`Previous take for ${card.title}`}>‹</button>
					<span class="count" aria-live="polite" aria-label={`Take ${shownIndex + 1} of ${cycle.length}`}>Take {shownIndex + 1}/{cycle.length}</span>
					<button type="button" class="tg" onclick={() => step(1)} aria-label={`Next take for ${card.title}`}>›</button>
				{/if}
				<button type="button" class="tg" aria-pressed={benched} onclick={() => story.onBench?.(!benched)} title={benched ? 'Unbench: play this shot again' : 'Bench: keep it here but skip it'}>{benched ? 'Unbench' : 'Bench'}</button>
				{#if canHold}
					<button type="button" class="tg" aria-pressed={holdOpen} onclick={() => (holdOpen ? (holdOpen = false) : openHold())} title="Make a video take from this still (local, no credits)">Hold</button>
					<button type="button" class="tg" onclick={() => story.onAnimate?.()} aria-label={`Animate ${card.title}'s still`} title="Send this still to Seedance as the start frame (costs credits; you see the price first)">Animate</button>
				{/if}
				{#if shown && shown.kind === 'video' && !shown.rejected && !shown.source_take && story.onSplit}
					<!-- Two steps: a stray click only arms it. -->
					<button
						type="button"
						class="tg"
						aria-pressed={armedSplit === shown.asset_id}
						onclick={() => { if (armedSplit === shown.asset_id) { armedSplit = null; story.onSplit?.(shown.asset_id); } else armedSplit = shown.asset_id; }}
						onblur={() => (armedSplit = null)}
						disabled={!!story.splitting}
						aria-label={armedSplit === shown.asset_id ? `Confirm: split this take of ${card.title} into shots` : `Split this take of ${card.title} into shots`}
						title="Split this take into shots by scene detection: a new group, one card per shot"
					>{story.splitting === shown.asset_id ? 'Splitting…' : armedSplit === shown.asset_id ? 'Split?' : 'Split'}</button>
				{/if}
				{#if rejectedCount > 0}
					<button type="button" class="tg" aria-pressed={showRejected} onclick={() => (showRejected = !showRejected)}>{rejectedCount} excluded</button>
				{/if}
				{#if shown?.rejected}
					<button type="button" class="tg" onclick={restore}>Restore</button>
				{:else if shown}
					<button type="button" class="tg" onclick={reject} aria-label={`Exclude this take of ${card.title}`}>Exclude</button>
				{/if}
			</div>
			{#if holdOpen && canHold}
				<form class="row" onsubmit={(event) => { event.preventDefault(); makeHold(); }} aria-label={`Make a Hold of ${card.title}`}>
					<label class="cp">Length <input type="number" min="0.5" max="30" step="0.5" bind:value={holdLength} /></label>
					<span class="cp opt"><Toggle label="Push-in" bind:checked={holdPushIn} /> Push-in</span>
					<span class="cp opt"><Toggle label="Fade" bind:checked={holdFade} /> Fade</span>
					<button type="submit" class="key go">Make Hold</button>
				</form>
			{/if}
			{#if story.series}
				<div class="row refs" aria-label={`References on ${card.title}`}>
					{#each story.references ?? [] as reference (reference.key)}
						<span class={['ref', reference.kind === 'previous_frame' && 'prev', reference.label === 'Missing reference' && 'missing']} title={reference.kind === 'previous_frame' ? "The previous shot's last frame, attached after the other references" : reference.label}>
							{#if reference.url}<img src={referenceImageUrl(reference.url, 'small')} alt="" />{/if}
							<span class="name">{reference.label}</span>
							<button type="button" onclick={() => story.onRemoveReference?.(reference.key)} aria-label={`Remove ${reference.label} from ${card.title}`}>×</button>
						</span>
					{:else}
						<span class="cp none">No references · drag one from References</span>
					{/each}
					<button
						type="button"
						class="tg"
						onclick={() => story.onAttachPrevious?.()}
						disabled={!story.canAttachPrevious}
						aria-label={`Attach the last frame of the previous shot to ${card.title}`}
						title={story.canAttachPrevious ? (hasPreviousFrame ? "Take the previous shot's last frame again (its pick may have changed)" : "Attach the last frame of the previous shot's pick as a reference") : 'The previous shot has no pick yet'}
					>{hasPreviousFrame ? 'Prev frame ↻' : 'Prev frame'}</button>
				</div>
			{/if}
		</div>
	</NodeToolbar>
{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="node"
	ondragenter={(event) => { if (card && event.dataTransfer?.types.includes('Files')) dropping = true; if (card && story.series && event.dataTransfer?.types.includes(REFERENCE_DRAG)) referenceOver = true; }}
	ondragover={(event) => { if (card && story.series && event.dataTransfer?.types.includes(REFERENCE_DRAG)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
	ondragleave={(event) => { if (!(event.currentTarget as Element).contains(event.relatedTarget as Node)) { dropping = false; referenceOver = false; } }}
	ondrop={(event) => {
		dropping = false; referenceOver = false;
		const pageId = event.dataTransfer?.getData(REFERENCE_DRAG);
		if (card && story.series && pageId) { event.preventDefault(); event.stopPropagation(); story.onDropReference?.(pageId); }
	}}
>
	{#if card && facts}
		<ShotCard {card} {facts} {takes} onpick={(takeId) => story.onPick?.(takeId)} pick={shown} {selected} dropTarget={dropping || referenceOver} position={inSequence} draggable={false} {tag} onselect={(shift) => { if (shift) gather(); }} onopen={() => {}} />
	{:else}
		<div class="awaiting" aria-label={`Shot ${story.order + 1}, awaiting draft`}>
			<span class="cp">Awaiting story draft</span>
			<p>This slot becomes a shot when the Agent builds the story.</p>
		</div>
	{/if}
</div>

<style>
	.node { width: 240px; border-radius: 9px; background: var(--color-panel); }
	.awaiting { display: flex; aspect-ratio: 16 / 10; flex-direction: column; justify-content: center; gap: 6px; border-radius: 9px; background: var(--color-raised); padding: 0 18px; text-align: center; color: var(--color-ink-3); }
	.awaiting p { margin: 0; font-size: 11.5px; line-height: 1.5; }
	.bar { display: flex; flex-direction: column; gap: 3px; border-radius: 8px; background: var(--color-raised); padding: 4px; box-shadow: 0 10px 24px rgb(0 0 0 / 0.6); }
	.row { display: flex; align-items: center; gap: 2px; white-space: nowrap; }
	.count { padding: 0 4px; color: var(--color-ink-2); font: 10.5px var(--font-mono); }
	.row label, .opt { display: inline-flex; align-items: center; gap: 5px; padding: 0 6px; color: var(--color-ink-3); }
	.row input[type='number'] { width: 46px; height: 20px; border: 0; border-radius: 5px; background: var(--color-control); padding: 0 4px; color: var(--color-ink); font: 11px var(--font-mono); }
	.refs { max-width: 420px; flex-wrap: wrap; }
	.ref { display: inline-flex; height: 20px; align-items: center; gap: 4px; border-radius: 5px; background: var(--color-control); padding: 0 2px 0 4px; color: var(--color-ink-2); font-size: 11px; }
	.ref.prev { color: #7fb2ff; }
	.ref.missing { color: #ff7a6b; }
	.ref img { width: 22px; height: 13px; border-radius: 2px; object-fit: cover; }
	.ref .name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
	.ref button { border: 0; background: none; padding: 0 3px; color: var(--color-ink-3); font: inherit; cursor: pointer; }
	.ref button:hover { color: var(--color-ink); }
	.none { padding: 0 6px; color: var(--color-ink-3); }
</style>
