<script lang="ts">
	import type { Project } from '$lib/domain/schemas';
	import { cutLength, cutsOf } from '$lib/domain/cuts';
	import { draftTakes } from '$lib/domain/export';

	/**
	 * Export (V1S-130): a locked, mixed cut version renders to an MP4 and a
	 * DaVinci Resolve timeline (FCPXML) with trims and ramps baked into
	 * per-entry files, plus the mix and stems. Takes still at draft
	 * resolution are listed before and after.
	 */
	let { project, onUpdated }: { project: Project; onUpdated: (project: Project) => void } = $props();

	const versions = $derived(cutsOf(project.production).flatMap((cut) => (cut.versions ?? []).map((v) => ({ cut, v, key: `${cut.cut_id}:${v.version}` }))).reverse());
	let selectedKey = $state<string | null>(null);
	const selected = $derived(versions.find((entry) => entry.key === selectedKey) ?? versions[0] ?? null);
	const mixed = $derived(Boolean(selected?.v.sound?.mix));
	const done = $derived(selected?.v.sound?.export ?? null);
	const drafts = $derived(selected ? draftTakes(selected.v.entries.map((entry) => ({
		title: project.production.cards.find((card) => card.card_id === entry.card_id)?.title ?? entry.card_id,
		take: project.production.assets.find((asset) => asset.asset_id === entry.asset_id)
	}))) : []);
	let exporting = $state(false);
	let error = $state<string | null>(null);

	async function exportNow() {
		if (!selected) return;
		exporting = true; error = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/sound`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'export', cut_id: selected.cut.cut_id, version: selected.v.version }) });
			const result = (await response.json()) as { ok: true; data: Project } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			onUpdated(result.data);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Export failed'; }
		finally { exporting = false; }
	}
</script>

<section class="mb-6" aria-label="Cut export">
	<div class="cap">Cut export</div>
	<p class="mt-2 text-[12px] leading-5 text-[#789da7]">A locked, mixed cut renders to an MP4 and a DaVinci Resolve timeline. Each entry is baked to its own file with its trim and speed ramp rendered in; the mix and one stem per layer ride under the picture.</p>
	{#if !selected}
		<p class="mt-3 border-y border-[#1a1f23] py-3 text-[12px] text-[#5b6b70]">No locked cuts yet: lock a cut in Cuts and build its mix in Sound.</p>
	{:else}
		<div class="mt-3 flex flex-wrap items-center gap-3 border-y border-[#1a1f23] py-3">
			<span class="cap">Cut</span>
			<select class="pick" value={selected.key} onchange={(event) => (selectedKey = event.currentTarget.value)} aria-label="Locked cut version">
				{#each versions as entry (entry.key)}<option value={entry.key}>{entry.cut.name} v{entry.v.version} · {cutLength(entry.v).toFixed(1)}s{entry.v.sound?.mix ? '' : ' · no mix'}</option>{/each}
			</select>
			<span class="grow"></span>
			{#if !mixed}<span class="text-[11px] text-[#5b6b70]">build its mix in Sound first</span>{/if}
			<button type="button" class="key" onclick={() => void exportNow()} disabled={!mixed || exporting}>{exporting ? 'Rendering…' : done ? 'Export again' : 'Export MP4 + Resolve timeline'}</button>
		</div>
		{#if drafts.length}
			<div class="mt-3" aria-label="Takes at draft resolution">
				<div class="cap text-[#d9c98a]">{drafts.length} {drafts.length === 1 ? 'take is' : 'takes are'} not at full resolution</div>
				<ul class="mt-1 grid gap-0.5 text-[11px] text-[#8a969e]">{#each drafts as d, i (i)}<li><span class="text-[#b9cfd2]">{d.title}</span> · {d.name} · {d.why}</li>{/each}</ul>
			</div>
		{/if}
		{#if error}<p class="mt-2 text-gate-failed" role="alert">{error}</p>{/if}
		{#if done}
			<div class="mt-4" aria-label="Exported files">
				<div class="flex flex-wrap items-center gap-3">
					<span class="cap">Exported</span>
					<span class="text-[11px] text-[#5b6b70]">{new Date(done.built_at).toLocaleString()}</span>
					<span class="grow"></span>
					<a class="key" href={done.mp4} download>MP4</a>
					<a class="key" href={done.fcpxml} download>Resolve timeline (.fcpxml)</a>
				</div>
				<p class="mt-2 text-[11px] leading-5 text-[#8a969e]">In Resolve: File → Import → Timeline… and pick the .fcpxml in <span class="font-mono text-[#b9cfd2]">{done.folder}</span>; the clips and stems it uses are in the same folder.</p>
				<ul class="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">{#each done.files as file (file.url)}<li><a class="text-[#7de5dc] hover:underline" href={file.url} download>{file.name}</a></li>{/each}</ul>
			</div>
		{/if}
	{/if}
</section>

<style>
	.cap { color: #7b878f; font: 600 10px var(--font-sans); letter-spacing: 0.16em; text-transform: uppercase; }
	.pick { border: 1px solid #22282d; border-radius: 2px; background: #0a0c0e; padding: 1px 6px; color: #b9cfd2; font: 11px var(--font-mono); }
	.key { border: 1px solid #262c31; border-radius: 2px; padding: 0 8px; color: #8a969e; font: 600 9px/18px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; transition: border-color 140ms ease, color 140ms ease; }
	.key:hover:not(:disabled) { border-color: rgba(78, 232, 210, 0.45); color: #7de5dc; }
	.key:disabled { opacity: 0.4; }
</style>
