<script lang="ts">
	import type { Project, BriefVersion } from '$lib/domain/schemas';
	import { isCurrentBriefLocked } from '$lib/domain/gates';
	let { project, onUpdated }: { project: Project; onUpdated: (project: Project) => void } = $props();
	let current = $derived(project.brief_state.versions.at(-1));
	let locked = $derived(isCurrentBriefLocked(project));
	let approval = $derived(current ? project.approval_history.findLast((item) => item.brief_id === current?.brief_id && item.brief_hash === current?.content_hash) : undefined);
	let title = $state(''), slug = $state('');
	let logline = $state(''), type = $state('');
	let runtime = $state(''), aspect = $state('');
	let platform = $state(''), tone = $state('');
	let mustHaves = $state(''), mustNots = $state('');
	let continuity = $state(''), audio = $state('');
	let success = $state(''), token = $state('');
	let busy = $state(false), error = $state<string | null>(null);
	const lines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean);
	const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	let complete = $derived([title, slug, logline, type, runtime, aspect, platform, tone, continuity, audio].every((value) => value.trim()) && lines(mustHaves).length > 0 && lines(mustNots).length > 0 && lines(success).length > 0);
	let dirty = $derived(Boolean(current) && JSON.stringify({ title, slug, logline, type, runtime, aspect, platform, tone, mustHaves: lines(mustHaves), mustNots: lines(mustNots), continuity, audio, success: lines(success) }) !== JSON.stringify(current && { title: current.title, slug: current.slug, logline: current.logline, type: current.format.type, runtime: current.format.runtime, aspect: current.format.aspect, platform: current.format.platform, tone: current.tone_visual_rules, mustHaves: current.must_haves, mustNots: current.must_nots, continuity: current.continuity_model, audio: current.audio_approach, success: current.success_criteria }));

	function initialize(brief: BriefVersion | undefined) {
		title = brief?.title ?? project.title; slug = brief?.slug ?? slugify(project.title); logline = brief?.logline ?? project.production.logline;
		type = brief?.format.type ?? ''; runtime = brief?.format.runtime ?? ''; aspect = brief?.format.aspect ?? '';
		platform = brief?.format.platform ?? ''; tone = brief?.tone_visual_rules ?? '';
		mustHaves = brief?.must_haves.join('\n') ?? ''; mustNots = brief?.must_nots.join('\n') ?? '';
		continuity = brief?.continuity_model ?? ''; audio = brief?.audio_approach ?? '';
		success = brief?.success_criteria.join('\n') ?? ''; token = ''; error = null;
	}
	$effect(() => { project.project_id; project.brief_state.current_version; initialize(project.brief_state.versions.at(-1)); });

	async function save() {
		if (!complete || busy) return; busy = true; error = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/brief`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expected_version: project.version, brief: { title, slug, logline, format: { type, runtime, aspect, platform }, tone_visual_rules: tone, must_haves: lines(mustHaves), must_nots: lines(mustNots), continuity_model: continuity, audio_approach: audio, success_criteria: lines(success) } }) });
			const body = await response.json() as { ok: true; data: Project } | { ok: false; error: { message: string } }; if (!body.ok) throw new Error(body.error.message); onUpdated(body.data);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Brief save failed'; } finally { busy = false; }
	}
	async function lockBrief(brief: BriefVersion) {
		if (dirty) { error = 'Save or revert unsaved changes before locking.'; return; }
		if (!token || busy) return; busy = true; error = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/brief`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ expected_version: project.version, brief_version: brief.version, brief_hash: brief.content_hash }) });
			const body = await response.json() as { ok: true; data: Project } | { ok: false; error: { message: string } }; if (!body.ok) throw new Error(body.error.message); token = ''; onUpdated(body.data);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Brief lock failed'; } finally { busy = false; }
	}
</script>

