<script lang="ts">
	import type { Project, BriefVersion } from '$lib/domain/schemas';
	import { isCurrentBriefLocked } from '$lib/domain/gates';

	/**
	 * The owner brief (V1S-132), in the Story tab. "Draft brief" asks the Agent
	 * to fill it from the seed, the story, the media and the rules file; the
	 * operator edits and saves. Saving also writes tone and must-nots into the
	 * project rules file the Agent and the prompt linter read. Locking it (the
	 * old interview gate) is optional.
	 */
	let { project, onUpdated }: { project: Project; onUpdated: (project: Project) => void } = $props();
	let current = $derived(project.brief_state.versions.at(-1));
	let locked = $derived(isCurrentBriefLocked(project));
	let title = $state(''), logline = $state('');
	let type = $state(''), runtime = $state(''), aspect = $state(''), platform = $state('');
	let tone = $state(''), mustHaves = $state(''), mustNots = $state(''), success = $state(''), token = $state('');
	let busy = $state(false), drafting = $state(false), error = $state<string | null>(null), note = $state<string | null>(null);
	const lines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean);
	const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brief';
	let complete = $derived([title, logline, type, runtime, aspect, platform, tone].every((value) => value.trim()) && lines(mustHaves).length > 0 && lines(mustNots).length > 0 && lines(success).length > 0);
	let fields = $derived({ title, logline, type, runtime, aspect, platform, tone, mustHaves: lines(mustHaves), mustNots: lines(mustNots), success: lines(success) });
	let dirty = $derived(!current || JSON.stringify(fields) !== JSON.stringify({ title: current.title, logline: current.logline, type: current.format.type, runtime: current.format.runtime, aspect: current.format.aspect, platform: current.format.platform, tone: current.tone_visual_rules, mustHaves: current.must_haves, mustNots: current.must_nots, success: current.success_criteria }));

	function fill(brief: Pick<BriefVersion, 'title' | 'logline' | 'format' | 'tone_visual_rules' | 'must_haves' | 'must_nots' | 'success_criteria'> | undefined) {
		title = brief?.title ?? project.title; logline = brief?.logline ?? project.production.logline;
		type = brief?.format.type ?? ''; runtime = brief?.format.runtime ?? ''; aspect = brief?.format.aspect ?? ''; platform = brief?.format.platform ?? '';
		tone = brief?.tone_visual_rules ?? '';
		mustHaves = brief?.must_haves.join('\n') ?? ''; mustNots = brief?.must_nots.join('\n') ?? ''; success = brief?.success_criteria.join('\n') ?? '';
		token = ''; error = null;
	}
	$effect(() => { project.project_id; project.brief_state.current_version; fill(project.brief_state.versions.at(-1)); });

	async function draft() {
		drafting = true; error = null; note = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/brief/draft`, { method: 'POST' });
			const body = (await response.json()) as { ok: true; data: Parameters<typeof fill>[0] } | { ok: false; error: { message: string } };
			if (!body.ok) throw new Error(body.error.message);
			fill(body.data);
			note = 'The Agent drafted this brief. Read it, edit anything, then save.';
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Drafting failed'; }
		finally { drafting = false; }
	}

	async function save() {
		if (!complete || busy) return; busy = true; error = null; note = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/brief`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expected_version: project.version, brief: { title, slug: slugify(title), logline, format: { type, runtime, aspect, platform }, tone_visual_rules: tone, must_haves: lines(mustHaves), must_nots: lines(mustNots), success_criteria: lines(success) } }) });
			const body = (await response.json()) as { ok: true; data: Project; rules_file?: string | null } | { ok: false; error: { message: string } };
			if (!body.ok) throw new Error(body.error.message);
			onUpdated(body.data);
			note = body.rules_file ? `Saved. Tone and must-nots are in ${body.rules_file.split(/[\\/]/).slice(-2).join('/')}, which the Agent and the prompt linter read.` : 'Saved.';
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Brief save failed'; } finally { busy = false; }
	}

	async function lockBrief(brief: BriefVersion) {
		if (dirty || !token || busy) return; busy = true; error = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/brief`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ expected_version: project.version, brief_version: brief.version, brief_hash: brief.content_hash }) });
			const body = (await response.json()) as { ok: true; data: Project } | { ok: false; error: { message: string } };
			if (!body.ok) throw new Error(body.error.message);
			token = ''; onUpdated(body.data);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Brief lock failed'; } finally { busy = false; }
	}
</script>

<section aria-labelledby="brief-heading">
	<div class="flex flex-wrap items-center gap-3">
		<h3 id="brief-heading" class="cap">Owner brief {current ? `v${current.version}` : ''}{locked ? ' · locked' : ''}</h3>
		<span class="grow"></span>
		{#if !locked}<button type="button" class="key accent" onclick={() => void draft()} disabled={drafting} title="The Agent drafts the brief from the seed, the story so far, the media and the rules file. Nothing is saved until you save.">{drafting ? 'Agent is drafting…' : 'Draft brief'}</button>{/if}
	</div>
	{#if locked && current}
		<div class="mt-3 grid gap-1.5 text-[12px] text-[#9fb3b8]">
			<b class="text-[#dce7ea]">{current.title}</b>
			<p>{current.logline}</p>
			<p class="cap">{current.format.type} · {current.format.runtime} · {current.format.aspect} · {current.format.platform}</p>
			<p>{current.tone_visual_rules}</p>
			<p><span class="cap">Must have</span> {current.must_haves.join(' · ')}</p>
			<p><span class="cap">Must not</span> {current.must_nots.join(' · ')}</p>
			<p><span class="cap">Success</span> {current.success_criteria.join(' · ')}</p>
		</div>
	{:else}
		<div class="mt-3 grid gap-2">
			<label class="field"><span class="cap">Title</span><input bind:value={title} aria-label="Brief title" /></label>
			<label class="field"><span class="cap">Logline</span><textarea bind:value={logline} rows="2" aria-label="Logline"></textarea></label>
			<div class="grid grid-cols-2 gap-2 md:grid-cols-4">
				<label class="field"><span class="cap">Type</span><input bind:value={type} aria-label="Format type" placeholder="trailer" /></label>
				<label class="field"><span class="cap">Runtime</span><input bind:value={runtime} aria-label="Runtime" placeholder="30s" /></label>
				<label class="field"><span class="cap">Aspect</span><input bind:value={aspect} aria-label="Aspect" placeholder="16:9" /></label>
				<label class="field"><span class="cap">Platform</span><input bind:value={platform} aria-label="Platform" placeholder="web" /></label>
			</div>
			<label class="field"><span class="cap">Tone &amp; visual rules <small>→ rules file</small></span><textarea bind:value={tone} rows="3" aria-label="Tone and visual rules"></textarea></label>
			<div class="grid gap-2 md:grid-cols-3">
				<label class="field"><span class="cap">Must have</span><textarea bind:value={mustHaves} rows="4" aria-label="Must haves" placeholder="one per line"></textarea></label>
				<label class="field"><span class="cap">Must not <small>→ rules file</small></span><textarea bind:value={mustNots} rows="4" aria-label="Must nots" placeholder={'one per line; "quote" a word to ban it'}></textarea></label>
				<label class="field"><span class="cap">Success</span><textarea bind:value={success} rows="4" aria-label="Success criteria" placeholder="one per line"></textarea></label>
			</div>
		</div>
		<div class="mt-3 flex flex-wrap items-center gap-3">
			<span class="text-[11px] text-[#5b6b70]">{complete ? (dirty ? 'Unsaved changes' : 'Saved') : 'Fill every field, or let the Agent draft it'}</span>
			<span class="grow"></span>
			{#if current && dirty}<button type="button" class="key" onclick={() => fill(current)}>Revert</button>{/if}
			<button type="button" class="key accent" disabled={!complete || busy || !dirty} onclick={() => void save()}>{busy ? 'Saving…' : current ? 'Save as new version' : 'Save brief'}</button>
		</div>
		{#if current}
			<details class="mt-3">
				<summary class="cap cursor-pointer">Lock this brief (optional)</summary>
				<p class="mt-1 text-[11px] text-[#5b6b70]">Locking freezes the brief as the interview gate's source. It's optional: the board, cuts and sound work without it.</p>
				<div class="mt-2 flex items-center gap-2">
					<input class="token" type="password" autocomplete="current-password" bind:value={token} aria-label="Operator credential" placeholder="operator credential" />
					<button type="button" class="key" disabled={!token || busy || dirty} onclick={() => void lockBrief(current)}>Lock v{current.version}</button>
				</div>
			</details>
		{/if}
	{/if}
	{#if note}<p class="mt-2 text-[11px] text-[#7de5dc]" role="status">{note}</p>{/if}
	{#if error}<p class="mt-2 text-gate-failed" role="alert">{error}</p>{/if}
</section>

<style>
	.cap { color: #7b878f; font: 600 10px var(--font-sans); letter-spacing: 0.16em; text-transform: uppercase; }
	.cap small { color: #4e5b61; letter-spacing: 0.06em; text-transform: none; font-weight: 500; }
	/* Top-aligned, so fields side by side line up and never stretch apart. */
	.field { display: grid; gap: 4px; align-content: start; }
	.field input, .field textarea, .token { width: 100%; border: 1px solid #22282d; border-radius: 2px; background: #0a0c0e; padding: 5px 8px; color: #dce7ea; font: 12px/1.5 var(--font-sans); outline: none; resize: vertical; }
	.field input:focus, .field textarea:focus, .token:focus { border-color: rgba(78, 232, 210, 0.5); }
	.field textarea::placeholder, .field input::placeholder, .token::placeholder { color: #3f4a50; }
	.token { width: 220px; font-family: var(--font-mono); }
	.key { border: 1px solid #262c31; border-radius: 2px; background: transparent; padding: 0 9px; color: #8a969e; font: 600 9px/20px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; transition: border-color 140ms ease, color 140ms ease; }
	.key:hover:not(:disabled) { border-color: #44505a; color: #c4d0d6; }
	.key.accent { border-color: rgba(78, 232, 210, 0.45); color: #7de5dc; }
	.key:disabled { opacity: 0.4; }
</style>
