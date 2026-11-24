<script lang="ts">
	/**
	 * The Agent's actions in its dock (decision 18): pitch three loglines, three more, quick teaser, draft the
	 * brief, propose the next level. They are the same actions the story plan offers in place, and whichever way
	 * one is started, what the Agent is doing and what came of it is said here (story 6).
	 */
	import type { Project } from '$lib/domain/schemas';
	import { levelsOf, nextLevel } from '$lib/domain/story-levels';
	import { proposeBlocked, runtimeSeconds, type ProposeLevel } from '$lib/domain/story-propose';
	import { DEFAULT_TARGET } from '$lib/domain/trailer-house';
	import { ui } from '$lib/ui/app-state.svelte';
	import { agentWork } from '$lib/ui/story/agent-work.svelte';

	let { project, buttons = true }: { project: Project; /** False: only what the Agent is doing and what came of it is shown. */ buttons?: boolean } = $props();

	const house = $derived(project.trailer_house);
	const picked = $derived(house?.picked ?? null);
	const plan = $derived(project.production.story_plan);
	const lines = $derived(agentWork.linesFor(project.project_id));
	const working = $derived(agentWork.busy !== null);
	const words: Record<ProposeLevel, string> = { acts: 'Propose acts', scenes: 'Propose scenes', beats: 'Propose story beats', shots: 'Propose shots' };
	// The level the plan is waiting on, when the Agent can fill it.
	const next = $derived.by<{ level: ProposeLevel; why: string | null } | null>(() => {
		if (!plan) return null;
		const level = nextLevel(levelsOf(project));
		if (!level || level === 'brief') return null;
		const why = ui.storyDirty ? 'Save your changes in the story plan first' : level === 'shots' && !plan.sections.some((section) => section.moments.some((moment) => moment.approved && !moment.shots.length)) ? (proposeBlocked(plan, level) ?? 'Approve the story beats first') : proposeBlocked(plan, level);
		return { level, why };
	});
</script>

{#if buttons || lines.length}
<section class="work" aria-label="The Agent's actions">
	{#if buttons}
	<div class="acts">
		<button type="button" class="key agent" disabled={working} onclick={() => void agentWork.pitch(project)} title="Three loglines to react to. Nothing is made.">{house?.rounds.length ? 'Three more' : 'Pitch three loglines'}</button>
		<button type="button" class="key agent" disabled={working || !picked} onclick={() => picked && void agentWork.teaserFor(project, picked.round, picked.index, house?.target ?? DEFAULT_TARGET)} title={picked ? 'One teaser prompt for the logline you picked, written and checked. Rendering it is a separate, priced step.' : 'Pick a logline first'}>Quick teaser</button>
		<button type="button" class="key agent" disabled={working} onclick={() => void agentWork.draftBrief(project)} title="Draft every field of the brief for you to read. Nothing is saved until you save.">Draft the brief</button>
		{#if next}<button type="button" class="key agent" disabled={working || !!next.why} onclick={() => void agentWork.propose(project, next.level, next.level === 'beats' ? runtimeSeconds(project.brief_state.versions.at(-1)?.format.runtime) : undefined)} title={next.why ?? 'Propose the level the story plan is waiting on. It fills what is empty and changes nothing that is there.'}>{words[next.level]}</button>{/if}
	</div>
	{/if}
	<div class="said" aria-live="polite">
		{#each lines as line (line.id)}
			<p data-state={line.state}><span class="cp who">Agent</span>{line.text}</p>
		{/each}
	</div>
</section>
{/if}

<style>
	.work { display: flex; flex: none; flex-direction: column; gap: 6px; padding: 8px 10px 2px; }
	.acts { display: flex; flex-wrap: wrap; gap: 4px; }
	.said { display: flex; max-height: 132px; flex-direction: column; gap: 4px; overflow-y: auto; }
	.said p { margin: 0; color: var(--color-ink-2); font: 12.5px/1.45 var(--font-sans); }
	.said p[data-state='doing'] { color: var(--color-ink); }
	.said p[data-state='failed'] { color: #ff7a6b; }
	.who { margin-right: 8px; color: #8f86b8; }
</style>
