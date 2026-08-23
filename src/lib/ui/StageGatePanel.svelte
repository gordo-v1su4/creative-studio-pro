<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { STAGES, stageIndex, stageName, nextStageId, legalActions } from '$lib/domain/gates';
	import type { Project } from '$lib/domain/schemas';
	import BriefPanel from '$lib/ui/BriefPanel.svelte';
	import { ui } from '$lib/ui/app-state.svelte';

	let {
		project,
		onUpdated
	}: { project: Project; onUpdated: (project: Project) => void } = $props();

	const stateColor: Record<Project['stage']['state'], string> = {
		BLOCKED: 'var(--color-gate-pending)',
		'READY FOR REVIEW': 'var(--color-gate-quoted)',
		PASSED: 'var(--color-gate-approved)',
		FORCED: 'var(--color-gate-failed)'
	};

	let currentIndex = $derived(stageIndex(project.stage.id));
	let actions = $derived(legalActions(project));
	let nextStage = $derived(nextStageId(project.stage.id));
	let wasForced = $derived(project.gate_history.some((h) => h.event === 'force_advance'));

	let dialogOpen = $state(false);
	let reason = $state('');
	let operatorToken = $state('');
	let submitting = $state(false);
	let dialogError = $state<string | null>(null);

	function openDialog() {
		reason = '';
		operatorToken = '';
		dialogError = null;
		dialogOpen = true;
	}

	function closeDialog() {
		operatorToken = '';
		dialogOpen = false;
	}

	async function confirmForceAdvance() {
		if (reason.trim().length < 5 || submitting) return;
		submitting = true;
		dialogError = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/stage`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${operatorToken}`
				},
				body: JSON.stringify({
					expected_version: project.version,
					reason: reason.trim()
				})
			});
			const body = (await response.json()) as
				| { ok: true; data: Project }
				| { ok: false; error: { message: string } };
			if (!body.ok) throw new Error(body.error.message);
			closeDialog();
			onUpdated(body.data);
		} catch (e) {
			dialogError = e instanceof Error ? e.message : 'Force-advance failed';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="meta-label">Stage gate</div>

<!-- S0–S10 rail -->
<div class="mt-2 flex items-center gap-[3px]" role="img" aria-label="Stage {project.stage.id} of S10, {stageName(project.stage.id)}, {project.stage.state}">
	{#each STAGES as stage, i (stage.id)}
		<span
			class="h-1.5 grow rounded-[1px] transition-colors"
			style:background={i < currentIndex
				? 'color-mix(in srgb, var(--color-text-dim) 55%, var(--color-surface-raised-2))'
				: i === currentIndex
					? stateColor[project.stage.state]
					: 'var(--color-surface-raised-2)'}
			style:outline={i > currentIndex ? '1px solid var(--color-border-subtle)' : 'none'}
			title="{stage.id} · {stage.name}"
		></span>
	{/each}
</div>

{#if project.interview.status !== 'PASSED'}
	<section class="mt-3 rounded-sm border border-border-default bg-surface-raised-2 p-2.5" aria-labelledby="interview-heading">
		<div class="flex items-center justify-between gap-2">
			<h3 id="interview-heading" class="meta-label">S1 Agent interview</h3>
			<span class="meta-label text-text-dim">{project.interview.status}</span>
		</div>
		<p class="mt-1.5 text-text-muted">The agent asks unresolved owner questions and calculates confidence. You answer in the conversation.</p>
		<button type="button" class="btn btn-accent mt-2.5 w-full justify-center" onclick={() => { ui.chatMode = 'focus'; ui.chatOpen = true; }}>Open Stage Agent</button>
		{#if project.interview.rounds.length}
			<div class="mt-2 grid gap-1">
				{#each [...project.interview.rounds].reverse() as round (round.round_id)}
					<div class="flex items-center justify-between text-text-muted"><span>Round {round.round_number}</span><span>{round.overall}/100 · {round.status}</span></div>
				{/each}
			</div>
		{/if}
	</section>
{:else if project.stage.id === 'S2'}
	<BriefPanel {project} {onUpdated} />
{/if}

<div
	class="mt-2 rounded-sm border bg-surface-raised-2 p-2.5"
	style:border-color="color-mix(in srgb, {stateColor[project.stage.state]} 30%, var(--color-border-default))"
>
	<span class="flex items-center gap-1.5">
		<span class="block h-1.5 w-1.5 rounded-full" style:background={stateColor[project.stage.state]}></span>
		<strong class="meta-label" style:color={stateColor[project.stage.state]}>
			{project.stage.id} · {stageName(project.stage.id)} · {project.stage.state}
		</strong>
	</span>
	<div class="mt-1.5 text-text-muted">
		Confidence: {project.stage.confidence === null ? 'not evaluated' : project.stage.confidence}
	</div>
	{#if project.stage.state === 'FORCED'}
		<div class="mt-1.5 flex items-center gap-1.5 text-gate-failed">
			<span aria-hidden="true">⚠</span>
			Forced past gate — rework warning persists until re-review.
		</div>
	{/if}
</div>

<div class="meta-label mt-3">Legal actions</div>
<ul class="mt-1.5 grid gap-1">
	{#each actions as action (action)}
		<li class="flex items-center gap-1.5 text-text-muted">
			<span class="text-text-dim">·</span>
			{action}
		</li>
	{/each}
</ul>

{#if nextStage && stageIndex(project.stage.id) >= stageIndex('S3')}
	<button type="button" class="btn mt-2.5 w-full justify-center" onclick={openDialog}>
		Force advance to {nextStage}…
	</button>
{/if}

{#if wasForced || project.gate_history.length > 0}
	<div class="meta-label mt-3">Gate history</div>
	<div class="mt-1.5 grid gap-1.5">
		{#each [...project.gate_history].reverse() as entry, i (project.gate_history.length - 1 - i)}
			<div class="rounded-sm border border-border-subtle bg-surface-raised-2 p-2">
				<div class="flex items-center gap-1.5">
					<span class="meta-label text-gate-failed">FORCED</span>
					<span class="meta-label text-text-dim">{entry.from_stage} → {entry.to_stage}</span>
					<span class="grow"></span>
					<span class="meta-label text-text-dim">{new Date(entry.timestamp).toLocaleString()}</span>
				</div>
				<div class="mt-1 text-text-muted">{entry.reason}</div>
				<div class="meta-label mt-1 text-text-dim">
					prior confidence {entry.prior_confidence ?? '—'} · {entry.operator}
				</div>
			</div>
		{/each}
	</div>
{/if}

{#if dialogOpen}
	<button
		type="button"
		class="fixed inset-0 z-50 cursor-default bg-black/50 backdrop-blur-[2px]"
		transition:fade={{ duration: 150 }}
		onclick={closeDialog}
		aria-label="Cancel force advance"
		tabindex="-1"
	></button>
	<div
		class="fixed left-1/2 top-[22vh] z-50 w-[420px] max-w-[92vw] -translate-x-1/2 rounded-md border border-[color-mix(in_srgb,var(--color-gate-failed)_40%,var(--color-border-default))] bg-surface-raised p-4 shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
		transition:fly={{ y: -14, duration: 220, easing: quintOut }}
		role="dialog"
		aria-label="Force advance stage"
	>
		<div class="meta-label text-gate-failed">Operator force-advance</div>
		<h3 class="mt-2 text-[15px] font-semibold">
			{project.stage.id} {stageName(project.stage.id)} → {nextStage} {nextStage ? stageName(nextStage) : ''}
		</h3>
		<p class="mt-1.5 text-text-muted">
			This bypasses the gate. Stage, reason, prior confidence ({project.stage.confidence ?? 'not evaluated'}),
			operator, and timestamp are recorded permanently.
		</p>
		<label class="meta-label mt-3 block" for="force-reason">Reason (required)</label>
		<textarea
			id="force-reason"
			{@attach (node: HTMLTextAreaElement) => node.focus()}
			bind:value={reason}
			rows="3"
			class="mt-1.5 w-full resize-none rounded-sm border border-border-default bg-surface-base p-2 font-mono text-[12px] text-text-primary outline-none placeholder:text-text-dim focus:border-text-dim"
			placeholder="why this gate is being bypassed…"
		></textarea>
		<label class="meta-label mt-3 block" for="operator-token">Operator credential (required)</label>
		<input
			id="operator-token"
			bind:value={operatorToken}
			type="password"
			autocomplete="current-password"
			class="mt-1.5 w-full rounded-sm border border-border-default bg-surface-base p-2 font-mono text-[12px] text-text-primary outline-none focus:border-text-dim"
		/>
		{#if dialogError}
			<div class="mt-2 text-gate-failed" role="alert">{dialogError}</div>
		{/if}
		<div class="mt-3 flex justify-end gap-2">
			<button type="button" class="btn" onclick={closeDialog}>Cancel</button>
			<button
				type="button"
				class="btn border-[color-mix(in_srgb,var(--color-gate-failed)_50%,var(--color-border-default))] text-gate-failed"
				onclick={() => void confirmForceAdvance()}
				disabled={reason.trim().length < 5 || operatorToken.length === 0 || submitting}
			>
				{submitting ? 'Recording…' : 'Force advance'}
			</button>
		</div>
	</div>
{/if}
