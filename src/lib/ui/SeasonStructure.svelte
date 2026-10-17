<script lang="ts">
	import type { Project } from '$lib/domain/schemas';
	import type { SeriesRecord } from '$lib/server/series';
	import { SAVE_THE_CAT, emptySections, sectionRank, storyBeatColor } from '$lib/domain/structures';
	import { pickFor } from '$lib/domain/takes';
	import { reviewSequence } from '$lib/ui/review-sequence.svelte';

	/**
	 * The season in its structure (V1S-273), above the Episode outline: Save the Cat sections → story beats →
	 * the scenes of this episode they play out in. Gaps are called out; each story beat can play its shots in
	 * order. Read-only: the story is edited in Notion (links open the page).
	 */
	let { project }: { project: Project } = $props();
	const series = $derived(project.series!);
	let record = $state<SeriesRecord | null>(null);
	let note = $state<string | null>(null);
	$effect(() => {
		const id = series.series_id;
		void fetch(`/api/series/${id}`).then((response) => response.json()).then((body: { ok: boolean; data?: SeriesRecord }) => { if (body.ok && body.data) record = body.data; }).catch(() => {});
	});

	const beats = $derived((record?.story_beats?.beats ?? []).toSorted((a, b) => sectionRank(SAVE_THE_CAT, a.section) - sectionRank(SAVE_THE_CAT, b.section) || (a.order ?? 0) - (b.order ?? 0)));
	const colorOf = (pageId: string) => storyBeatColor(beats.findIndex((beat) => beat.page_id === pageId), beats.length);
	const scenesOf = (pageId: string) => series.scenes.filter((scene) => scene.story_beat_ids?.includes(pageId));
	const empty = $derived(emptySections(SAVE_THE_CAT, beats.map((beat) => beat.section)));
	const unplaced = $derived(beats.filter((beat) => beat.scene_ids.length === 0));
	const notionUrl = (id: string) => `https://www.notion.so/${id.replace(/-/g, '')}`;

	/** Load a story beat's shots (this episode, story order, benched left out) into the review player. */
	function play(pageId: string) {
		const groups = new Set(scenesOf(pageId).map((scene) => scene.group_id));
		const items = project.production.cards
			.filter((card) => card.group_id && groups.has(card.group_id) && !card.benched)
			.toSorted((a, b) => a.order - b.order)
			.flatMap((card) => {
				const pick = pickFor(project.production, card);
				return pick?.kind === 'video' ? [{ id: card.card_id, title: card.title, src: pick.url, assetId: pick.asset_id }] : [];
			});
		if (!items.length) { note = 'None of this story beat\'s shots has a video pick yet.'; return; }
		note = null;
		reviewSequence.items = items;
		reviewSequence.playing = true;
	}
</script>

{#if record?.story_beats?.database}
	<section class="season" aria-label="Season structure">
		<div class="flex flex-wrap items-baseline gap-3">
			<p class="cap accent">Season · Save the Cat</p>
			<a class="text-[11px] text-nr-dim" href={notionUrl(record.story_beats.database)} target="_blank" rel="noreferrer">edit story beats in Notion ↗</a>
		</div>
		{#if empty.length || unplaced.length}
			<div class="gaps" role="note">
				{#if empty.length}<p><b>No story beat yet:</b> {empty.join(' · ')}</p>{/if}
				{#if unplaced.length}<p><b>Not in any scene:</b> {unplaced.map((beat) => beat.title).join(' · ')}</p>{/if}
			</div>
		{/if}
		<ol class="sections">
			{#each SAVE_THE_CAT.sections as section (section)}
				{@const own = beats.filter((beat) => beat.section.toLowerCase() === section.toLowerCase())}
				<li class={['section', !own.length && 'empty']}>
					<span class="name">{section}</span>
					<div class="beats">
						{#each own as beat (beat.page_id)}
							{@const here = scenesOf(beat.page_id)}
							<div class="beat">
								<span class="dot" style:background={colorOf(beat.page_id)}></span>
								<a class="title" href={notionUrl(beat.page_id)} target="_blank" rel="noreferrer" title={beat.summary || beat.title}>{beat.title}</a>
								<span class="where">{here.length ? here.map((scene) => scene.title.split(/\s+[—–-]\s+/)[0]).join(', ') : beat.scene_ids.length ? 'other episodes' : 'no scene'}</span>
								{#if here.length}<button type="button" class="key" onclick={() => play(beat.page_id)} title="Play this story beat's shots in order">▶ Play</button>{/if}
							</div>
						{:else}
							<span class="none">—</span>
						{/each}
					</div>
				</li>
			{/each}
		</ol>
		{#if note}<p class="text-[11.5px] text-nr-muted" role="status">{note}</p>{/if}
	</section>
{/if}

<style>
	.season { display: grid; gap: 10px; margin-bottom: 28px; }
	.cap { color: var(--color-nr-dim); font: 600 10px var(--font-sans); letter-spacing: 0.16em; text-transform: uppercase; }
	.cap.accent { color: var(--color-nr-accent); }
	.gaps { border: 1px solid var(--color-nr-danger-line); border-radius: 2px; padding: 8px 10px; color: var(--color-nr-text); font-size: 11.5px; display: grid; gap: 3px; }
	.gaps b { color: var(--color-nr-danger-text); font-weight: 600; }
	.sections { display: grid; gap: 2px; }
	.section { display: grid; grid-template-columns: 150px minmax(0, 1fr); column-gap: 12px; align-items: start; padding: 5px 0; border-bottom: 1px solid var(--color-nr-line-soft); }
	.section .name { color: var(--color-nr-muted); font-size: 11.5px; }
	.section.empty .name { color: var(--color-nr-faint); }
	.beats { display: grid; gap: 4px; min-width: 0; }
	.beat { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto auto; align-items: center; column-gap: 8px; }
	.dot { width: 8px; height: 8px; border-radius: 50%; }
	.title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-nr-ink); font-size: 12px; text-decoration: none; }
	.title:hover { color: var(--color-nr-accent); }
	.where { color: var(--color-nr-dim); font: 10.5px var(--font-mono); white-space: nowrap; }
	.none { color: var(--color-nr-faint); font-size: 11px; }
	.key { display: inline-flex; align-items: center; border: 1px solid var(--color-nr-line); border-radius: 2px; background: transparent; padding: 0 8px; color: var(--color-nr-muted); font: 600 9px/20px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; white-space: nowrap; }
	.key:hover { border-color: color-mix(in srgb, var(--color-nr-accent) 55%, transparent); color: var(--color-nr-ink); }
	@media (max-width: 640px) {
		.section { grid-template-columns: minmax(0, 1fr); row-gap: 4px; }
		.beat { grid-template-columns: 8px minmax(0, 1fr) auto; }
		.where { display: none; }
	}
</style>
