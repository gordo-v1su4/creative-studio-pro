<script lang="ts">
	/**
	 * Cut → Export (slice 7): a locked, mixed version renders to an MP4 and a DaVinci Resolve timeline (V1S-130),
	 * stored as a Review Room deliverable when the project has one (V1S-280), then QC'd (V1S-505). No picture: the
	 * files, the QC report with one row per check (its items open in the dock's Details), and the contact sheet.
	 * What is rendered, stored and checked is unchanged; only where it is drawn moved.
	 */
	import type { Cut, Project } from '$lib/domain/schemas';
	import { draftTakes } from '$lib/domain/export';
	import { qcHeadline, timecode } from '$lib/domain/qc';
	import { cutView } from './cut-view.svelte';

	let { project, cut, version, facts, detailsHost = null, onUpdated, onManifest }: {
		project: Project; cut: Cut; version: number; facts: string; detailsHost?: HTMLElement | null;
		onUpdated: (project: Project) => void;
		/** Download the production manifest (the project as readable JSON). */
		onManifest?: () => void;
	} = $props();

	const record = $derived(cut.versions?.find((v) => v.version === version) ?? null);
	const mixed = $derived(!!record?.sound?.mix);
	const done = $derived(record?.sound?.export ?? null);
	const report = $derived(record?.sound?.qc ?? null);
	const drafts = $derived(record ? draftTakes(record.entries.map((entry) => ({
		title: project.production.cards.find((card) => card.card_id === entry.card_id)?.title ?? entry.card_id,
		take: project.production.assets.find((asset) => asset.asset_id === entry.asset_id)
	}))) : []);

	// Series episodes store the MP4 as a deliverable in Review Room's _Deliverables; a connected trailer stores any cut as its TRL.
	let kind = $state<'EPC' | 'TSR' | 'TRL' | 'none'>('EPC');
	let index = $state(1);
	let scope = $state<'episode' | 'series'>('episode');
	const KINDS = [{ value: 'EPC', label: 'Episode cut' }, { value: 'TSR', label: 'Teaser' }, { value: 'TRL', label: 'Trailer' }, { value: 'none', label: 'None' }] as const;
	let allDrafts = $state(false);
	let stored = $state<string | null>(null);
	let exporting = $state(false);
	let error = $state<string | null>(null);

	async function exportNow() {
		exporting = true; error = null;
		try {
			// The same request the old Export tab sent; a connected trailer's server side stores any kind as its TRL.
			const deliverable = (project.series || project.review_room) && kind !== 'none' ? { deliverable: { kind, scope, ...(kind === 'EPC' ? {} : { index }) } } : {};
			const response = await fetch(`/api/projects/${project.project_id}/sound`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'export', cut_id: cut.cut_id, version, ...deliverable }) });
			const result = (await response.json()) as { ok: true; data: Project; deliverable?: { code: string; version: number } | { error: string } | null } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			onUpdated(result.data);
			const d = result.deliverable;
			stored = d ? ('code' in d ? `Stored in Review Room as ${d.code}_v${String(d.version).padStart(3, '0')}, with its QC report in the notes` : `Not stored in Review Room: ${d.error}`) : null;
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Export failed'; }
		finally { exporting = false; }
	}

	// --- QC (V1S-505): run after every export; "Check again" runs it on the export or on any rendered cut.
	const renders = $derived([
		...(done?.mp4 ? [{ value: done.mp4, label: 'The export' }] : []),
		...project.production.assets.filter((a) => a.kind === 'video' && /cut|mix/i.test(a.name)).reverse().slice(0, 3).map((a) => ({ value: a.url, label: a.name }))
	]);
	let chosen = $state<string | null>(null);
	const target = $derived(chosen ?? report?.file ?? renders[0]?.value ?? null);
	let asr = $state(false);
	let checking = $state(false);
	async function check() {
		if (!target) return;
		checking = true; error = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/sound`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'qc', cut_id: cut.cut_id, version, url: target, asr }) });
			const result = (await response.json()) as { ok: true; data: Project } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			onUpdated(result.data);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'QC failed'; }
		finally { checking = false; }
	}
	const shownCheck = $derived(report?.checks.find((c) => c.id === cutView.qcCheck) ?? report?.checks.find((c) => c.status !== 'pass') ?? report?.checks[0] ?? null);
	const STATUS = { pass: 'Pass', warn: 'Warn', fail: 'Fail' } as const;
	const fileName = (url: string) => decodeURIComponent(url.split('?')[0].split('/').pop() ?? url);

	function intoDock(node: HTMLElement, host: HTMLElement | null) {
		const place = (target: HTMLElement | null) => { if (target && node.parentNode !== target) target.appendChild(node); };
		place(host);
		return { update: place, destroy: () => node.remove() };
	}
</script>

<div class="step" role="region" aria-label="Export">
	<div class="bar">
		<span class="code teal">v{version}</span>
		<h1>{cut.name}</h1>
		<span class="code facts" title={facts}>{facts}</span>
		<span class="grow"></span>
		<button type="button" class="key go" onclick={() => void exportNow()} disabled={!mixed || exporting} title={mixed ? 'Render the MP4 and the Resolve timeline, with trims and ramps baked into each entry, the mix and one stem per layer' : 'Build its mix in Sound first'}>{exporting ? 'Rendering…' : done ? 'Export again' : 'Export'}</button>
	</div>

	<div class="body">
		{#if project.series || project.review_room}
			<section>
				<div class="hd">
					<span class="cp">Deliverable</span>
					{#if project.series}
						{#each KINDS as item (item.value)}<button type="button" class="tg" aria-pressed={kind === item.value} onclick={() => (kind = item.value)}>{item.label}</button>{/each}
						{#if kind === 'TSR' || kind === 'TRL'}
							<span class="gap"></span>
							{#each [1, 2, 3, 4, 5] as n (n)}<button type="button" class="tg" aria-pressed={index === n} onclick={() => (index = n)}>#{n}</button>{/each}
						{/if}
						{#if kind !== 'none'}
							<span class="gap"></span>
							<button type="button" class="tg" aria-pressed={scope === 'episode'} onclick={() => (scope = 'episode')}>This episode</button>
							<button type="button" class="tg" aria-pressed={scope === 'series'} onclick={() => (scope = 'series')}>Season</button>
						{/if}
					{:else if project.review_room}
						<button type="button" class="tg" aria-pressed={kind !== 'none'} onclick={() => (kind = 'TRL')}>{project.review_room.code} cut → _Deliverables</button>
						<button type="button" class="tg" aria-pressed={kind === 'none'} onclick={() => (kind = 'none')}>Not a deliverable</button>
					{/if}
				</div>
			</section>
		{/if}
		<section>
			<p class="text">Each entry is baked to its own file with its trim and speed ramp rendered in. The mix and one stem per layer ride under the picture.</p>
		</section>
		{#if drafts.length}
			<section>
				<div class="hd"><span class="cp amber">{drafts.length} {drafts.length === 1 ? 'take is' : 'takes are'} not at full resolution</span>{#if drafts.length > 4}<button type="button" class="tg" aria-pressed={allDrafts} onclick={() => (allDrafts = !allDrafts)}>{allDrafts ? 'Show four' : `Show all ${drafts.length}`}</button>{/if}</div>
				{#each allDrafts ? drafts : drafts.slice(0, 4) as d, i (i)}<p class="row1"><span class="t">{d.title}</span><span class="code">{d.name} · {d.why}</span></p>{/each}
			</section>
		{/if}
		{#if stored}<section><p class="text teal-ink" role="status">{stored}</p></section>{/if}
		{#if error}<section><p class="text bad" role="alert">{error}</p></section>{/if}

		{#if done}
			<section>
				<div class="hd">
					<span class="cp">Exported</span><span class="code">{new Date(done.built_at).toLocaleString()}</span>
					<span class="grow"></span>
					<a class="key" href={done.mp4} download>MP4</a>
					<a class="key" href={done.fcpxml} download>Resolve timeline</a>
				</div>
				<p class="text">In Resolve: File → Import → Timeline… and pick the .fcpxml in <span class="code ink">{done.folder}</span>. The clips and stems it uses are in the same folder.</p>
				<div class="files">{#each done.files as file (file.url)}<a class="code" href={file.url} download title={file.name}>{file.name}</a>{/each}</div>
			</section>
		{/if}

		{#if done || report}
			<section>
				<div class="hd" data-status={report?.status}>
					<span class="cp">QC report</span>
					{#if report}<span class="cp state">{qcHeadline(report)}</span><span class="code">{new Date(report.at).toLocaleString()}</span>{:else}<span class="code">Not run on this version yet</span>{/if}
					<span class="grow"></span>
					<button type="button" class="tg" aria-pressed={asr} onclick={() => (asr = !asr)} title="Run local speech recognition on dialogue">Speech check {asr ? 'on' : 'off'}</button>
					<button type="button" class="key" onclick={() => void check()} disabled={!target || checking}>{checking ? 'Checking…' : report ? 'Check again' : 'Run QC'}</button>
				</div>
				{#if renders.length > 1}
					<div class="hd">
						<span class="cp">Check</span>
						{#each renders as render (render.value)}<button type="button" class="tg pickr" aria-pressed={target === render.value} onclick={() => (chosen = render.value)} title={render.label}>{render.label}</button>{/each}
					</div>
				{/if}
				{#if report}
					{#if report.file !== done?.mp4}<p class="code">{fileName(report.file)}</p>{/if}
					{#each report.checks as c (c.id)}
						{@const issues = c.items.filter((i) => i.status !== 'pass').length}
						<button type="button" class="qc" data-status={c.status} aria-pressed={shownCheck?.id === c.id} onclick={() => (cutView.qcCheck = c.id)}>
							<span class="cp st">{STATUS[c.status]}</span><span class="l">{c.label}</span><span class="s">{c.summary}</span>{#if issues}<span class="code n">{issues}</span>{/if}
						</button>
					{/each}
				{/if}
			</section>
		{/if}

		{#if report?.sheet}
			{@const sheet = `${report.sheet}?at=${encodeURIComponent(report.at)}`}
			<section>
				<div class="hd"><span class="cp">Contact sheet</span><span class="code">One frame per entry, plus the first and last second</span></div>
				<a class="sheet" href={sheet} target="_blank" rel="noreferrer"><img src={sheet} alt="QC contact sheet: one frame per entry, plus the first and last second" /></a>
			</section>
		{/if}

		<section class="last">
			<div class="hd">
				<span class="cp">Production manifest</span>
				<span class="code">The story, shots, prompts, takes and approvals as readable JSON</span>
				<span class="grow"></span>
				{#if onManifest}<button type="button" class="key" onclick={onManifest}>Download manifest</button>{/if}
			</div>
		</section>
	</div>
</div>

{#if detailsHost}
	<div class="details" role="group" aria-label="Export details" use:intoDock={detailsHost}>
		{#if shownCheck}
			<section data-status={shownCheck.status}>
				<p class="cp">QC · {shownCheck.label}</p>
				<p class="cp state">{STATUS[shownCheck.status]} · {shownCheck.items.filter((i) => i.status !== 'pass').length} {shownCheck.items.filter((i) => i.status !== 'pass').length === 1 ? 'item' : 'items'}</p>
				<p class="line">{shownCheck.summary}</p>
			</section>
			<section>
				<p class="cp">Items</p>
				{#each shownCheck.items as item, i (i)}
					<p class="item" data-status={item.status} title={item.message}><span class="code tc">{item.at_s === undefined ? 'all' : timecode(item.at_s)}</span><span class="m">{item.message}</span></p>
				{/each}
				{#if !shownCheck.items.length}<p class="hint">Nothing to list.</p>{/if}
			</section>
			{#if report}
				<section>
					<p class="cp">Checked file</p>
					<p class="code cut1" title={report.file}>{fileName(report.file)}</p>
					<p class="code">{report.duration_s.toFixed(2)}s</p>
				</section>
			{/if}
		{:else}
			<section><p class="cp">QC</p><p class="hint">{done ? 'Run QC to see each check here.' : mixed ? 'Export this version, then its QC report shows here.' : 'Build the mix in Sound, then export.'}</p></section>
		{/if}
	</div>
{/if}

<style>
	.step { display: flex; height: 100%; min-height: 0; flex-direction: column; color: var(--color-ink-2); font: 12.5px/1.35 var(--font-sans); }
	.bar { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 2px 7px; padding: 10px 14px 6px; }
	h1 { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-ink); font-size: 13px; font-weight: 400; }
	.code { color: var(--color-ink-3); font: 10.5px var(--font-mono); letter-spacing: 0.01em; white-space: nowrap; }
	.code.teal { color: var(--color-teal); }
	.code.ink { color: var(--color-ink); }
	.facts { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
	.grow { flex: 1; }
	.gap { width: 8px; }
	.body { min-height: 0; flex: 1; overflow-y: auto; padding-bottom: 12px; }
	section { display: flex; min-width: 0; flex-direction: column; gap: 4px; padding: 12px 14px 0; }
	.hd { display: flex; min-height: 22px; flex-wrap: wrap; align-items: center; gap: 3px 10px; }
	.hd > .cp:first-child { color: var(--color-ink-3); }
	.text { margin: 0; max-width: 74ch; line-height: 1.5; }
	.text.bad { color: #ff7a6b; }
	.teal-ink { color: var(--color-teal-ink); }
	.amber { margin: 0; color: var(--color-amber); }
	.row1 { display: flex; min-width: 0; gap: 8px; margin: 0; white-space: nowrap; }
	.row1 .t { max-width: 45%; flex: none; overflow: hidden; text-overflow: ellipsis; color: var(--color-ink); }
	.row1 .code { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
	.files { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 3px 14px; }
	.files a { overflow: hidden; text-overflow: ellipsis; color: var(--color-teal); text-decoration: none; }
	.files a:hover { color: var(--color-teal-ink); }
	a.key { text-decoration: none; }
	[data-status='pass'] { --st: var(--color-teal); }
	[data-status='warn'] { --st: var(--color-amber); }
	[data-status='fail'] { --st: #ff7a6b; }
	.hd .state, .details .state { color: var(--st); }
	.qc { display: flex; height: 22px; align-items: center; gap: 10px; overflow: hidden; margin: 0 -8px; border: 0; border-radius: 5px; background: none; padding: 0 8px; color: var(--color-ink-2); font: 12px var(--font-sans); text-align: left; white-space: nowrap; cursor: pointer; }
	.qc[aria-pressed='true'] { background: var(--color-selected); }
	.qc .st { width: 34px; flex: none; color: var(--st); }
	.qc .l { width: 92px; flex: none; color: var(--color-ink); }
	.qc[aria-pressed='true'] .l { color: var(--color-teal-ink); }
	.qc .s { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; }
	.qc .n { color: var(--st); }
	.qc:focus-visible { outline: 2px solid var(--color-teal); outline-offset: -2px; }
	.pickr { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
	.sheet { display: block; }
	.sheet img { display: block; width: 100%; max-height: 260px; border-radius: 4px; object-fit: contain; object-position: left; }
	.last { padding-top: 18px; }
	.details { display: flex; flex-direction: column; gap: 14px; padding: 12px 8px 10px; color: var(--color-ink-2); font: 12.5px/1.35 var(--font-sans); }
	.details section { padding: 0; gap: 3px; }
	.details p { margin: 0; padding: 0 6px; }
	.details .cp { color: var(--color-ink-3); }
	.details .state { color: var(--st); }
	.details .line { color: var(--color-ink); }
	.details .hint { color: var(--color-ink-3); font-size: 12px; line-height: 1.5; }
	.details .cut1 { overflow: hidden; text-overflow: ellipsis; }
	.item { display: flex; min-width: 0; gap: 6px; white-space: nowrap; }
	.item .tc { flex: none; color: var(--color-amber); }
	.item[data-status='pass'] .tc, .item[data-status='pass'] .m { color: var(--color-ink-3); }
	.item .m { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: #c8c8ce; }
	.item[data-status='fail'] .m { color: #ff7a6b; }
</style>
