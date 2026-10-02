<script lang="ts">
	import { onMount } from 'svelte';

	/** Settings → Sound effects (V1S-129): the local folder the Agent picks hits, whooshes and risers from. */
	type Summary = { folder: string | null; exists: boolean; counts: Record<string, number> };
	let summary = $state<Summary | null>(null);
	let folder = $state('');
	let saving = $state(false);
	let error = $state<string | null>(null);

	async function load(response: Response) {
		const result = (await response.json()) as { ok: true; data: Summary } | { ok: false; error: { message: string } };
		if (!result.ok) { error = result.error.message; return; }
		summary = result.data;
		folder = result.data.folder ?? '';
	}

	onMount(() => void fetch('/api/settings/sfx').then(load));

	async function save() {
		saving = true; error = null;
		try { await load(await fetch('/api/settings/sfx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: folder.trim() || null }) })); }
		finally { saving = false; }
	}
	const total = $derived(summary ? Object.values(summary.counts).reduce((s, n) => s + n, 0) : 0);
</script>

<section class="border border-[#29434a] bg-[#11171d] p-5" aria-label="Sound effects settings">
	<div class="meta-label text-[#59d9cf]">SOUND EFFECTS</div>
	<p class="mt-2 text-[12px] leading-5 text-[#789da7]">A local folder of sound effects. The Agent's effects pass picks hits, whooshes and risers from it by name; loops, drums and vocals are left out.</p>
	<div class="mt-3 flex items-center gap-2">
		<input class="path" bind:value={folder} placeholder="e.g. E:\music\Splice\Samples" aria-label="Sound effects folder" />
		<button type="button" class="btn btn-accent" onclick={() => void save()} disabled={saving}>{saving ? 'Indexing…' : 'Save'}</button>
	</div>
	{#if summary}
		<p class="mt-2 font-mono text-[11px] {summary.folder && !summary.exists ? 'text-gate-failed' : 'text-[#9fc9cf]'}">
			{#if !summary.folder}No folder set.{:else if !summary.exists}That folder doesn't exist.{:else}{total} effects: {summary.counts.hit ?? 0} hits · {summary.counts.whoosh ?? 0} whooshes · {summary.counts.riser ?? 0} risers{/if}
		</p>
	{/if}
	{#if error}<p class="mt-2 text-gate-failed" role="alert">{error}</p>{/if}
</section>

<style>
	.path { flex: 1; border: 1px solid #26383f; background: #0a0d11; padding: 4px 8px; color: #bce6e8; font: 12px var(--font-mono); outline: none; }
	.path:focus { border-color: #4ee8d2; }
</style>
