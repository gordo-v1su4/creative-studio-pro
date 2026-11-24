<script lang="ts">
	/**
	 * The outline panel of the shell. On top, the story plan's five levels and where each stands (decision 3);
	 * under them the scenes with their scene codes, then "Unplaced": the groups that are not scenes
	 * (decision 15). The open group lists its shots with their review status.
	 */
	import type { Project } from '$lib/domain/schemas';
	import { groupOf, groupsOf, MAIN_GROUP } from '$lib/domain/groups';
	import { shotStatus } from '$lib/domain/next-line';
	import { dropLabel, dropMeaning, type Dragged } from '$lib/domain/drops';
	import { mediaKind } from '$lib/domain/media';
	import { playItemFor } from '$lib/domain/slate';
	import { droppedFiles } from '$lib/ui/dropped-files';
	import { SHOT_DRAG } from '$lib/ui/shots/SelectionStrip.svelte';
	import { page } from '$app/state';
	import { sceneRoomLink } from '$lib/domain/review-room-links';
	import { levelCounts, levelLabel, levelOpen, levelStates, levelSummary, nextLevel, placedGroups, shortCodeOf, STORY_LEVELS, type StoryLevel } from '$lib/domain/story-levels';

	let { project, openGroupId, onOpenGroup, onMoveShots, onAddFiles, level = null, onOpenLevel, fresh = false }: {
		/** The front door is showing: the five levels a new project will go through, with nothing in them yet. */
		fresh?: boolean;
		project: Project | null; openGroupId: string; onOpenGroup: (groupId: string) => void;
		/** The story plan level open on the Story stage, when that stage is showing. */
		level?: StoryLevel | null;
		onOpenLevel?: (level: StoryLevel) => void;
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

	const groups = $derived(project ? groupsOf(project.production).filter((group) => group.count > 0 || (group.group_id === openGroupId && group.group_id !== MAIN_GROUP)) : []);
	const placed = $derived(project ? placedGroups(project, groups) : { scenes: [], unplaced: [] });

	// The story plan's levels: shown for a project that has one.
	const levels = $derived.by(() => {
		if (fresh) return { next: null, rows: STORY_LEVELS.map((id) => ({ id, label: levelLabel(id), state: 'empty' as const, line: '' })) };
		if (!project?.production.story_plan) return null;
		const counts = levelCounts(project), open = levelOpen(project), approved = project.production.story_levels?.approved ?? {};
		const states = levelStates(counts, approved, open);
		return { next: nextLevel(states), rows: STORY_LEVELS.map((id) => ({ id, label: levelLabel(id), state: states[id], line: levelSummary(id, states[id], counts[id], open[id], !!approved[id]) })) };
	});
	const shots = $derived(
		project
			? project.production.cards
					.filter((card) => groupOf(card) === openGroupId)
					.sort((a, b) => a.order - b.order)
					.map((card, index) => ({
						id: card.card_id,
						// A shot's own number once it has one (it may have come from another scene); its place until then.
							number: shortCodeOf(project, card)?.slice(-4) ?? String(card.shot_number ?? (index + 1) * 10).padStart(4, '0'),
						title: card.title,
						status: shotStatus(project.production.assets.filter((asset) => asset.card_id === card.card_id))
					}))
			: []
	);
</script>

{#snippet groupRow(group: { group_id: string; name: string; count: number; code?: string; title?: string })}
	{@const open = group.group_id === openGroupId}
	<button type="button" class={['group', over?.groupId === group.group_id && 'over']} aria-current={open ? 'true' : undefined} onclick={() => onOpenGroup(group.group_id)} title="Open {group.name} on the canvas. Drop a shot here to move it, or files to add them as shots."
		ondragover={(event) => dragOver(event, group)} ondragleave={() => { if (over?.groupId === group.group_id) over = null; }} ondrop={(event) => drop(event, group)}>
		{#if group.code}<span class="code">{group.code}</span>{/if}<span class="name">{group.title ?? group.name}</span><span class="count">{group.count}</span>
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
{/snippet}

<nav class="tree" aria-label="Outline">
	{#if levels}
		<p class="cp head"><span>Story plan</span></p>
		{#each levels.rows as row, i (row.id)}
			<button type="button" class="level" data-state={row.state} disabled={fresh} aria-current={!fresh && (level ?? levels.next) === row.id ? 'step' : undefined} data-open={level === row.id ? '' : undefined} onclick={() => onOpenLevel?.(row.id)} title={fresh ? `${row.label}: proposed by the Agent, approved by you` : `Open ${row.label.toLowerCase()} in the story plan`}>
				<span class="num">{String(i + 1).padStart(2, '0')}</span><span class="name">{row.label}</span><span class="cp line">{row.line}</span>
			</button>
		{/each}
		{#if levels.next || fresh}<p class={['cp lock', fresh && 'long']}>{fresh ? 'Names lock as each level is approved, and stay the same in Review Room' : 'Names lock as each level is approved'}</p>{/if}
	{/if}
	{#if !fresh}<p class="cp head"><span>{levels ? 'Scenes' : 'Outline'}</span><span class="said" aria-live="polite">{over?.line ?? said}</span></p>{/if}
	{#if fresh}
		<!-- Nothing to list yet. -->
	{:else if !project}
		<p class="none">No project open</p>
	{:else if groups.length === 0}
		<p class="none">No shots yet</p>
	{:else}
		{#each placed.scenes as group (group.group_id)}{@render groupRow(group)}{/each}
		{#if placed.scenes.length && placed.unplaced.length}<p class="cp head sub" title="Groups that are not scenes. Drag a shot onto a scene to place it; it keeps its code.">Unplaced</p>{/if}
		{#each placed.unplaced as group (group.group_id)}{@render groupRow(group)}{/each}
	{/if}
</nav>

<style>
	/* Not "outline": that name is a Tailwind utility and drew a frame round the panel. */
	.tree { display: flex; height: 100%; min-height: 0; flex-direction: column; overflow-y: auto; padding: 6px; }
	.head { display: flex; min-width: 0; gap: 8px; margin: 0; overflow: hidden; padding: 4px 8px 6px; color: var(--color-ink-3); }
	.said { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; color: var(--color-teal-ink); letter-spacing: 0.02em; text-transform: none; }
	.room { display: block; flex: none; padding: 2px 8px 3px 16px; color: var(--color-amber); }
	.room:hover { color: var(--color-ink); }
	.group.over { background: var(--color-teal-deep); color: var(--color-teal-ink); }
	.head.sub { padding-top: 10px; }
	.level { display: flex; width: 100%; height: 24px; flex: none; align-items: center; gap: 10px; overflow: hidden; border: 0; border-radius: 5px; background: none; padding: 0 8px; color: var(--color-ink-2); font: 12.5px var(--font-sans); text-align: left; white-space: nowrap; cursor: pointer; }
	.level:hover { color: var(--color-ink); }
	.level .num { color: #52525b; }
	.level[data-state='approved'] .num, .level[aria-current='step'] .num { color: var(--color-teal); }
	.level[data-state='empty'] { color: var(--color-ink-3); }
	.level[aria-current='step'] { background: var(--color-selected-row); color: var(--color-teal-ink); }
	.level[data-open] { background: var(--color-selected); color: var(--color-teal-ink); }
	.level:focus-visible { outline: 2px solid var(--color-teal); outline-offset: -2px; }
	.level .line { flex: none; color: var(--color-ink-3); }
	.level[data-state='approved'] .line { color: var(--color-teal); }
	.lock { margin: 0; overflow: hidden; padding: 4px 8px 10px; text-overflow: ellipsis; color: var(--color-ink-3); }
	/* The one place chrome runs to a sentence: it wraps here rather than lose its second half. */
	.lock.long { white-space: normal; line-height: 1.6; }
	.level:disabled { cursor: default; }
	.code { flex: none; color: var(--color-teal); font: 10.5px var(--font-mono); letter-spacing: 0.01em; }
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
