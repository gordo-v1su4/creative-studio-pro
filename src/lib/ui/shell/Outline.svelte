<script lang="ts">
	/**
	 * The outline panel of the shell: the project's groups and, under the open one, its shots
	 * with their review status. Slice 0 reads what the board already holds; the story plan's
	 * acts and scene codes join it with the story plan slice.
	 */
	import type { Project } from '$lib/domain/schemas';
	import { groupOf, groupsOf } from '$lib/domain/groups';
	import { shotStatus } from '$lib/domain/next-line';
	import { dropLabel, dropMeaning, type Dragged } from '$lib/domain/drops';
	import { mediaKind } from '$lib/domain/media';
	import { playItemFor } from '$lib/domain/slate';
	import { droppedFiles } from '$lib/ui/dropped-files';
	import { SHOT_DRAG } from '$lib/ui/shots/SelectionStrip.svelte';
	import { page } from '$app/state';
	import { sceneRoomLink } from '$lib/domain/review-room-links';

	let { project, openGroupId, onOpenGroup, onMoveShots, onAddFiles }: {
		project: Project | null; openGroupId: string; onOpenGroup: (groupId: string) => void;
		/** Shots dropped on a group: move them there (they keep their numbers and codes). */
		onMoveShots?: (groupId: string, cardIds: string[]) => void;
		/** Files dropped on a group: each becomes a new shot in it. */
		onAddFiles?: (groupId: string, files: File[]) => void;
	} = $props();

	// A group is a drop target (domain/drops): a shot dropped on it moves there, files become new shots in it.
	let over = $state<{ groupId: string; line: string; ok: boolean } | null>(null);
	const meaningOf = (dragged: Dragged, groupId: string) => dropMeaning(dragged, { kind: 'group', groupId }, {
		groupOf: (cardId) => { const card = project?.production.cards.find((entry) => entry.card_id === cardId); return card ? groupOf(card) : null; },
		playable: (cardId) => { const card = project?.production.cards.find((entry) => entry.card_id === cardId); return !!project && !!card && !!playItemFor(project, card); }
	});
	const held = (event: DragEvent): Dragged | null => {
		const types = event.dataTransfer?.types ?? [];
		// While dragging, a page may see what kinds of thing are held but not which shot; that is read on the drop.
		return types.includes(SHOT_DRAG) ? { kind: 'shots', cardIds: [] } : types.includes('Files') ? { kind: 'files' } : null;
	};

	function dragOver(event: DragEvent, group: { group_id: string; name: string }) {
		const dragged = held(event);
		if (!dragged) return;
		event.preventDefault();
		const line = dragged.kind === 'files' ? dropLabel(meaningOf(dragged, group.group_id), { group: group.name }) : `Drop to move the shot to ${group.name}`;
		if (over?.groupId !== group.group_id || over.line !== line) over = { groupId: group.group_id, line, ok: true };
	}

	function drop(event: DragEvent, group: { group_id: string; name: string }) {
		const data = event.dataTransfer;
		over = null;
		if (!data) return;
		const shot = data.getData(SHOT_DRAG);
		if (shot) {
			event.preventDefault();
			const meaning = meaningOf({ kind: 'shots', cardIds: [shot] }, group.group_id);
			if (meaning.kind === 'move') onMoveShots?.(meaning.groupId, meaning.cardIds);
			else if (meaning.kind === 'nothing') said = meaning.why;
			return;
		}
		if (!data.types.includes('Files')) return;
		event.preventDefault();
		void droppedFiles(data).then((files) => {
			const meaning = meaningOf({ kind: 'files', media: files.map((file) => mediaKind(file.name) ?? 'other') }, group.group_id);
			if (meaning.kind === 'new-shots') onAddFiles?.(meaning.groupId, files);
			else if (meaning.kind === 'nothing') said = meaning.why;
		});
	}

	/** One line under the heading: what a held drop will do, or why the last one did nothing. */
	let said = $state('');
	$effect(() => { if (!said) return; const text = said; const timer = setTimeout(() => { if (said === text) said = ''; }, 3500); return () => clearTimeout(timer); });

	const groups = $derived(project ? groupsOf(project.production).filter((group) => group.count > 0 || group.group_id === openGroupId) : []);
	const shots = $derived(
		project
			? project.production.cards
					.filter((card) => groupOf(card) === openGroupId)
					.sort((a, b) => a.order - b.order)
					.map((card, index) => ({
						id: card.card_id,
						number: String(card.shot_number ?? (index + 1) * 10).padStart(4, '0'),
						title: card.title,
						status: shotStatus(project.production.assets.filter((asset) => asset.card_id === card.card_id))
					}))
			: []
	);
