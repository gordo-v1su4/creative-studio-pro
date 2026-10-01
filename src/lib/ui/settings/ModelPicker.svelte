<script lang="ts">
	import type { ModelProviderKind, ModelTestResult, ProviderModel, ProviderOption } from '$lib/domain/model-provider';
	import { loadVisionModels, testModel } from '$lib/ui/model-provider-client';

	/** Provider + vision-only model picker; picking a model runs the quick model test. */
	let {
		providers,
		provider = $bindable<ModelProviderKind | ''>(''),
		model = $bindable(''),
		test = $bindable<ModelTestResult | null>(null),
		idPrefix = 'model'
	}: {
		providers: ProviderOption[];
		provider?: ModelProviderKind | '';
		model?: string;
		test?: ModelTestResult | null;
		idPrefix?: string;
	} = $props();

	let models = $state<ProviderModel[]>([]);
	let hidden = $state(0);
	let loading = $state(false);
	let testing = $state(false);
	let error = $state<string | null>(null);
	let loadedFor = $state('');

	async function loadModels(kind: ModelProviderKind) {
		loading = true; error = null; models = []; hidden = 0; loadedFor = kind;
		try {
			const listed = await loadVisionModels(kind);
			models = listed.models;
			hidden = listed.hidden_non_vision;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Model list failed';
		} finally {
			loading = false;
		}
	}

	async function runTest() {
		if (!provider || !model) return;
		testing = true; error = null; test = null;
		try { test = (await testModel(provider, model)).result; }
		catch (cause) { error = cause instanceof Error ? cause.message : 'Model test failed'; }
		finally { testing = false; }
	}

	function onProviderChange() {
		model = ''; test = null;
		if (provider) void loadModels(provider);
	}

	function onModelChange() {
		test = null;
		if (model) void runTest();
	}

	$effect(() => {
		if (provider && loadedFor !== provider && !loading) void loadModels(provider);
	});
</script>

<div class="grid gap-2">
	<div class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2 max-sm:grid-cols-1">
		<label class="grid gap-1">
			<span class="meta-label">Provider</span>
			<select id="{idPrefix}-provider" bind:value={provider} onchange={onProviderChange} class="rounded-sm border border-border-default bg-surface-base p-2">
				<option value="" disabled>Pick a provider</option>
				{#each providers as option (option.id)}
					<option value={option.id} disabled={!option.configured}>{option.label}{option.configured ? '' : ' (not set up)'}</option>
				{/each}
			</select>
		</label>
		<label class="grid gap-1">
			<span class="meta-label">Model · vision-capable only</span>
			<select id="{idPrefix}-model" bind:value={model} onchange={onModelChange} disabled={!provider || loading || models.length === 0} class="rounded-sm border border-border-default bg-surface-base p-2">
				<option value="" disabled>{loading ? 'Loading live model list…' : models.length ? 'Pick a model' : 'No vision models listed'}</option>
				{#each models as option (option.id)}
					<option value={option.id}>{option.label}{option.vision_source === 'allowlist' ? ' · known vision' : ''}</option>
				{/each}
			</select>
		</label>
	</div>
	{#if provider && provider !== 'hyper' && !loading && (models.length === 0 || provider === 'custom')}
		<!-- Endpoints without a usable /models list: type the id; the image test proves vision. -->
		<div class="flex gap-2 max-sm:flex-col">
			<input id="{idPrefix}-model-id" aria-label="Model id" placeholder="Model id (vision-capable)" value={model} onchange={(event) => { model = event.currentTarget.value.trim(); test = null; }} class="grow rounded-sm border border-border-default bg-surface-base p-2" />
			<button type="button" class="btn px-2.5 py-1" disabled={!model || testing} onclick={() => void runTest()}>Test model</button>
		</div>
	{/if}
	{#if hidden > 0}
		<p class="text-text-dim">{hidden} text-only model{hidden === 1 ? '' : 's'} hidden — the Agent must read stills, sheets and frames.</p>
	{/if}
	{#if testing}
		<p class="text-text-muted" role="status">Testing {model}: image input, structured answer, rule following…</p>
	{:else if test}
		<p class={test.passed ? 'text-gate-approved' : 'text-gate-failed'} role="status">
			Model test {test.passed ? 'PASS' : 'FAIL'} · image {test.checks.image ? '✓' : '✗'} · structured {test.checks.structured ? '✓' : '✗'} · rules {test.checks.rules ? '✓' : '✗'} · {test.latency_ms} ms — {test.detail}
		</p>
	{/if}
	{#if model && !testing}
		<button type="button" class="btn w-fit px-2.5 py-1" onclick={() => void runTest()}>Re-run model test</button>
	{/if}
	{#if error}
		<p class="text-gate-failed" role="alert">{error}</p>
	{/if}
</div>
