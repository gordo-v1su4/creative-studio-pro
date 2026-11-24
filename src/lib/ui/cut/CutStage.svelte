<script lang="ts">
	/**
	 * The Cut stage's work area (slice 7): one stage, three steps. Picture opens, edits and locks the cut (the cut
	 * player, drawn in place); Sound lays sound against a locked version and builds its mix; Export renders and checks
	 * it. Which cut and version is open comes from the Cut outline (cut-view). A cut can be opened, locked, mixed and
	 * exported without leaving the stage.
	 */
	import type { Project } from '$lib/domain/schemas';
	import type { WorkspaceTab } from '$lib/domain/stages';
	import { cutsOf } from '$lib/domain/cuts';
	import { cutBar, openCutOf, shownVersion, stepBlocked, stepOfTab } from '$lib/domain/cut-stage';
	import SequencePlayer from '$lib/ui/SequencePlayer.svelte';
	import ScorePromptPanel from '$lib/ui/ScorePromptPanel.svelte';
	import SoundStep from './SoundStep.svelte';
	import ExportStep from './ExportStep.svelte';
	import CutOutline from './CutOutline.svelte';
	import { cutView } from './cut-view.svelte';

	let { project, tab = $bindable(), detailsHost = null, onUpdated, onAgent, onManifest, notice = null }: {
		project: Project;
		tab: Exclude<WorkspaceTab, 'canvas'>;
		detailsHost?: HTMLElement | null;
		onUpdated: (project: Project) => void;
		/** Show the dock's Agent tab. */
		onAgent?: () => void;
		onManifest?: () => void;
		/** What the last change that opened a cut here did (the first cut to the score). */
		notice?: string | null;
	} = $props();

	const step = $derived(stepOfTab(tab));
	const cuts = $derived(cutsOf(project.production));
	const cut = $derived(openCutOf(cuts, cutView.cutId));
	const version = $derived(cut ? shownVersion(cut, cutView.version, step) : null);
	const blocked = $derived(cut ? stepBlocked(cut, version, step) : null);
	const facts = $derived(cut && version !== null ? cutBar(cut, version, step) : '');
	let locking = $state(false);
	let error = $state<string | null>(null);
	let scoring = $state(false);
	/** Below 768px the shell hides its outline: the Cuts key opens the same list over the work area. */
	let phoneCuts = $state(false);
	$effect(() => { void cutView.cutId; void cutView.version; void tab; phoneCuts = false; });

	/** Lock freezes the current version's picture so sound can be laid against it; unlock opens the next version from it. */
	async function setLocked(lock: boolean) {
		if (!cut) return;
		locking = true; error = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/cuts`, {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ command: lock ? 'lock_cut' : 'unlock_cut', expected_version: project.version, cut_id: cut.cut_id })
			});
			const result = (await response.json()) as { ok: true; data: Project } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			onUpdated(result.data);
			// The version on screen follows: the locked one, or the new one being edited.
			cutView.open(cut.cut_id, null);
		} catch (cause) { error = cause instanceof Error ? cause.message : lock ? 'Lock failed' : 'Unlock failed'; }
		finally { locking = false; }
	}

	function intoDock(node: HTMLElement, host: HTMLElement | null) {
		const place = (target: HTMLElement | null) => { if (target && node.parentNode !== target) target.appendChild(node); };
		place(host);
		return { update: place, destroy: () => node.remove() };
	}
</script>

{#snippet lockKey()}
	{#if cut && version === cut.version}
		{#if cut.locked}
			<button type="button" class="key" onclick={() => void setLocked(false)} disabled={locking} title={`Start v${cut.version + 1} as a copy of v${cut.version}; v${cut.version} stays as it is, with its sound`}>{locking ? 'Unlocking…' : `Unlock to v${cut.version + 1}`}</button>
			<button type="button" class="key go" onclick={() => (tab = 'sound')}>Sound</button>
		{:else}
			<button type="button" class="key go" onclick={() => void setLocked(true)} disabled={locking} title={`Freeze v${cut.version}'s picture (no trims, ramps, reorders, swaps or drops) so sound can be laid against it`}>{locking ? 'Locking…' : `Lock v${cut.version}`}</button>
		{/if}
	{:else if cut}
		<button type="button" class="key" onclick={() => cutView.open(cut.cut_id, null)} title="The version being worked on">Open v{cut.version}</button>
	{/if}
{/snippet}

<div class="cut-stage">
	<div class="phone-bar"><button type="button" class="tg" aria-pressed={phoneCuts} aria-expanded={phoneCuts} onclick={() => (phoneCuts = !phoneCuts)}>Cuts{cut ? ` · ${cut.name}` : ''}</button></div>
	{#if phoneCuts}<div class="phone-cuts"><CutOutline {project} {tab} /></div>{/if}
	{#if !cut}
		<div class="bar"><h1>Cut</h1></div>
		<div class="none">
			<p class="cp">No cuts yet</p>
			<p class="text">In Shots, click shots to add them to the selection, put them in order, then press Push to cut. The cut opens here, to trim, lock, mix and export.</p>
		</div>
	{:else if version === null || blocked}
		<div class="bar"><span class="code teal">{version === null ? '' : `v${version}`}</span><h1>{cut.name}</h1></div>
		<div class="none">
			<p class="cp">{step === 'sound' ? 'Sound' : 'Export'}</p>
			<p class="text">{blocked}</p>
			<div class="row">
				{#if step === 'export' && version !== null}<button type="button" class="key go" onclick={() => (tab = 'sound')}>Open Sound</button>{:else}<button type="button" class="key go" onclick={() => { cutView.open(cut.cut_id, null); tab = 'cuts'; }}>Open Picture</button>{/if}
			</div>
		</div>
	{:else if step === 'picture'}
		{#key `${project.project_id}:${cut.cut_id}:${version}`}
			<SequencePlayer {project} {onUpdated} source={{ kind: 'cut', cutId: cut.cut_id, version: version === cut.version ? undefined : version }} inline lanes="edit" {facts} actions={lockKey} {detailsHost} bind:entry={cutView.entry} onscore={() => (scoring = true)} />
		{/key}
	{:else if step === 'sound'}
		<SoundStep {project} {cut} {version} {facts} {detailsHost} {onUpdated} {onAgent} />
	{:else}
		<ExportStep {project} {cut} {version} {facts} {detailsHost} {onUpdated} {onManifest} />
	{/if}
	{#if notice && step === 'picture'}<p class="said note" role="status">{notice}</p>{/if}
	{#if error}<p class="said" role="alert">{error}</p>{/if}
	{#if scoring && cut}<div class="score"><ScorePromptPanel projectId={project.project_id} cutId={cut.cut_id} cutName={cut.name} onclose={() => (scoring = false)} /></div>{/if}
</div>

{#if detailsHost && (!cut || version === null || blocked)}
	<div class="details" use:intoDock={detailsHost}><p class="cp">Nothing selected</p></div>
{/if}

<style>
	.cut-stage { position: relative; display: flex; height: 100%; min-height: 0; flex-direction: column; color: var(--color-ink-2); font: 12.5px/1.35 var(--font-sans); }
	.bar { display: flex; flex: none; align-items: center; gap: 7px; padding: 10px 14px 6px; }
	h1 { margin: 0; color: var(--color-ink); font-size: 13px; font-weight: 400; white-space: nowrap; }
	.code { color: var(--color-teal); font: 10.5px var(--font-mono); letter-spacing: 0.01em; }
	.none { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; }
	.none .cp { margin: 0; color: var(--color-ink-3); }
	.text { margin: 0; max-width: 60ch; line-height: 1.5; }
	.row { display: flex; gap: 4px; padding-top: 4px; }
	.said { margin: 0; flex: none; padding: 0 14px 8px; color: #ff7a6b; font: 10.5px var(--font-mono); }
	.said.note { color: var(--color-teal-ink); }
	.score { position: absolute; right: 12px; bottom: 12px; z-index: 30; width: min(560px, calc(100% - 24px)); max-height: calc(100% - 24px); overflow-y: auto; border-radius: 10px; background: var(--color-raised); box-shadow: 0 12px 32px rgb(0 0 0 / 0.6); }
	.phone-bar { display: none; flex: none; padding: 8px 10px 0; }
	.phone-bar .tg { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
	.phone-cuts { position: absolute; inset: 36px 0 0; z-index: 20; overflow-y: auto; background: var(--color-panel); }
	@media (max-width: 767px) { .phone-bar { display: flex; } }
	.details { padding: 12px 14px; }
	.details .cp { margin: 0; color: var(--color-ink-3); }
</style>
