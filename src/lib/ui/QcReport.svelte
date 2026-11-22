<script lang="ts">
	import type { Project } from '$lib/domain/schemas';
	import { qcHeadline, timecode, type QcReport, type QcStatus } from '$lib/domain/qc';
	import Pick from '$lib/ui/controls/Pick.svelte';
	import Toggle from '$lib/ui/controls/Toggle.svelte';

	/**
	 * QC report (V1S-505) of a locked cut version's render: picture (contact sheet),
	 * sound present, song sync, lip sync and length, each pass / warn / fail with
	 * timecodes. Runs after every export; "Check again" runs it on the export or on
	 * any rendered cut in the project (an exact-mix playback cut), optionally with ASR.
	 */
	let { project, cutId, version, report, exportUrl, onUpdated }: {
		project: Project; cutId: string; version: number; report: QcReport | null; exportUrl: string | null; onUpdated: (project: Project) => void;
	} = $props();

	const renders = $derived([
		...(exportUrl ? [{ value: exportUrl, label: 'The export MP4' }] : []),
		...project.production.assets.filter((a) => a.kind === 'video' && /cut|mix/i.test(a.name)).reverse().map((a) => ({ value: a.url, label: a.name }))
	]);
	let chosen = $state<string | null>(null);
	const target = $derived(chosen ?? report?.file ?? renders[0]?.value ?? null);
	let asr = $state(false);
	let running = $state(false);
	let error = $state<string | null>(null);
	let open = $state<Record<string, boolean>>({});

	const tone: Record<QcStatus, string> = { pass: 'text-[#7de5dc]', warn: 'text-[#e3a86b]', fail: 'text-gate-failed' };

	async function check() {
		if (!target) return;
		running = true; error = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/sound`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'qc', cut_id: cutId, version, url: target, asr }) });
			const result = (await response.json()) as { ok: true; data: Project } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			onUpdated(result.data);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'QC failed'; }
		finally { running = false; }
	}
</script>

<div class="mt-4 border-t border-[#1a1f23] pt-3" aria-label="QC report">
	<div class="flex flex-wrap items-center gap-3">
		<span class="cap">QC report</span>
		{#if report}
			<span class={['text-[11.5px] font-semibold', tone[report.status]]} role="status">{qcHeadline(report)}</span>
			<span class="text-[11px] text-[#5b6b70]">{new Date(report.at).toLocaleString()}</span>
		{:else}
			<span class="text-[11px] text-[#5b6b70]">not run on this version yet</span>
		{/if}
		<span class="grow"></span>
		{#if renders.length > 1}<Pick label="Render to check" value={target ?? ''} options={renders} onchange={(v) => (chosen = v)} />{/if}
		<span class="flex items-center gap-1.5 text-[10px] text-[#7b878f]">ASR <Toggle label="Run local speech recognition on dialogue" bind:checked={asr} /></span>
		<button type="button" class="key" onclick={() => void check()} disabled={!target || running}>{running ? 'Checking…' : report ? 'Check again' : 'Run QC'}</button>
	</div>
	{#if error}<p class="mt-2 text-gate-failed" role="alert">{error}</p>{/if}
	{#if report}
		{#if report.file !== exportUrl}<p class="mt-1 font-mono text-[10.5px] text-[#5b6b70]">{decodeURIComponent(report.file.split('/').pop() ?? report.file)}</p>{/if}
		<ul class="mt-2 grid gap-1">
			{#each report.checks as c (c.id)}
				{@const issues = c.items.filter((i) => i.status !== 'pass')}
				<li class="text-[11.5px]">
					<button type="button" class="row" aria-expanded={!!open[c.id]} onclick={() => (open = { ...open, [c.id]: !open[c.id] })}>
						<span class={['w-10 shrink-0 text-[9.5px] font-semibold uppercase tracking-[0.12em]', tone[c.status]]}>{c.status}</span>
						<span class="w-28 shrink-0 text-[#b9cfd2]">{c.label}</span>
						<span class="text-[#8a969e]">{c.summary}</span>
						{#if issues.length}<span class={['ml-auto text-[10.5px]', tone[c.status]]}>{issues.length}</span>{/if}
					</button>
					{#if open[c.id]}
						<ul class="mb-1 ml-10 mt-0.5 grid gap-0.5 text-[11px]">
							{#each c.items as item, i (i)}
								<li class={item.status === 'pass' ? 'text-[#6d7a80]' : tone[item.status]}>{#if item.at_s !== undefined}<span class="mr-2 font-mono text-[#5b6b70]">{timecode(item.at_s)}</span>{/if}{item.message}</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
		{#if report.sheet}
			<!-- The sheet keeps its name on every run: the run time keeps a cached older sheet from showing. -->
			{@const sheet = `${report.sheet}?at=${encodeURIComponent(report.at)}`}
			<a class="mt-3 block" href={sheet} target="_blank" rel="noreferrer"><img class="max-h-64 w-full rounded-[2px] border border-[#1a1f23] object-contain object-left" src={sheet} alt="QC contact sheet: one frame per entry, plus the first and last second" /></a>
		{/if}
	{/if}
</div>

<style>
	.cap { color: #7b878f; font: 600 10px var(--font-sans); letter-spacing: 0.16em; text-transform: uppercase; }
	.key { border: 1px solid #262c31; border-radius: 2px; padding: 0 8px; color: #8a969e; font: 600 9px/18px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; transition: border-color 140ms ease, color 140ms ease; }
	.key:hover:not(:disabled) { border-color: rgba(78, 232, 210, 0.45); color: #7de5dc; }
	.key:disabled { opacity: 0.4; }
	.row { display: flex; width: 100%; align-items: baseline; gap: 8px; padding: 2px 4px; border-radius: 2px; text-align: left; }
	.row:hover { background: #12171a; }
</style>