</script>

<nav class="outline" aria-label="Outline">
	<p class="cp head"><span>Outline</span><span class="said" aria-live="polite">{over?.line ?? said}</span></p>
	{#if !project}
		<p class="none">No project open</p>
	{:else if groups.length === 0}
		<p class="none">No shots yet</p>
	{:else}
		{#each groups as group (group.group_id)}
			{@const open = group.group_id === openGroupId}
			<button type="button" class={['group', over?.groupId === group.group_id && 'over']} aria-current={open ? 'true' : undefined} onclick={() => onOpenGroup(group.group_id)} title="Open {group.name} on the canvas. Drop a shot here to move it, or files to add them as shots."
				ondragover={(event) => dragOver(event, group)} ondragleave={() => { if (over?.groupId === group.group_id) over = null; }} ondrop={(event) => drop(event, group)}>
				<span class="name">{group.name}</span><span class="count">{group.count}</span>
			</button>
			{#if open}
				{@const roomHref = project ? sceneRoomLink(page.data.reviewRoomUrl, project, group.group_id) : null}
				{#if roomHref}<a class="cp room" href={roomHref} target="_blank" rel="noopener" title="Open this scene's folder in Review Room">Open in Review Room</a>{/if}
				<ul>
					{#each shots as shot (shot.id)}
						<li data-status={shot.status} title={shot.title} draggable="true" ondragstart={(event) => { event.dataTransfer?.setData(SHOT_DRAG, shot.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copyMove'; }}><span class="num">{shot.number}</span><span class="name">{shot.title}</span></li>
					{/each}
				</ul>
			{/if}
		{/each}
	{/if}
</nav>

<style>
	.outline { display: flex; height: 100%; min-height: 0; flex-direction: column; overflow-y: auto; padding: 6px; }
	.head { display: flex; min-width: 0; gap: 8px; margin: 0; overflow: hidden; padding: 4px 8px 6px; color: var(--color-ink-3); }
	.said { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; color: var(--color-teal-ink); letter-spacing: 0.02em; text-transform: none; }
	.room { display: block; flex: none; padding: 2px 8px 3px 16px; color: var(--color-amber); }
	.room:hover { color: var(--color-ink); }
	.group.over { background: var(--color-teal-deep); color: var(--color-teal-ink); }
	.none { margin: 0; padding: 4px 8px; color: var(--color-ink-3); font-size: 12px; white-space: nowrap; }
	.group { display: flex; width: 100%; height: 24px; flex: none; align-items: center; gap: 8px; overflow: hidden; border: 0; border-radius: 5px; background: none; padding: 0 8px; color: var(--color-ink-2); font: 12.5px var(--font-sans); text-align: left; white-space: nowrap; cursor: pointer; }
	.group:hover { color: var(--color-ink); }
	.group[aria-current='true'] { background: var(--color-selected); color: var(--color-teal-ink); }
	.group:focus-visible { outline: 2px solid var(--color-teal); outline-offset: -2px; }
	.name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; }
	.count, .num { font: 10.5px var(--font-mono); letter-spacing: 0.01em; }
	.count { color: var(--color-ink-3); }
	ul { margin: 0; padding: 0; list-style: none; }
	li { display: flex; height: 22px; align-items: center; gap: 8px; overflow: hidden; padding: 0 8px 0 20px; color: var(--color-ink-2); font-size: 12px; white-space: nowrap; }
	li[data-status='approved'] .num { color: var(--color-teal); }
	li[data-status='awaiting'] .num { color: var(--color-amber); }
	li[data-status='changes'] .num { color: #ff7a6b; }
	li[data-status='progress'] .num { color: #7fb2ff; }
	li[data-status='missing'] .num { color: var(--color-ink-3); }
</style>
