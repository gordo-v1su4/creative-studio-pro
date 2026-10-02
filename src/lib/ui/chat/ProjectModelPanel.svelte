<script lang="ts">
	import Toggle from '$lib/ui/controls/Toggle.svelte';
	import { PROVIDER_LABELS, describeModelChoice } from '$lib/domain/model-provider';
	import type { ModelProviderKind, ModelTestResult, ProjectModelView, ProviderOption } from '$lib/domain/model-provider';
	import type { Project } from '$lib/domain/schemas';
	import { ui } from '$lib/ui/app-state.svelte';
	import { changeProjectModel, loadModelSettings, loadProjectModel } from '$lib/ui/model-provider-client';
	import ModelPicker from '$lib/ui/settings/ModelPicker.svelte';

	/** The project's Agent model: effective pick, lock, and the explicit, logged switch. */
	let { project, label = $bindable('') }: { project: Project; label?: string } = $props();

	let view = $state<ProjectModelView | null>(null);
	let providers = $state<ProviderOption[]>([]);
	let loadedKey = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);
	let editing = $state(false);
	let provider = $state<ModelProviderKind | ''>('');
	let model = $state('');
	let test = $state<ModelTestResult | null>(null);
	let reason = $state('');
	let confirmSwitch = $state(false);
	let token = $state('');
	let locked = $derived(Boolean(view?.locked_at));

	async function refresh(target: Project) {
		error = null;
		try {
			view = await loadProjectModel(target.project_id);
			label = view.effective ? `${view.effective.provider} · ${view.effective.model}` : 'no model';
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Project model failed to load'; }
	}

	async function openEditor() {
		editing = !editing;
		if (editing && providers.length === 0) {
			try { providers = (await loadModelSettings()).providers; }
			catch (cause) { error = cause instanceof Error ? cause.message : 'Providers failed to load'; }
		}
	}

	async function apply(choice: { provider: ModelProviderKind; model: string } | null) {
		if (busy || !token) return;
		busy = true; error = null;
		try {
			const next = await changeProjectModel(project.project_id, token, {
				expected_version: project.version,
				choice,
				reason: reason.trim() || null,
				confirm_switch: locked ? confirmSwitch : false
			});
			token = ''; reason = ''; confirmSwitch = false; editing = false; model = ''; test = null;
			ui.adoptActiveProject(next);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Model change failed'; }
		finally { busy = false; }
	}

	$effect(() => {
		const key = `${project.project_id}@${project.version}`;
		if (key !== loadedKey) { loadedKey = key; void refresh(project); }
	});
</script>

<div class="agent-model rounded-md border border-border-default px-3 py-2 text-[12px]">
	<div class="flex flex-wrap items-center gap-2">
		<span class="meta-label">Agent model</span>
		{#if view}
			<b>{view.effective ? `${PROVIDER_LABELS[view.effective.provider]} · ${view.effective.model}` : 'none configured'}</b>
			<span class="text-text-dim">{locked ? `locked since ${view.locked_at?.slice(0, 10)}` : view.source === 'project' ? 'project override · locks on first run' : 'app default · locks on first run'}</span>
		{/if}
		<span class="grow"></span>
		<button type="button" class="btn px-2 py-0.5" onclick={() => void openEditor()} aria-expanded={editing}>{editing ? 'Cancel' : locked ? 'Switch model' : 'Change'}</button>
	</div>
	{#if view && !view.available && view.message}
		<p class="mt-1 text-gate-failed" role="alert">{view.message}</p>
	{/if}
	{#if editing}
		<div class="mt-2 grid gap-2">
			{#if locked}
				<p class="text-gate-pending">This project is locked to {describeModelChoice(view?.override ?? null)}. Switching is recorded permanently in the project history with your reason.</p>
			{/if}
			<ModelPicker {providers} bind:provider bind:model bind:test idPrefix="project-model" />
			<textarea bind:value={reason} rows="2" placeholder={locked ? 'Reason for switching (required)' : 'Reason (optional)'} aria-label="Reason for the model change" class="rounded-sm border border-border-default bg-surface-base p-2"></textarea>
			{#if locked}
				<span class="flex items-center gap-2"><Toggle label="I am switching this project's Agent model on purpose" on="yes" off="no" bind:checked={confirmSwitch} /> I am switching this project's Agent model on purpose</span>
			{/if}
			<input type="password" autocomplete="off" bind:value={token} placeholder="Operator credential (required)" aria-label="Operator credential" class="rounded-sm border border-border-default bg-surface-base p-2" />
			<div class="flex flex-wrap gap-2">
				<button type="button" class="btn btn-accent px-2.5 py-1" disabled={busy || !provider || !model || !token || (locked && (!confirmSwitch || reason.trim().length < 3))} onclick={() => provider && void apply({ provider, model })}>{locked ? 'Switch model' : 'Use for this project'}</button>
				{#if !locked && view?.override}
					<button type="button" class="btn px-2.5 py-1" disabled={busy || !token} onclick={() => void apply(null)}>Follow app default</button>
				{/if}
			</div>
		</div>
	{/if}
	{#if view && view.history.length}
		<details class="mt-1">
			<summary class="cursor-pointer text-text-dim">Model history ({view.history.length})</summary>
			<ul class="mt-1 grid gap-0.5 text-text-muted">
				{#each [...view.history].reverse() as entry, index (index)}
					<li>{entry.timestamp.slice(0, 16).replace('T', ' ')} · {entry.event} · {describeModelChoice(entry.from)} → {describeModelChoice(entry.to)} · {entry.operator}{entry.reason ? ` · “${entry.reason}”` : ''}</li>
				{/each}
			</ul>
		</details>
	{/if}
	{#if error}
		<p class="mt-1 text-gate-failed" role="alert">{error}</p>
	{/if}
</div>
