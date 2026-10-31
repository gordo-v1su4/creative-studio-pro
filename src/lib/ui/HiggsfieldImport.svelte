<script lang="ts">
	/**
	 * Import from Higgsfield: the operator's newest finished renders (videos or stills), ticked and brought in
	 * as new shots, oldest first so they land in the order they were made. Renders already in the project are
	 * marked and can't be ticked. Higgsfield has no "liked" filter, so this shows the newest.
	 */
	type Render = { job_id: string; kind: 'video' | 'image'; model: string; created_at: string; prompt: string; duration_s: number | null; aspect_ratio: string | null; thumbnail_url: string | null; result_url: string };
	let { have, onImport, onclose }: {
		/** Job ids already in the project. */
		have: Set<string>;
		onImport: (jobIds: string[]) => void;
		onclose: () => void;
	} = $props();

	let kind = $state<'video' | 'image'>('video');
	let size = $state(48);
	let renders = $state<Render[] | null>(null);
	let error = $state<string | null>(null);
	let loading = $state(false);
	let picked = $state<Set<string>>(new Set());

	async function load() {
		loading = true; error = null;
		try {
			const body = (await (await fetch(`/api/higgsfield/renders?kind=${kind}&size=${size}`)).json()) as { ok: true; data: Render[] } | { ok: false; error: { message: string } };
			if (!body.ok) throw new Error(body.error.message);
			renders = body.data;
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Could not list renders'; renders = []; }
		finally { loading = false; }
	}
	$effect(() => { void kind; void size; picked = new Set(); void load(); });

	function toggle(id: string) {
		const next = new Set(picked);
		if (next.has(id)) next.delete(id); else next.add(id);
		picked = next;
	}
	function importPicked() {
		// Oldest first, so the shots land in the order they were rendered.
		const ids = (renders ?? []).filter((render) => picked.has(render.job_id)).map((render) => render.job_id).reverse();
		onImport(ids);
		onclose();
	}
	const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	const fresh = $derived((renders ?? []).filter((render) => !have.has(render.job_id)));
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape') onclose(); }} />
<div class="hf-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) onclose(); }}>
	<section class="hf-panel" aria-label="Import from Higgsfield">
		<header class="flex flex-wrap items-center gap-2 border-b border-[#223039] px-4 py-3">
			<b class="meta-label text-[#59d9cf]">Import from Higgsfield</b>
			<nav class="card-face-nav" aria-label="Kind">
				<button type="button" class:active={kind === 'video'} onclick={() => (kind = 'video')} aria-pressed={kind === 'video'}>videos</button>
				<button type="button" class:active={kind === 'image'} onclick={() => (kind = 'image')} aria-pressed={kind === 'image'}>stills</button>
			</nav>
			<span class="text-[11px] text-[#668d98]">newest {renders?.length ?? '…'} finished{size < 100 ? '' : ' (the most the CLI gives)'}</span>
			{#if size < 100}<button type="button" class="agent-mini" onclick={() => (size = 100)} disabled={loading}>show more</button>{/if}
			<span class="grow"></span>
			{#if fresh.length}<button type="button" class="agent-mini" onclick={() => (picked = picked.size === fresh.length ? new Set() : new Set(fresh.map((render) => render.job_id)))}>{picked.size === fresh.length ? 'none' : 'all'}</button>{/if}
			<button type="button" class="btn btn-accent" disabled={picked.size === 0} onclick={importPicked}>Import {picked.size || ''} as shots</button>
			<button type="button" class="agent-mini" onclick={onclose}>close</button>
		</header>
		{#if error}<p class="px-4 py-3 text-[12px] text-gate-failed" role="alert">{error}</p>{/if}
		{#if loading && !renders}<p class="px-4 py-6 text-[12px] text-[#668d98]">Asking Higgsfield…</p>{/if}
		<ul class="hf-grid" aria-busy={loading}>
			{#each renders ?? [] as render (render.job_id)}
				{@const inProject = have.has(render.job_id)}
				<li>
					<button type="button" class={['hf-card', picked.has(render.job_id) && 'picked', inProject && 'had']} disabled={inProject} onclick={() => toggle(render.job_id)} aria-pressed={picked.has(render.job_id)} title={render.prompt}>
						{#if render.thumbnail_url}<img src={render.thumbnail_url} alt="" loading="lazy" />{:else}<span class="hf-none">no preview</span>{/if}
						<span class="hf-meta">{render.model}{render.duration_s ? ` · ${render.duration_s}s` : ''}{render.aspect_ratio ? ` · ${render.aspect_ratio}` : ''}</span>
						<span class="hf-meta">{when(render.created_at)}{inProject ? ' · in project' : ''}</span>
						<span class="hf-prompt">{render.prompt.replace(/\s+/g, ' ').slice(0, 120)}</span>
					</button>
				</li>
			{/each}
		</ul>
		{#if renders && renders.length === 0 && !error}<p class="px-4 py-6 text-[12px] text-[#668d98]">No finished {kind === 'video' ? 'videos' : 'stills'} on this Higgsfield account.</p>{/if}
	</section>
</div>

<style>
	.hf-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; background: rgb(5 7 10 / 0.75); padding: 24px; }
	.hf-panel { display: grid; grid-template-rows: auto auto 1fr; width: min(1100px, 100%); max-height: calc(100vh - 48px); overflow: hidden; border: 1px solid #29434a; background: #0b1114; }
	.hf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; overflow: auto; padding: 12px 16px 16px; }
	.hf-card { display: grid; gap: 3px; width: 100%; border: 1px solid #223039; background: transparent; padding: 4px; text-align: left; cursor: pointer; }
	.hf-card:hover { border-color: #31565d; }
	.hf-card.picked { border-color: #59d9cf; box-shadow: inset 0 0 0 1px #59d9cf; }
	.hf-card.had { opacity: 0.45; cursor: default; }
	.hf-card img, .hf-none { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: #05080a; }
	.hf-none { display: grid; place-items: center; color: #668d98; font: 600 9px var(--font-mono); text-transform: uppercase; }
	.hf-meta { color: #789da7; font: 10px var(--font-mono); }
	.hf-prompt { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; color: #9fc9cf; font-size: 11px; line-height: 1.35; }
</style>
