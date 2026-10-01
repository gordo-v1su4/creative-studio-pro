<script lang="ts">
	import { onMount } from 'svelte';
	import { PROVIDER_LABELS, describeModelChoice } from '$lib/domain/model-provider';
	import type { ModelProviderKind, ModelSettingsView, ModelTestResult } from '$lib/domain/model-provider';
	import { loadModelSettings, saveModelSettings } from '$lib/ui/model-provider-client';
	import ModelPicker from './ModelPicker.svelte';

	/** Settings → Agent model: presets, keys (write-only), vision-only picker, app default. */
	let view = $state<ModelSettingsView | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let hyperKey = $state('');
	let customBase = $state('');
	let customKey = $state('');
	let provider = $state<ModelProviderKind | ''>('');
	let model = $state('');
	let test = $state<ModelTestResult | null>(null);

	async function refresh() {
		error = null;
		try {
			view = await loadModelSettings();
			customBase = view.settings.custom.base_url ?? '';
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Settings failed to load'; }
	}

	async function save(patch: Parameters<typeof saveModelSettings>[0], done: string) {
		busy = true; error = null; notice = null;
		try {
			view = await saveModelSettings(patch);
			notice = done;
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Save failed'; }
		finally { busy = false; }
	}

	async function saveHyper(clear = false) {
		await save({ hyper_api_key: clear ? null : hyperKey.trim() }, clear ? 'Hyper key removed.' : 'Hyper key saved.');
		hyperKey = '';
	}

	async function saveCustom() {
		await save({ custom_base_url: customBase.trim() || null, ...(customKey.trim() && { custom_api_key: customKey.trim() }) }, 'Custom endpoint saved.');
		customKey = '';
	}

	onMount(() => void refresh());
</script>

<section class="mt-8" aria-labelledby="agent-model-heading">
	<div id="agent-model-heading" class="meta-label">Agent model</div>
	<p class="mt-1 text-text-muted">
		The Model provider the Agent runs on. Keys stay in server-side app settings — never in a project, its ledger, or this page.
		Projects follow the app default until they first run the Agent, then lock to that model.
	</p>

	{#if error}
		<div class="mt-3 rounded-sm border border-[color-mix(in_srgb,var(--color-gate-failed)_55%,var(--color-border-default))] bg-surface-raised p-2.5 text-gate-failed" role="alert">{error}</div>
	{/if}
	{#if notice}
		<p class="mt-3 text-gate-approved" role="status">{notice}</p>
	{/if}

	{#if view}
		<div class="mt-3 rounded-sm border border-border-default bg-surface-raised px-3 py-2.5">
			<span class="meta-label">App default</span>
			<b class="ml-2 text-[13px]">{describeModelChoice(view.settings.default_model)}</b>
			{#if !view.settings.default_model}
				<span class="ml-2 text-text-muted">{view.env_fallback ? `→ falls back to ${PROVIDER_LABELS.kimi} · ${view.env_fallback.model}` : '→ nothing configured yet'}</span>
			{/if}
		</div>

		<div class="mt-3 grid gap-2 rounded-sm border border-border-default bg-surface-raised p-3">
			<b class="text-[13px]">Hyper</b>
			<span class="text-text-muted">One key, live model list from hyper.charm.land/v1. {view.settings.hyper.has_key ? 'Key saved.' : 'No key saved.'}</span>
			<div class="flex gap-2 max-sm:flex-col">
				<input type="password" autocomplete="off" aria-label="Hyper API key" placeholder={view.settings.hyper.has_key ? 'Replace key' : 'Hyper API key'} bind:value={hyperKey} class="grow rounded-sm border border-border-default bg-surface-base p-2" />
				<button type="button" class="btn px-2.5 py-1" disabled={busy || !hyperKey.trim()} onclick={() => void saveHyper()}>Save key</button>
				{#if view.settings.hyper.has_key}
					<button type="button" class="btn px-2.5 py-1" disabled={busy} onclick={() => void saveHyper(true)}>Remove</button>
				{/if}
			</div>
		</div>

		<div class="mt-2 grid gap-2 rounded-sm border border-border-default bg-surface-raised p-3">
			<b class="text-[13px]">Custom endpoint</b>
			<span class="text-text-muted">Any OpenAI-compatible base URL. {view.settings.custom.has_key ? 'Key saved.' : 'No key saved.'}</span>
			<input aria-label="Custom base URL" placeholder="https://example.com/v1" bind:value={customBase} class="rounded-sm border border-border-default bg-surface-base p-2" />
			<div class="flex gap-2 max-sm:flex-col">
				<input type="password" autocomplete="off" aria-label="Custom endpoint API key" placeholder={view.settings.custom.has_key ? 'Replace key (blank keeps it)' : 'API key'} bind:value={customKey} class="grow rounded-sm border border-border-default bg-surface-base p-2" />
				<button type="button" class="btn px-2.5 py-1" disabled={busy} onclick={() => void saveCustom()}>Save endpoint</button>
			</div>
		</div>

		{#if view.raycast_connected}
			<div class="mt-2 rounded-sm border border-border-default bg-surface-raised px-3 py-2.5">
				<b class="text-[13px]">Raycast bridge</b>
				<span class="ml-2 text-gate-approved">connected</span>
			</div>
		{/if}

		<div class="mt-3 grid gap-2 rounded-sm border border-border-default bg-surface-raised p-3">
			<b class="text-[13px]">Pick the app default</b>
			<ModelPicker providers={view.providers} bind:provider bind:model bind:test idPrefix="app-default" />
			<div class="flex gap-2">
				<button type="button" class="btn btn-accent px-2.5 py-1" disabled={busy || !provider || !model} onclick={() => provider && void save({ default_model: { provider, model } }, `App default set to ${model}.`)}>Use as app default</button>
				{#if view.settings.default_model}
					<button type="button" class="btn px-2.5 py-1" disabled={busy} onclick={() => void save({ default_model: null }, 'App default cleared.')}>Clear default</button>
				{/if}
			</div>
			{#if test && !test.passed}
				<p class="text-gate-pending">This model failed the test. You can still use it, but expect rule-breaking answers (the Agent retries once, then stops).</p>
			{/if}
		</div>
	{:else if !error}
		<p class="mt-3 text-text-dim">Loading…</p>
	{/if}
</section>
