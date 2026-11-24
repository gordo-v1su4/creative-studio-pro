<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';

	/**
	 * Settings → Notion (decision 23, ADR 0010). One operator, one key: it is entered here, kept on the server and
	 * never shown again. Notion is optional: with no key the app reads and writes nothing there, and a project is
	 * made entirely in the app. The series template's public address is a separate setting, shown on the front door.
	 */
	type View = { has_key: boolean; source: 'settings' | 'environment' | null; template_url: string | null };
	let view = $state<View | null>(null);
	let key = $state('');
	let template = $state('');
	let busy = $state<'' | 'key' | 'remove' | 'template'>('');
	let said = $state<{ text: string; bad?: boolean } | null>(null);

	async function send(body?: Record<string, unknown>): Promise<boolean> {
		try {
			const response = await fetch('/api/settings/notion', body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
			const result = (await response.json()) as { ok: true; data: View; note?: string | null } | { ok: false; error: { message: string } };
			if (!result.ok) { said = { text: result.error.message, bad: true }; return false; }
			view = result.data;
			template = result.data.template_url ?? '';
			if (body) { said = { text: result.note ?? 'Saved.' }; void invalidateAll(); }
			return true;
		} catch { said = { text: 'The Notion settings could not be reached', bad: true }; return false; }
	}
	onMount(() => void send());

	async function saveKey() {
		if (!key.trim() || busy) return;
		busy = 'key'; said = null;
		if (await send({ api_key: key.trim() })) key = '';
		busy = '';
	}
	async function removeKey() {
		if (busy) return;
		busy = 'remove'; said = null;
		if (await send({ api_key: null })) said = { text: view?.has_key ? 'Removed from Settings. The NOTION_TOKEN variable on the server is still in use.' : 'Removed. Nothing is read from Notion or written to it now.' };
		busy = '';
	}
	async function saveTemplate() {
		if (busy) return;
		busy = 'template'; said = null;
		await send({ template_url: template.trim() || null });
		busy = '';
	}
</script>

<section class="border border-[#29434a] bg-[#11171d] p-5" aria-label="Notion settings">
	<div class="meta-label text-[#59d9cf]">NOTION</div>
	<p class="mt-2 text-[12px] leading-5 text-[#789da7]">Optional. With a key, a series can be read from Notion and its names are written back there. With none, a project lives entirely in this app.</p>

	<p class="mt-3 font-mono text-[11px] text-[#9fc9cf]">
		{#if !view}Checking…
		{:else if view.source === 'settings'}A key is set. It is kept on the server and is not shown again.
		{:else if view.source === 'environment'}Using the NOTION_TOKEN variable from the server environment. A key entered here takes its place.
		{:else}No key. Nothing is read from Notion or written to it.{/if}
	</p>
	<form class="mt-2 flex items-center gap-2" onsubmit={(event) => { event.preventDefault(); void saveKey(); }}>
		<input class="field" type="password" autocomplete="off" bind:value={key} placeholder={view?.source === 'settings' ? 'Enter a new key to replace it' : 'Paste the connection token'} aria-label="Notion key" />
		<button type="submit" class="btn btn-accent" disabled={!key.trim() || !!busy}>{busy === 'key' ? 'Checking…' : 'Save key'}</button>
		{#if view?.source === 'settings'}<button type="button" class="btn" onclick={() => void removeKey()} disabled={!!busy}>{busy === 'remove' ? 'Removing…' : 'Remove'}</button>{/if}
	</form>

	<div class="meta-label mt-5 text-[#7b878f]">Series template · public address</div>
	<p class="mt-1 text-[12px] leading-5 text-[#789da7]">
		{#if view?.template_url}Shown on the front door as "Notion template · view or duplicate".
		{:else}<b class="font-normal text-gate-pending">Not set.</b> Publish the series template as a public Notion page (Share → Publish), then paste its address here. Until then the front door says "not published yet".{/if}
	</p>
	<form class="mt-2 flex items-center gap-2" onsubmit={(event) => { event.preventDefault(); void saveTemplate(); }}>
		<input class="field" type="url" bind:value={template} placeholder="https://…notion.site/Series-Template…" aria-label="Public address of the series template" />
		<button type="submit" class="btn" disabled={!!busy || template.trim() === (view?.template_url ?? '')}>{busy === 'template' ? 'Saving…' : 'Save address'}</button>
	</form>
	{#if said}<p class="mt-2 text-[12px] {said.bad ? 'text-gate-failed' : 'text-[#9fc9cf]'}" role={said.bad ? 'alert' : 'status'}>{said.text}</p>{/if}
</section>

<style>
	.field { flex: 1; min-width: 0; border: 1px solid #26383f; background: #0a0d11; padding: 4px 8px; color: #bce6e8; font: 12px var(--font-mono); outline: none; }
	.field:focus { border-color: #4ee8d2; }
</style>
