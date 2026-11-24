<script lang="ts">
	/**
	 * The outline panel on the Cut stage (slice 7): the project's cuts; under the open one its versions, newest first,
	 * each saying whether it is being edited or locked, mixed and exported; then the entries of the version on screen,
	 * which jump the player; then the assemblies, which open on the canvas. Picking a version here is how Sound and
	 * Export choose what they work on.
	 */
	import type { Project } from '$lib/domain/schemas';
	import { cutLength, cutsOf, cutVersionEntries } from '$lib/domain/cuts';
	import { openCutOf, shownVersion, stepOfTab, versionLabel, versionRows } from '$lib/domain/cut-stage';
	import type { WorkspaceTab } from '$lib/domain/stages';
	import { shotStatus } from '$lib/domain/next-line';
	import { programElapsed } from '$lib/media/speed-curve';
	import { ASSEMBLY_VIEW, assemblyViews } from '$lib/domain/groups';
	import { ui } from '$lib/ui/app-state.svelte';
	import { cutView } from './cut-view.svelte';

	let { project, tab, onOpenAssembly }: {
		project: Project | null;
		tab: WorkspaceTab;
		/** Open an assembly on the canvas (it leaves the Cut stage). */
		onOpenAssembly?: (viewId: string) => void;
	} = $props();

	const step = $derived(stepOfTab(tab));
	const cuts = $derived(project ? cutsOf(project.production) : []);
	const open = $derived(openCutOf(cuts, cutView.cutId));
	const shown = $derived(open ? shownVersion(open, cutView.version, step) : null);
	const rows = $derived(open ? versionRows(open) : []);
	const entries = $derived.by(() => {
		if (!project || !open || shown === null) return [];
		return (cutVersionEntries(open, shown) ?? []).map((entry, i) => {
			const card = project.production.cards.find((item) => item.card_id === entry.card_id);
			return {
				id: entry.entry_id, number: i + 1, title: card?.title ?? 'Missing shot',
				length: programElapsed(entry.speed, entry.out_s - entry.in_s),
				status: shotStatus(project.production.assets.filter((asset) => asset.card_id === entry.card_id))
			};
		});
	});
	const assemblies = $derived(project ? assemblyViews(project.production) : []);

	let renaming = $state<{ cutId: string; name: string } | null>(null);
	let said = $state('');
	async function rename() {
		const target = renaming;
		renaming = null;
		const cut = cuts.find((item) => item.cut_id === target?.cutId);
		if (!project || !target || !cut || !target.name.trim() || target.name.trim() === cut.name) return;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/cuts`, {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ command: 'rename_cut', expected_version: project.version, cut_id: target.cutId, name: target.name.trim() })
			});
			const result = (await response.json()) as { ok: true; data: Project } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			ui.adoptActiveProject(result.data);
		} catch (cause) { said = cause instanceof Error ? cause.message : 'Rename failed'; }
	}
	function focusName(node: HTMLInputElement) { node.focus(); node.select(); }
</script>

<nav class="tree" aria-label="Cuts">
	<p class="cp head">Cuts · {cuts.length}{#if said}<span class="said">{said}</span>{/if}</p>
	{#if !project}
		<p class="none">No project open</p>
	{:else if cuts.length === 0}
		<p class="none">No cuts yet</p>
		<p class="cp hint">Push a selection from Shots</p>
	{:else}
		{#each cuts as cut (cut.cut_id)}
			{@const isOpen = open?.cut_id === cut.cut_id}
			{#if renaming?.cutId === cut.cut_id}
				<input class="name-edit" use:focusName bind:value={renaming.name} aria-label="Cut name" onkeydown={(event) => { if (event.key === 'Enter') void rename(); else if (event.key === 'Escape') renaming = null; }} onblur={() => void rename()} />
			{:else}
				<button type="button" class="cut" aria-current={isOpen ? 'true' : undefined} onclick={() => cutView.open(cut.cut_id)} ondblclick={() => (renaming = { cutId: cut.cut_id, name: cut.name })} title="Open {cut.name}. Double-click to rename it.">
					<span class="name">{cut.name}</span><span class="count">{isOpen ? '' : `v${cut.version} · `}{cutLength(cut).toFixed(1)}s</span>
				</button>
			{/if}
			{#if isOpen}
				{#each rows as row (row.version)}
					<button type="button" class="ver" aria-current={row.version === shown ? 'true' : undefined} disabled={step !== 'picture' && !row.locked} onclick={() => cutView.open(cut.cut_id, row.version)} title={row.editing ? `v${row.version} is being edited` : `v${row.version}, locked ${row.lockedAt ? new Date(row.lockedAt).toLocaleString() : ''}`}>
						<span class="num">v{row.version}</span><span class="cp state">{versionLabel(row)}</span><span class="count">{row.editing ? `${row.entries} ${row.entries === 1 ? 'entry' : 'entries'}` : `${row.length.toFixed(1)}s`}</span>
					</button>
				{/each}
			{/if}
		{/each}
		{#if open && shown !== null}
			<p class="cp act">Entries · v{shown}</p>
			{#each entries as item, i (item.id)}
				<button type="button" class="entry" data-status={item.status} aria-current={step === 'picture' && cutView.entry === i ? 'true' : undefined} onclick={() => (cutView.entry = i)} title={item.title}>
					<span class="num">{item.number}</span><span class="name">{item.title}</span><span class="count">{item.length.toFixed(1)}s</span>
				</button>
			{/each}
		{/if}
	{/if}
	{#if assemblies.length && onOpenAssembly}
		<p class="cp act">Assemblies</p>
		{#each assemblies as view (view.group_id)}
			<button type="button" class="cut" onclick={() => onOpenAssembly?.(view.group_id)} title="Open {view.name} on the canvas">
				<span class="name">{view.name}</span><span class="count">{view.count} {view.count === 1 ? 'item' : 'items'}</span>
			</button>
		{/each}
	{/if}
</nav>

<style>
	.tree { display: flex; height: 100%; min-height: 0; flex-direction: column; overflow-y: auto; padding: 6px; }
	.head { display: flex; min-width: 0; flex: none; gap: 8px; margin: 0; overflow: hidden; padding: 4px 8px 6px; color: var(--color-ink-3); }
	.said { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: #ff7a6b; letter-spacing: 0.02em; text-transform: none; }
	.act { flex: none; margin: 0; padding: 14px 8px 3px; color: var(--color-teal); }
	.none { flex: none; margin: 0; padding: 4px 8px; color: var(--color-ink-3); font-size: 12px; white-space: nowrap; }
	.hint { flex: none; margin: 0; padding: 0 8px; color: var(--color-ink-3); }
	.cut, .ver, .entry { display: flex; width: 100%; flex: none; align-items: center; gap: 8px; overflow: hidden; border: 0; border-radius: 5px; background: none; text-align: left; white-space: nowrap; cursor: pointer; }
	.cut { height: 24px; padding: 0 8px; color: var(--color-ink-2); font: 12.5px var(--font-sans); }
	.cut:hover, .ver:hover:not(:disabled), .entry:hover { color: var(--color-ink); }
	.cut[aria-current='true'] { background: var(--color-selected); color: var(--color-teal-ink); }
	.ver { height: 22px; padding: 0 8px 0 20px; color: var(--color-ink-2); font-size: 12px; }
	.ver[aria-current='true'] { background: var(--color-selected-row); color: var(--color-teal-ink); }
	.ver[aria-current='true'] .state { color: var(--color-teal); }
	.ver:disabled { opacity: 0.4; cursor: default; }
	.ver .state { color: var(--color-ink-3); }
	.entry { height: 22px; padding: 0 8px 0 20px; color: var(--color-ink-2); font-size: 12px; }
	.entry[aria-current='true'] { background: var(--color-selected-row); color: var(--color-teal-ink); }
	.cut:focus-visible, .ver:focus-visible, .entry:focus-visible { outline: 2px solid var(--color-teal); outline-offset: -2px; }
	.name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; }
	.num, .count { flex: none; font: 10.5px var(--font-mono); letter-spacing: 0.01em; }
	.count { margin-left: auto; color: var(--color-ink-3); }
	.ver .num { color: inherit; }
	.entry .num { min-width: 15px; }
	.entry[data-status='approved'] .num { color: var(--color-teal); }
	.entry[data-status='awaiting'] .num { color: var(--color-amber); }
	.entry[data-status='changes'] .num { color: #ff7a6b; }
	.entry[data-status='progress'] .num { color: #7fb2ff; }
	.entry[data-status='missing'] .num { color: var(--color-ink-3); }
	.name-edit { width: 100%; height: 24px; flex: none; box-sizing: border-box; border: 0; border-radius: 5px; background: var(--color-raised); padding: 0 8px; color: var(--color-ink); font: 12.5px var(--font-sans); outline: none; }
</style>
