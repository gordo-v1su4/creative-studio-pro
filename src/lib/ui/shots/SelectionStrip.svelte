<script lang="ts" module>
	/** What a dragged shot carries, so the strip (and later the canvas and outline) can tell it from a file. */
	export const SHOT_DRAG = 'application/x-csp-shot';
</script>

<script lang="ts">
	/**
	 * The selection strip (CONTEXT.md: Selection): the shots gathered to be played together, in the order they are
	 * arranged. Shots arrive by shift-click, by Add, or by dragging a card here; dragging inside the strip reorders.
	 * On a focused entry ↑↓ auditions another take (the pick is not touched), ⌥←→ moves it, ⌫ takes it out.
	 */
	import type { Project } from '$lib/domain/schemas';
	import { pickFor, takesFor } from '$lib/domain/takes';
	import { itemSeconds, selectionSummary, type ReadLengths } from '$lib/domain/selection';
	import { playItemFor, isSlateId } from '$lib/domain/slate';
	import { shotCardFacts, takeLabel } from '$lib/domain/shot-card';
	import { step } from '$lib/domain/viewer-keys';
	import { posterUrl } from '$lib/media/gpu/clipBanks';
	import { reviewSequence } from '$lib/ui/review-sequence.svelte';

	let { project, selectedId, read = {}, busy = false, note = '', onselect, onplay, onpush }: {
		/** The project as the grid shows it. */
		project: Project;
		/** The shot selected in the grid ('' when none): Add puts it in, Remove takes it out. */
		selectedId: string;
		/** Lengths read from the files, for takes whose length was never recorded. */
		read?: ReadLengths;
		busy?: boolean;
		/** A line shown in place of the count: what a push did, or why it could not. */
		note?: string;
		onselect: (cardId: string) => void;
		onplay: () => void;
		onpush: () => void;
	} = $props();

	const items = $derived(reviewSequence.items);
	const cardOf = (id: string) => project.production.cards.find((card) => card.card_id === id) ?? null;
	const selected = $derived(cardOf(selectedId));
	const selectedItem = $derived(selected ? playItemFor(project, selected) : null);
	const inSelection = $derived(!!selectedId && reviewSequence.position(selectedId) > 0);
	let said = $state('');
	const line = $derived(said || note || selectionSummary(project, items, read) || 'Empty');

	const entries = $derived(items.map((item) => {
		const card = cardOf(item.id);
		const takes = card ? takesFor(project.production, card.card_id, true) : [];
		const at = takes.findIndex((take) => take.asset_id === item.assetId);
		const take = at >= 0 ? takes[at] : null;
		return {
			item,
			number: card ? shotCardFacts(card, project.production.assets, null).number : '',
			version: take && item.auditioned ? takeLabel(take, at) : '',
			still: take ? posterUrl(take.url, take.in_s ?? 0) : null,
			slate: isSlateId(item.assetId),
			seconds: itemSeconds(project, item, read) ?? 3
		};
	}));

	function say(text: string) {
		said = text;
		setTimeout(() => { if (said === text) said = ''; }, 3500);
	}

	function toggleSelected() {
		if (!selected) return;
		if (inSelection) reviewSequence.remove(selected.card_id);
		else if (selectedItem) reviewSequence.toggle(selectedItem);
		else say('A still pick does not play in a selection');
	}

	/** Play the next or previous usable video take of the shot in its place. */
	function audition(id: string, by: -1 | 1) {
		const card = cardOf(id);
		const item = items.find((entry) => entry.id === id);
		if (!card || !item) return;
		const takes = takesFor(project.production, id).filter((take) => take.kind === 'video');
		if (takes.length < 2) { say('This shot has one take'); return; }
		const next = takes[step(takes.length, takes.findIndex((take) => take.asset_id === item.assetId), by)];
		if (next) reviewSequence.audition(id, { assetId: next.asset_id, src: next.url }, pickFor(project.production, card)?.asset_id ?? null);
	}

	let clips = $state<HTMLElement | null>(null);
	const focusClip = (at: number) => (clips?.querySelectorAll<HTMLElement>('.clip')[at])?.focus();

	function clipKey(event: KeyboardEvent, id: string, at: number) {
		if (event.metaKey || event.ctrlKey) return;
		const key = event.key;
		if (key === 'ArrowUp' || key === 'ArrowDown') audition(id, key === 'ArrowUp' ? -1 : 1);
		else if ((key === 'ArrowLeft' || key === 'ArrowRight') && event.altKey) { const by = key === 'ArrowLeft' ? -1 : 1; reviewSequence.nudge(id, by); queueMicrotask(() => focusClip(reviewSequence.position(id) - 1)); }
		else if (key === 'ArrowLeft' || key === 'ArrowRight') focusClip(Math.min(items.length - 1, Math.max(0, at + (key === 'ArrowLeft' ? -1 : 1))));
		else if (key === 'Backspace' || key === 'Delete') { reviewSequence.remove(id); queueMicrotask(() => focusClip(Math.min(at, reviewSequence.items.length - 1))); }
		else if (key === ' ' || key === 'Enter') onplay();
		else return;
		event.preventDefault();
		event.stopPropagation();
	}

	// Dragging: a card from the grid or an entry of the strip, dropped between two entries.
	/** Where a drop would land (the entry it goes before), or null when nothing is dragged over the strip. */
	let dropAt = $state<number | null>(null);
	let dropLeft = $state(0);

	function dragOver(event: DragEvent) {
		if (!event.dataTransfer?.types.includes(SHOT_DRAG) || !clips) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
		const boxes = [...clips.querySelectorAll<HTMLElement>('.clip')].map((clip) => clip.getBoundingClientRect());
		const at = boxes.findIndex((box) => event.clientX < box.left + box.width / 2);
		dropAt = at < 0 ? boxes.length : at;
		const edge = clips.getBoundingClientRect().left;
		dropLeft = boxes.length === 0 ? 0 : dropAt < boxes.length ? boxes[dropAt].left - edge - 2 : boxes[boxes.length - 1].right - edge;
	}

	function drop(event: DragEvent) {
		const id = event.dataTransfer?.getData(SHOT_DRAG);
		const at = dropAt;
		dropAt = null;
		if (!id || at === null) return;
		event.preventDefault();
		const card = cardOf(id);
		const item = items.find((entry) => entry.id === id) ?? (card ? playItemFor(project, card) : null);
		if (item) reviewSequence.place(item, at);
		else say('A still pick does not play in a selection');
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="strip" role="group" aria-label="Selection" ondragover={dragOver} ondragleave={(event) => { if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) dropAt = null; }} ondrop={drop}>
	<span class="who"><span class="cp">Selection</span><span class="code" aria-live="polite">{line}</span></span>
	<div class="clips" bind:this={clips}>
		{#each entries as entry, at (entry.item.id)}
			<button type="button" class="clip" class:current={entry.item.id === selectedId} class:slate={entry.slate} style:flex-grow={entry.seconds} draggable="true"
				title={`${entry.item.title} · ↑↓ another take · ⌥←→ move · ⌫ take out`}
				aria-label={`${at + 1}. ${entry.item.title}${entry.version ? `, auditioning ${entry.version}` : ''}`}
				onclick={() => onselect(entry.item.id)} onkeydown={(event) => clipKey(event, entry.item.id, at)}
				ondragstart={(event) => { event.dataTransfer?.setData(SHOT_DRAG, entry.item.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }}>
				{#if entry.still}<img src={entry.still} alt="" draggable="false" loading="lazy" decoding="async" />{/if}
				<span class="code">{entry.number}{entry.version ? ` ${entry.version}` : ''}</span>
			</button>
		{:else}
			<span class="cp hint">Shift-click shots, or drag them here</span>
		{/each}
		{#if dropAt !== null}<i class="drop" style:left={`${dropLeft}px`}></i>{/if}
	</div>
	<button type="button" class="key add" disabled={!selected || busy} onclick={toggleSelected} title={inSelection ? 'Take the selected shot out of the selection' : 'Add the selected shot to the selection (or shift-click a shot)'}>{inSelection ? 'Remove' : 'Add'}</button>
	<button type="button" class="key" disabled={!items.length} onclick={onplay} title="Play the selection in order">Play</button>
	<button type="button" class="key go" disabled={!items.length || busy} onclick={onpush} title="Save this order and these takes as a new cut">Push to cut</button>
	<button type="button" class="tg" disabled={!items.length} onclick={() => reviewSequence.clear()}>Clear</button>
</div>

<style>
	.strip { display: flex; height: 56px; min-width: 0; flex: none; align-items: center; gap: 4px; overflow: hidden; border-radius: 8px; background: var(--color-raised); padding: 0 10px; white-space: nowrap; }
	.who { display: flex; width: 86px; flex: none; flex-direction: column; gap: 1px; overflow: hidden; margin-right: 6px; color: var(--color-ink); }
	.code { font: 10.5px var(--font-mono); letter-spacing: 0.01em; }
	.who .code { overflow: hidden; text-overflow: ellipsis; color: var(--color-ink-3); }
	.clips { position: relative; display: flex; height: 38px; min-width: 0; flex: 1; align-items: stretch; gap: 2px; margin-right: 6px; }
	.hint { align-self: center; overflow: hidden; text-overflow: ellipsis; color: var(--color-ink-3); }
	.clip { position: relative; min-width: 26px; flex: 1 1 0; overflow: hidden; border: 0; border-radius: 4px; background: var(--color-control); padding: 0; cursor: grab; }
	.clip img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.78; pointer-events: none; }
	.clip.current img { opacity: 1; }
	.clip .code { position: absolute; bottom: 2px; left: 3px; border-radius: 2px; background: rgb(0 0 0 / 0.72); padding: 0 3px; color: var(--color-ink-2); }
	.clip.current .code { background: var(--color-teal-deep); color: var(--color-teal-ink); }
	.clip:focus-visible { outline: 2px solid var(--color-teal); outline-offset: -2px; }
	.drop { position: absolute; top: -2px; bottom: -2px; width: 3px; background: var(--color-teal); pointer-events: none; }
	/* Shift-click and dragging need a mouse; on touch the selected shot is added with this button, which is always there. */
	.add { display: none; width: 62px; }
	@media (pointer: coarse) { .add { display: inline-flex; } }
</style>
