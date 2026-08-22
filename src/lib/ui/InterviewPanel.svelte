<script lang="ts">
	import { CONFIDENCE_DIMENSIONS } from '$lib/domain/schemas';
	import type { Project, ConfidenceDimension } from '$lib/domain/schemas';

	let { project, onUpdated }: { project: Project; onUpdated: (project: Project) => void } = $props();
	const labels: Record<ConfidenceDimension, string> = {
		goal_clarity: 'Goal clarity', format_runtime: 'Format & runtime', story_beats: 'Story / beats',
		visual_intent: 'Visual intent', asset_coverage: 'Asset coverage', continuity_plan: 'Continuity plan',
		constraints: 'Constraints', executable_next_step: 'Executable next step'
	};
	const starterQuestions = () => ([
		{ prompt: 'What is the deliverable shape and who is it for?', answer: '' },
		{ prompt: 'What runtime, aspect ratio, and platform are required?', answer: '' },
		{ prompt: 'Which beat, image, line, or constraint must survive?', answer: '' }
	]);
	let questions = $state(starterQuestions());
	let scores = $state(Object.fromEntries(CONFIDENCE_DIMENSIONS.map((dimension) => [dimension, 0])) as Record<ConfidenceDimension, number>);
	let notes = $state(Object.fromEntries(CONFIDENCE_DIMENSIONS.map((dimension) => [dimension, ''])) as Record<ConfidenceDimension, string>);
	let overall = $state(0);
	let resolutions = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let complete = $derived(questions.length > 0 && questions.length <= 5 && questions.every((item) => item.prompt.trim() && item.answer.trim()));

	function resetDraft() {
		questions = starterQuestions();
		scores = Object.fromEntries(CONFIDENCE_DIMENSIONS.map((dimension) => [dimension, 0])) as Record<ConfidenceDimension, number>;
		notes = Object.fromEntries(CONFIDENCE_DIMENSIONS.map((dimension) => [dimension, ''])) as Record<ConfidenceDimension, string>;
		overall = 0;
		resolutions = '';
		error = null;
	}

	$effect(() => {
		project.project_id;
		project.interview.rounds.length;
		resetDraft();
	});

	function addQuestion() { if (questions.length < 5) questions.push({ prompt: '', answer: '' }); }
	function removeQuestion(index: number) { if (questions.length > 1) questions.splice(index, 1); }

	async function submit() {
		if (!complete || busy) return;
		busy = true; error = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/interview`, {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ expected_version: project.version, questions, overall,
					scores: CONFIDENCE_DIMENSIONS.map((dimension) => ({ dimension, score: scores[dimension], notes: notes[dimension] })),
					resolutions: resolutions.split('\n').map((value) => value.trim()).filter(Boolean) })
			});
			const body = await response.json() as { ok: true; data: Project } | { ok: false; error: { message: string } };
			if (!body.ok) throw new Error(body.error.message);
			if (body.data.interview.status === 'BLOCKED') resetDraft();
			onUpdated(body.data);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Interview round failed'; }
		finally { busy = false; }
	}
</script>

<section class="mt-3" aria-labelledby="interview-heading">
	<div class="flex items-center justify-between">
		<h3 id="interview-heading" class="meta-label">S1 interview · round {project.interview.rounds.length + 1}</h3>
		<span class="meta-label text-text-dim">{project.interview.status}</span>
	</div>
	{#if project.interview.status === 'STALLED'}
		<p class="mt-2 rounded-sm border border-gate-failed p-2 text-gate-failed" role="alert">STALLED after three low-confidence loops. Resolve the recorded blockers; no assumptions will be made.</p>
	{:else if project.interview.status !== 'PASSED'}
		<p class="mt-1.5 text-text-muted">Owner-decision questions only. Maximum five per round.</p>
		{#each questions as question, index (index)}
			<div class="mt-2 rounded-sm border border-border-subtle p-2">
				<label class="meta-label" for={`q-${index}`}>Question {index + 1}</label>
				<input id={`q-${index}`} bind:value={question.prompt} class="mt-1 w-full rounded-sm border border-border-default bg-surface-base p-2 text-[12px]" />
				<label class="meta-label mt-2 block" for={`a-${index}`}>Exact owner answer</label>
				<textarea id={`a-${index}`} bind:value={question.answer} rows="2" class="mt-1 w-full rounded-sm border border-border-default bg-surface-base p-2 text-[12px]"></textarea>
				{#if questions.length > 1}<button type="button" class="btn mt-1" onclick={() => removeQuestion(index)}>Remove</button>{/if}
			</div>
		{/each}
		{#if questions.length < 5}<button type="button" class="btn mt-2" onclick={addQuestion}>+ question</button>{/if}
		<div class="mt-3 grid gap-2">
			{#each CONFIDENCE_DIMENSIONS as dimension (dimension)}
				<div class="grid grid-cols-[1fr_64px] gap-2">
					<label class="text-text-muted" for={`score-${dimension}`}>{labels[dimension]}</label>
					<input id={`score-${dimension}`} type="number" min="0" max="100" bind:value={scores[dimension]} class="rounded-sm border border-border-default bg-surface-base px-2" />
					<input aria-label={`${labels[dimension]} gap notes`} bind:value={notes[dimension]} placeholder="Notes / gap" class="col-span-2 rounded-sm border border-border-default bg-surface-base p-2 text-[12px]" />
				</div>
			{/each}
		</div>
		<label class="meta-label mt-3 block" for="overall-confidence">Overall confidence</label>
		<input id="overall-confidence" type="number" min="0" max="100" bind:value={overall} class="mt-1 w-20 rounded-sm border border-border-default bg-surface-base p-2" />
		<label class="meta-label mt-2 block" for="resolutions">Resolved this round (one per line)</label>
		<textarea id="resolutions" bind:value={resolutions} rows="2" class="mt-1 w-full rounded-sm border border-border-default bg-surface-base p-2 text-[12px]"></textarea>
		{#if error}<p class="mt-2 text-gate-failed" role="alert">{error}</p>{/if}
		<button type="button" class="btn btn-accent mt-3 w-full justify-center" disabled={!complete || busy} onclick={() => void submit()}>{busy ? 'Recording…' : 'Record confidence round'}</button>
	{/if}
	{#if project.interview.rounds.length}
		<div class="mt-3" aria-live="polite">
			{#each [...project.interview.rounds].reverse() as round (round.round_id)}
				<div class="mb-2 rounded-sm border border-border-subtle p-2 text-text-muted">
					<strong>Round {round.round_number}: {round.overall}/100 · {round.status}</strong>
					<div class="mt-1">Lowest: {labels[round.lowest_dimension]} {round.lowest_score}</div>
				</div>
			{/each}
		</div>
	{/if}
</section>
