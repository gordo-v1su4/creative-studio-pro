<script lang="ts">
	/**
	 * The outline panel of the shell: the project's groups and, under the open one, its shots
	 * with their review status. Slice 0 reads what the board already holds; the story plan's
	 * acts and scene codes join it with the story plan slice.
	 */
	import type { Project } from '$lib/domain/schemas';
	import { groupOf, groupsOf } from '$lib/domain/groups';
	import { shotStatus } from '$lib/domain/next-line';

	let { project, openGroupId, onOpenGroup }: { project: Project | null; openGroupId: string; onOpenGroup: (groupId: string) => void } = $props();

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
	<p class="cp head">Outline</p>
	{#if !project}
		<p class="none">No project open</p>
	{:else if groups.length === 0}
		<p class="none">No shots yet</p>
	{:else}
		{#each groups as group (group.group_id)}
			{@const open = group.group_id === openGroupId}
			<button type="button" class="group" aria-current={open ? 'true' : undefined} onclick={() => onOpenGroup(group.group_id)} title="Open {group.name} on the canvas">
				<span class="name">{group.name}</span><span class="count">{group.count}</span>
			</button>
			{#if open}
				<ul>
					{#each shots as shot (shot.id)}
						<li data-status={shot.status} title={shot.title}><span class="num">{shot.number}</span><span class="name">{shot.title}</span></li>
					{/each}
				</ul>
			{/if}
		{/each}
	{/if}
</nav>

<style>
	.outline { display: flex; height: 100%; min-height: 0; flex-direction: column; overflow-y: auto; padding: 6px; }
	.head { margin: 0; padding: 4px 8px 6px; color: var(--color-ink-3); }
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
