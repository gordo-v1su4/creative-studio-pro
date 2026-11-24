<script lang="ts">
	/**
	 * The brief as the story plan's first level (decision 3): the Agent drafts it, the operator reads and edits it
	 * here, and it is approved like every other level. There is nothing to fill before work can start and nothing
	 * to lock. Saving also writes tone and must-nots into the project rules file the Agent and the checks read.
	 */
	import type { BriefVersion, Project } from '$lib/domain/schemas';
	import { ui } from '$lib/ui/app-state.svelte';
	import { agentWork } from '$lib/ui/story/agent-work.svelte';

	let { project, onUpdated, dirty = $bindable(false), titleNow = $bindable('') }: {
		project: Project; onUpdated: (project: Project) => void; dirty?: boolean;
		/** The title as it reads on the sheet right now, saved or not: the show code is suggested from it. */
		titleNow?: string;
	} = $props();

	type Fields = Pick<BriefVersion, 'title' | 'logline' | 'format' | 'tone_visual_rules' | 'must_haves' | 'must_nots' | 'success_criteria'>;
	const current = $derived(project.brief_state.versions.at(-1));
	let title = $state(''), logline = $state('');
	let type = $state(''), runtime = $state(''), aspect = $state(''), platform = $state('');
	let tone = $state(''), mustHaves = $state(''), mustNots = $state(''), success = $state('');
	let saving = $state(false);
	const drafting = $derived(agentWork.busy === 'brief');
	const busy = $derived(saving || agentWork.busy !== null);
	let said = $state<{ text: string; bad?: boolean } | null>(null);

	const lines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean);
	const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brief';
	const fields = $derived({ title, logline, type, runtime, aspect, platform, tone, mustHaves: lines(mustHaves), mustNots: lines(mustNots), success: lines(success) });
	const complete = $derived([title, logline, type, runtime, aspect, platform, tone].every((value) => value.trim()) && fields.mustHaves.length > 0 && fields.mustNots.length > 0 && fields.success.length > 0);
	const saved = $derived(current ? JSON.stringify({ title: current.title, logline: current.logline, type: current.format.type, runtime: current.format.runtime, aspect: current.format.aspect, platform: current.format.platform, tone: current.tone_visual_rules, mustHaves: current.must_haves, mustNots: current.must_nots, success: current.success_criteria }) : '');
	const changed = $derived(JSON.stringify(fields) !== saved);
	const started = $derived([logline, type, runtime, aspect, platform, tone, mustHaves, mustNots, success].some((value) => value.trim()));
	$effect(() => { dirty = current ? changed : started; });
	$effect(() => { titleNow = title; });

	function fill(brief: Fields | undefined) {
		title = brief?.title ?? project.title; logline = brief?.logline ?? project.production.logline;
		type = brief?.format.type ?? ''; runtime = brief?.format.runtime ?? ''; aspect = brief?.format.aspect ?? ''; platform = brief?.format.platform ?? '';
		tone = brief?.tone_visual_rules ?? '';
		mustHaves = brief?.must_haves.join('\n') ?? ''; mustNots = brief?.must_nots.join('\n') ?? ''; success = brief?.success_criteria.join('\n') ?? '';
	}
	// A new project, or a brief saved elsewhere (the Agent's draft), replaces what is shown.
	$effect(() => { project.project_id; project.brief_state.current_version; fill(project.brief_state.versions.at(-1)); });

	/** Ask the Agent for a draft (its action, the same one its dock offers). Nothing is saved until Save. */
	async function draft() {
		said = null;
		if (!(await agentWork.draftBrief(project))) said = { text: agentWork.linesFor(project.project_id).at(-1)?.text ?? 'The brief could not be drafted', bad: true };
	}
	// A draft the Agent made, wherever it was asked for, is shown here once.
	$effect(() => {
		const drafted = agentWork.briefDraft;
		if (drafted?.projectId !== project.project_id) return;
		agentWork.briefDraft = null;
		fill(drafted.fields);
		said = { text: 'Drafted by the Agent. Read it, change anything, then save.' };
	});
	// A project just started from an idea: the Agent drafts its brief at once, unasked (story 6).
	$effect(() => {
		const ask = ui.agentAsk;
		if (ask?.projectId !== project.project_id || ask.action !== 'draft_brief') return;
		ui.agentAsk = null;
		if (!project.brief_state.versions.length) void draft();
	});

	/** Save what is shown as the brief's next version. Resolves to the saved project, or null when it did not save. */
	export async function save(): Promise<Project | null> {
		if (!complete) { said = { text: 'Fill every field, or let the Agent draft it', bad: true }; return null; }
		if (busy) return null;
		saving = true; said = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/brief`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expected_version: project.version, brief: { title, slug: slugify(title), logline, format: { type, runtime, aspect, platform }, tone_visual_rules: tone, must_haves: fields.mustHaves, must_nots: fields.mustNots, success_criteria: fields.success } }) });
			const body = (await response.json()) as { ok: true; data: Project } | { ok: false; error: { message: string } };
			if (!body.ok) throw new Error(body.error.message);
			onUpdated(body.data);
			said = { text: 'Saved' };
			return body.data;
		} catch (cause) { said = { text: cause instanceof Error ? cause.message : 'The brief could not be saved', bad: true }; return null; }
		finally { saving = false; }
	}
</script>

<section class="brief" aria-label="Brief">
	<div class="row">
		<label class="f grow"><span class="cp">Title</span><input bind:value={title} maxlength="200" /></label>
	</div>
	<label class="f"><span class="cp">Logline</span><textarea bind:value={logline} rows="2" maxlength="2000"></textarea></label>
	<div class="row four">
		<label class="f"><span class="cp">Type</span><input bind:value={type} placeholder="Teaser trailer" maxlength="200" /></label>
		<label class="f"><span class="cp">Length</span><input bind:value={runtime} placeholder="30s" maxlength="200" /></label>
		<label class="f"><span class="cp">Aspect</span><input bind:value={aspect} placeholder="16:9" maxlength="100" /></label>
		<label class="f"><span class="cp">Where it plays</span><input bind:value={platform} placeholder="Web" maxlength="200" /></label>
	</div>
	<label class="f"><span class="cp">Tone and look</span><textarea bind:value={tone} rows="3" maxlength="5000"></textarea></label>
	<div class="row three">
		<label class="f"><span class="cp">Must have</span><textarea bind:value={mustHaves} rows="4" placeholder="One per line"></textarea></label>
		<label class="f"><span class="cp">Must not</span><textarea bind:value={mustNots} rows="4" placeholder="One per line"></textarea></label>
		<label class="f"><span class="cp">It works when</span><textarea bind:value={success} rows="4" placeholder="One per line"></textarea></label>
	</div>
	<div class="acts">
		<button type="button" class="key agent" disabled={busy} onclick={() => void draft()} title="The Agent drafts every field from your idea, the story so far and the project rules. Nothing is saved until you save.">{drafting ? 'Drafting…' : current || started ? 'Draft again' : 'Draft with the Agent'}</button>
		<span class={['why', said?.bad && 'bad']} aria-live="polite">{said?.text ?? (current ? (changed ? 'Not saved yet' : `Version ${current.version}`) : 'No brief yet')}</span>
		{#if current && changed}<button type="button" class="key" disabled={busy} onclick={() => fill(current)}>Revert</button>{/if}
		<button type="button" class="key" disabled={busy || !(current ? changed : started)} onclick={() => void save()}>{saving ? 'Saving…' : 'Save brief'}</button>
	</div>
</section>

<style>
	.brief { display: flex; max-width: 760px; flex-direction: column; gap: 8px; }
	.row { display: flex; flex-wrap: wrap; gap: 8px; }
	.row > .f { min-width: 0; flex: 1 1 150px; }
	.row.three > .f { flex-basis: 200px; }
	.f { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
	.f > .cp { color: var(--color-ink-3); }
	.f input, .f textarea { width: 100%; box-sizing: border-box; border: 0; border-radius: 5px; background: var(--color-raised); padding: 5px 8px; color: var(--color-ink); font: 12.5px/1.45 var(--font-sans); outline: none; resize: vertical; }
	.f input { height: 26px; padding-block: 0; }
	.f input:focus, .f textarea:focus { background: var(--color-control); }
	.f ::placeholder { color: #52525b; }
	.acts { display: flex; min-width: 0; align-items: center; gap: 4px; padding-top: 2px; }
	.why { min-width: 0; flex: 1; overflow: hidden; padding: 0 6px; text-overflow: ellipsis; white-space: nowrap; color: var(--color-ink-3); font-size: 11.5px; }
	.why.bad { color: #ff7a6b; }
	.key.agent { background: var(--color-agent-purple-deep); color: #ddd6fe; }
	@media (pointer: coarse) { .f input { height: 36px; } }
</style>