<section class="mt-3" aria-labelledby="brief-heading">
	<h3 id="brief-heading" class="meta-label">Owner brief {current ? `v${current.version}` : 'draft'}</h3>
	{#if locked && current}
		<p class="mt-2 rounded-sm border border-gate-approved bg-[color-mix(in_srgb,var(--color-gate-approved)_6%,var(--color-surface-raised-2))] p-2 text-gate-approved" role="status">
			{project.interview.status === 'PASSED' ? 'S2 PASSED' : 'LOCKED · interview source'} · {approval?.operator ?? 'operator'}
		</p>
		<details class="mt-2 rounded-sm border border-border-default bg-surface-raised-2 p-2">
			<summary class="cursor-pointer text-text-muted">Read locked brief</summary>
			<div class="mt-2 grid gap-1.5 text-text-muted">
				<strong class="text-text-primary">{current.title}</strong>
				<p>{current.logline}</p>
				<p class="meta-label text-text-dim">{current.format.type} · {current.format.runtime} · {current.format.aspect} · {current.format.platform}</p>
				<p>{current.tone_visual_rules}</p>
				<p><span class="meta-label text-text-dim">Must have</span><br />{current.must_haves.join(' · ')}</p>
				<p><span class="meta-label text-text-dim">Must not</span><br />{current.must_nots.join(' · ')}</p>
				<p><span class="meta-label text-text-dim">Continuity</span><br />{current.continuity_model}</p>
				<p><span class="meta-label text-text-dim">Audio</span><br />{current.audio_approach}</p>
				<p><span class="meta-label text-text-dim">Success</span><br />{current.success_criteria.join(' · ')}</p>
			</div>
		</details>
	{:else}
		<div class="mt-2 grid gap-2">
			<input aria-label="Brief title" placeholder="Title" bind:value={title} class="rounded-sm border border-border-default bg-surface-base p-2" />
			<input aria-label="Brief slug" placeholder="Slug" bind:value={slug} class="rounded-sm border border-border-default bg-surface-base p-2" />
			<textarea aria-label="Logline" placeholder="Logline" bind:value={logline} rows="2" class="rounded-sm border border-border-default bg-surface-base p-2"></textarea>
			<div class="grid grid-cols-2 gap-2"><input aria-label="Format type" placeholder="Type" bind:value={type} class="rounded-sm border border-border-default bg-surface-base p-2" /><input aria-label="Runtime" placeholder="Runtime" bind:value={runtime} class="rounded-sm border border-border-default bg-surface-base p-2" /><input aria-label="Aspect" placeholder="Aspect" bind:value={aspect} class="rounded-sm border border-border-default bg-surface-base p-2" /><input aria-label="Platform" placeholder="Platform" bind:value={platform} class="rounded-sm border border-border-default bg-surface-base p-2" /></div>
			<textarea aria-label="Tone and visual rules" placeholder="Tone & visual rules" bind:value={tone} rows="3" class="rounded-sm border border-border-default bg-surface-base p-2"></textarea>
			<textarea aria-label="Must haves" placeholder="Must-haves, one per line" bind:value={mustHaves} rows="2" class="rounded-sm border border-border-default bg-surface-base p-2"></textarea>
			<textarea aria-label="Must nots" placeholder="Must-nots, one per line" bind:value={mustNots} rows="2" class="rounded-sm border border-border-default bg-surface-base p-2"></textarea>
			<textarea aria-label="Continuity model" placeholder="Continuity model" bind:value={continuity} rows="2" class="rounded-sm border border-border-default bg-surface-base p-2"></textarea>
			<textarea aria-label="Audio approach" placeholder="Audio approach" bind:value={audio} rows="2" class="rounded-sm border border-border-default bg-surface-base p-2"></textarea>
			<textarea aria-label="Success criteria" placeholder="Success criteria, one per line" bind:value={success} rows="2" class="rounded-sm border border-border-default bg-surface-base p-2"></textarea>
		</div>
		<button type="button" class="btn btn-accent mt-2 w-full justify-center" disabled={!complete || busy} onclick={() => void save()}>{busy ? 'Saving…' : current ? 'Save changed brief as new version' : 'Save brief version'}</button>
		{#if current}
			{#if dirty}<p class="mt-2 text-gate-pending" role="status">Save or revert unsaved changes before locking.</p><button type="button" class="btn mt-1 w-full justify-center" onclick={() => initialize(current)}>Revert unsaved changes</button>{/if}
			<label for="brief-token" class="meta-label mt-3 block">Operator credential</label><input id="brief-token" type="password" autocomplete="current-password" bind:value={token} class="mt-1 w-full rounded-sm border border-border-default bg-surface-base p-2" />
			<button type="button" class="btn mt-2 w-full justify-center" disabled={!token || busy || dirty} onclick={() => void lockBrief(current)}>Lock current brief v{current.version}</button>
			<p class="meta-label mt-1 break-all text-text-dim">{current.content_hash}</p>
		{/if}
		{#if error}<p class="mt-2 text-gate-failed" role="alert">{error}</p>{/if}
	{/if}
</section>
