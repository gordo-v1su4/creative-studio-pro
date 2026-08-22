<script lang="ts">
	import { fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import type { Project } from '$lib/domain/schemas';
	let { open = $bindable(false), projectTitle = '', project = null }: { open?: boolean; projectTitle?: string; project?: Project | null } = $props();
	let latest = $derived(project?.interview.rounds.at(-1));
</script>

{#if open}
	<aside class="fixed inset-y-0 right-0 z-40 flex w-[380px] max-w-[92vw] flex-col border-l border-border-default bg-surface-raised shadow-[-16px_0_48px_rgba(0,0,0,0.55)]" transition:fly={{ x: 420, duration: 380, easing: quintOut }} aria-label="Agent interview record">
		<header class="flex items-center gap-2 border-b border-border-subtle px-3.5 py-3">
			<span class="charm-gradient-text font-bold">✦</span><span class="meta-label text-text-primary">Stage agent</span><span class="grow"></span>
			<span class="chip meta-label">{project?.interview.status ?? 'NO PROJECT'}</span>
			<button type="button" class="btn" onclick={() => (open = false)} aria-label="Close agent panel">esc</button>
		</header>
		<div class="grow overflow-y-auto px-3.5 py-4">
			{#if !project}
				<p class="text-text-muted">Open a project to begin the S1 interview.</p>
			{:else}
				<p class="meta-label text-text-dim">{projectTitle} · {project.stage.id} {project.stage.state}</p>
				<p class="mt-3 text-text-muted">The inspector is the authoritative S1/S2 command surface. Answers, scores, brief versions, and approvals are persisted through the project gateway; this drawer never keeps private shadow notes.</p>
				{#if latest}
					<div class="mt-4 rounded-sm border border-border-default bg-surface-raised-2 p-3" aria-live="polite">
						<h3 class="meta-label">Confidence round {latest.round_number} · {latest.status}</h3>
						<p class="mt-2">Overall {latest.overall}/100 · lowest {latest.lowest_dimension.replaceAll('_', ' ')} {latest.lowest_score}</p>
						{#each latest.questions as question, index (question.question_id)}
							<div class="mt-3"><strong class="block">{index + 1}. {question.prompt}</strong><p class="mt-1 whitespace-pre-wrap text-text-muted">{latest.answers.find((answer) => answer.question_id === question.question_id)?.raw_text}</p></div>
						{/each}
					</div>
				{:else}
					<p class="mt-4 rounded-sm border border-border-subtle p-3 text-text-muted">No interview round has been recorded. Use the Stage gate inspector; each round accepts no more than five owner-decision questions.</p>
				{/if}
				{#if project.stage.id === 'S2'}
					<p class="mt-4 rounded-sm border border-border-subtle p-3 text-text-muted">Brief versions: {project.brief_state.versions.length}. S2 passes only after the authenticated operator locks the current complete version.</p>
				{/if}
			{/if}
		</div>
	</aside>
{/if}
