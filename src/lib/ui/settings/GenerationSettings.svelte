<script lang="ts">
	import { onMount } from 'svelte';

	/** Settings → Video generation: the Higgsfield API key for Animate (write-only, kept in app settings). */
	let hasKey = $state<boolean | null>(null);
	let key = $state('');
	let busy = $state(false);
	let message = $state<string | null>(null);

	async function call(init?: RequestInit) {
		const response = await fetch('/api/settings/generation', init);
		const result = (await response.json()) as { ok: true; data: { higgsfield: { has_key: boolean } } } | { ok: false; error: { message: string } };
		if (!result.ok) throw new Error(result.error.message);
		hasKey = result.data.higgsfield.has_key;
	}

	onMount(() => void call().catch((cause) => (message = cause instanceof Error ? cause.message : 'Failed to load')));

	async function save(value: string) {
		busy = true; message = null;
		try {
			await call({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ higgsfield_key: value }) });
			key = '';
			message = value ? 'Key saved.' : 'Key removed.';
		} catch (cause) { message = cause instanceof Error ? cause.message : 'Save failed'; }
		finally { busy = false; }
	}
</script>

<div class="meta-label mt-8">Video generation</div>
<div class="mt-2 rounded-sm border border-border-default bg-surface-raised p-3">
	<div class="flex items-center gap-2">
		<b>Higgsfield API</b>
		<span class="meta-label text-text-dim">{hasKey === null ? '…' : hasKey ? 'key set' : 'no key'}</span>
	</div>
	<p class="mt-1 text-text-muted">Animate sends stills to Seedance 2.5 through the Higgsfield API. It bills the API's own dollar balance (console.higgsfield.ai), not higgsfield.ai plan credits. Paste the key as KEY_ID:KEY_SECRET; it stays in server-side app settings.</p>
	<form class="mt-2 flex gap-2" onsubmit={(event) => { event.preventDefault(); if (key.trim()) void save(key.trim()); }}>
		<input type="password" autocomplete="off" bind:value={key} placeholder="KEY_ID:KEY_SECRET" class="min-w-0 grow rounded-sm border border-border-default bg-surface-base px-2 py-1 font-mono text-[12px] outline-none focus:border-text-dim" />
		<button type="submit" class="btn btn-accent" disabled={busy || !key.trim()}>Save key</button>
		{#if hasKey}<button type="button" class="btn" disabled={busy} onclick={() => void save('')}>Remove</button>{/if}
	</form>
	{#if message}<p class="mt-1 text-text-muted">{message}</p>{/if}
</div>
