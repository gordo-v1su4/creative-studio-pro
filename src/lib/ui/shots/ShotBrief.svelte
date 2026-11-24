<script lang="ts">
	/**
	 * The selected shot in the dock's Details tab while the canvas is open: what the card no longer carries (story
	 * beat, purpose, spec and prompts in their skill's sections) and the two-step make-a-take block. Reading only:
	 * the text is edited in the grid's Details, where unsaved edits have somewhere to live.
	 */
	import type { Project, StoryCard } from '$lib/domain/schemas';
	import { pickFor } from '$lib/domain/takes';
	import { shotCardFacts } from '$lib/domain/shot-card';
	import { ghostSections, imageSections, type PromptSection } from '$lib/domain/prompt-sections';
	import { SIZE_WORDS } from '$lib/domain/shot-spec';
	import PromptSections from '$lib/ui/shots/PromptSections.svelte';
	import MakeTake from '$lib/ui/shots/MakeTake.svelte';

	let { project, card, code = null, onUpdated }: { project: Project; card: StoryCard | null; code?: string | null; onUpdated: (project: Project) => void } = $props();

	const pick = $derived(card ? pickFor(project.production, card) : null);
	const facts = $derived(card ? shotCardFacts(card, project.production.assets, pick?.asset_id ?? null) : null);
	const specRows = $derived.by((): PromptSection[] => {
		const spec = card?.fit?.spec;
		if (!spec) return [];
		return [
			{ key: 'shot', label: 'Shot', text: `${SIZE_WORDS[spec.size]}, ${spec.angle}` },
			{ key: 'who', label: 'Who', text: spec.subjects.join(', ') },
			{ key: 'action', label: 'Action', text: spec.action },
			{ key: 'says', label: 'Says', text: spec.dialogue },
			{ key: 'where', label: 'Where', text: spec.location },
			{ key: 'light', label: 'Light', text: spec.light },
			{ key: 'camera', label: 'Camera', text: spec.camera_move },
			{ key: 'length', label: 'Length', text: `${spec.duration_s}s` }
		];
	});
	const videoRows = $derived(card ? (ghostSections(card.video_prompt) ?? [{ key: 'all', label: 'Prompt', text: card.video_prompt }]) : []);
	const imageRows = $derived(card ? (imageSections(card.image_prompt) ?? [{ key: 'all', label: 'Prompt', text: card.image_prompt }]) : []);
	const videoCheck = $derived.by(() => {
		if (!card) return null;
		if (!ghostSections(card.video_prompt)) return { label: "Not in Ghost's sections", tone: 'note' as const };
		const found = card.fit?.qc;
		if (!found) return { label: 'Checked on send', tone: 'note' as const };
		return found.length ? { label: `${found.length} to fix`, tone: 'fix' as const, lines: found } : { label: 'Check clean', tone: 'clean' as const };
	});
</script>

<div class="brief">
	{#if !card || !facts}
		<p class="cp none">Select one shot on the canvas to see its details</p>
	{:else}
		<p class="cp head"><b>{code ?? facts.number}</b><span data-status={facts.status}>{facts.statusLabel}</span><span>{facts.length}</span></p>
		<p class="title">{card.title}</p>
		<p class="cp">Story beat</p>
		<p class="text">{card.beat}</p>
		<p class="cp">Purpose</p>
		<p class="text">{card.purpose}</p>
		{#if specRows.length}<PromptSections title="Shot spec" skill="Ghost" sections={specRows} scope={card.card_id} readonly />{/if}
		<PromptSections title="Image prompt" skill="ONE SHOT" sections={imageRows} scope={card.card_id} readonly />
		<PromptSections title="Video prompt" skill="Ghost" sections={videoRows} scope={card.card_id} check={videoCheck} readonly />
		<MakeTake {project} {card} {pick} {onUpdated} />
		<p class="cp foot">Edit the text in Grid</p>
	{/if}
</div>

<style>
	.brief { display: flex; flex-direction: column; gap: 6px; padding: 12px; color: var(--color-ink-2); font-size: 12.5px; }
	.cp { margin: 6px 0 0; color: var(--color-ink-3); }
	.none { margin: 0; white-space: normal; line-height: 1.6; }
	.head { display: flex; gap: 10px; margin: 0; }
	.head b { font-weight: 400; color: var(--color-teal); }
	.head [data-status='approved'] { color: var(--color-teal); }
	.head [data-status='awaiting'] { color: var(--color-amber); }
	.head [data-status='changes'] { color: #ff7a6b; }
	.head [data-status='progress'] { color: #7fb2ff; }
	.title { margin: 0; color: var(--color-ink); font-size: 13px; }
	.text { margin: 0; color: #c8c8ce; line-height: 1.5; }
	.foot { margin-top: 10px; }
</style>
