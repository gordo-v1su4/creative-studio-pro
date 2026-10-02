<script lang="ts">
	import type { Project } from '$lib/domain/schemas';
	import { clockOf, episodeOutline, type OutlineCard } from '$lib/domain/episode-outline';

	/**
	 * The Episode outline, at the top of the Story tab for an episode imported from Notion: the act timeline
	 * sized to the episode length (10 / 15 / 30 min, the series' setting), each scene's time budget against
	 * the shots the board holds for it now, and who appears where. Reads the live board (`cards`), so edits
	 * and bench/unbench show at once.
	 */
	let { project, cards }: { project: Project; cards: OutlineCard[] } = $props();
	const series = $derived(project.series!);

	let minutes = $state(10);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let open = $state<string | null>(null);

	// The episode length is the series' setting (also set on the Series page).
	$effect(() => {
		const id = series.series_id;
		void fetch(`/api/series/${id}`).then((response) => response.json()).then((body: { ok: boolean; data?: { runtime_min: number } }) => {
			if (body.ok && body.data && id === series.series_id) minutes = body.data.runtime_min;
		}).catch(() => {});
	});

	async function setLength(next: number) {
		const previous = minutes;
		minutes = next; saving = true; error = null;
		try {
			const response = await fetch(`/api/series/${series.series_id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'runtime', runtime_min: next }) });
			const body = (await response.json()) as { ok: boolean; error?: { message: string } };
			if (!body.ok) throw new Error(body.error?.message ?? 'Could not save the episode length');
		} catch (cause) { minutes = previous; error = cause instanceof Error ? cause.message : 'Could not save the episode length'; }
		finally { saving = false; }
	}

	const outline = $derived(episodeOutline(series, cards, minutes));
	const pct = (part: number, whole: number) => `${Math.max(0, Math.min(100, whole ? (part / whole) * 100 : 0)).toFixed(1)}%`;
	const short = $derived(outline.gap_s > 0);
</script>

<section class="episode-outline" aria-label="Episode outline">
	<div class="flex flex-wrap items-baseline gap-3">
		<p class="cap accent">Episode outline</p>
		<span class="text-[11px] text-nr-dim">from Notion · imported {new Date(series.imported_at).toLocaleDateString()}</span>
	</div>
	<h2 class="title">{series.episode_title}</h2>
	{#if series.summary}<p class="summary">{series.summary}</p>{/if}

	<!-- Length and fill -->
	<div class="mt-4 flex flex-wrap items-center gap-2">
		<span class="cap">Episode length</span>
		{#each [10, 15, 30] as option (option)}
			<button type="button" class={['key', minutes === option && 'on']} aria-pressed={minutes === option} onclick={() => void setLength(option)} disabled={saving}>{option} min</button>
		{/each}
		<span class="grow"></span>
		<span class="readout" title="Shots on the board (benched beats left out) against the episode length">
			<b>{clockOf(outline.shot_s)}</b> of shots · <b>{clockOf(outline.target_s)}</b> episode
			{#if short}· <span class="text-nr-muted">{clockOf(outline.gap_s)} to write ({Math.round(outline.fill * 100)}%)</span>{:else}· <span class="text-nr-accent">full</span>{/if}
		</span>
	</div>
	{#if error}<p class="mt-2 text-[12px] text-nr-danger-text" role="alert">{error}</p>{/if}

	<!-- Act timeline: each act's width is its share of the episode; the fill is the shots it has now -->
	<div class="timeline" role="img" aria-label={`Act timeline: ${outline.acts.map((act) => `${act.act} ${clockOf(act.shot_s)} of ${clockOf(act.target_s)}`).join(', ')}`}>
		{#each outline.acts as act (act.act)}
			<div class="act" style:flex-grow={act.target_s} title={`${act.act}: ${clockOf(act.shot_s)} of shots for ${clockOf(act.target_s)}`}>
				<div class="act-bar"><span style:width={pct(act.shot_s, act.target_s)}></span></div>
				<div class="act-label"><b>{act.act}</b><span>{clockOf(act.target_s)}</span></div>
			</div>
		{/each}
	</div>

	<!-- Scenes, act by act -->
	<div class="mt-5 grid grid-cols-[minmax(0,1fr)] gap-4">
		{#each outline.acts as act (act.act)}
			<div>
				<div class="act-head"><span class="cap">{act.act}</span><span class="line"></span><span class="mono">{clockOf(act.shot_s)} / {clockOf(act.target_s)}</span></div>
				<ul class="grid grid-cols-[minmax(0,1fr)] gap-1">
					{#each act.scenes as scene (scene.page_id)}
						<li>
							<button type="button" class="scene" aria-expanded={open === scene.page_id} onclick={() => (open = open === scene.page_id ? null : scene.page_id)}>
								<span class="min-w-0 grow text-left">
									<span class="block truncate text-[12.5px] text-nr-ink">{scene.title}</span>
									<span class="block truncate text-[11px] text-nr-dim">{scene.location || '—'}{scene.characters.length ? ` · ${scene.characters.join(', ')}` : ''}</span>
								</span>
								<span class="meta">{scene.shots} shot{scene.shots === 1 ? '' : 's'}</span>
								<span class="budget">
									<span class="mono">{clockOf(scene.shot_s)} / {clockOf(scene.target_s)}</span>
									<span class="meter"><span style:width={pct(scene.shot_s, scene.target_s)}></span></span>
								</span>
							</button>
							{#if open === scene.page_id}
								<div class="scene-body">
									{#if scene.timecode}<p class="text-[11px] text-nr-dim">Planned in Notion: {scene.timecode}</p>{/if}
									{#if scene.summary}<p>{scene.summary}</p>{/if}
									{#if scene.story_beats}<p class="beats">{scene.story_beats}</p>{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>

	<!-- Who appears where -->
	{#if outline.characters.length}
		<div class="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<span class="cap">Characters</span>
			{#each outline.characters as person (person.name)}<span class="text-[12px] text-nr-text">{person.name} <span class="text-nr-dim">{person.scenes}</span></span>{/each}
		</div>
	{/if}
	{#if series.twist || series.cliffhanger}
		<dl class="mt-4 grid gap-1 text-[12px]">
			{#if series.twist}<div class="flex gap-2"><dt class="cap shrink-0 pt-[3px]">Twist</dt><dd class="text-nr-text">{series.twist}</dd></div>{/if}
			{#if series.cliffhanger}<div class="flex gap-2"><dt class="cap shrink-0 pt-[3px]">Cliffhanger</dt><dd class="text-nr-text">{series.cliffhanger}</dd></div>{/if}
		</dl>
	{/if}
</section>

<style>
	.episode-outline { border-top: 1px solid var(--color-nr-line-soft); padding-top: 14px; }
	.cap { color: var(--color-nr-dim); font: 600 10px var(--font-sans); letter-spacing: 0.16em; text-transform: uppercase; }
	.cap.accent { color: var(--color-nr-accent); }
	.title { margin-top: 4px; color: var(--color-nr-mark); font-size: 18px; font-weight: 600; }
	.summary { margin-top: 4px; max-width: 760px; color: var(--color-nr-muted); font-size: 12.5px; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
	.key { display: inline-flex; align-items: center; border: 1px solid var(--color-nr-line); border-radius: 2px; background: transparent; padding: 0 10px; color: var(--color-nr-muted); font: 600 9px/24px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; transition: border-color 140ms ease, color 140ms ease; }
	.key:hover:not(:disabled) { border-color: color-mix(in srgb, var(--color-nr-accent) 55%, transparent); color: var(--color-nr-ink); }
	.key.on { border-color: color-mix(in srgb, var(--color-nr-accent) 45%, transparent); color: var(--color-nr-accent); }
	.key:disabled { opacity: 0.5; }
	.readout { color: var(--color-nr-dim); font: 11px var(--font-mono); }
	.readout b { color: var(--color-nr-text); font-weight: 500; }
	.mono { color: var(--color-nr-muted); font: 11px var(--font-mono); white-space: nowrap; }
	.timeline { margin-top: 12px; display: flex; gap: 3px; }
	.act { min-width: 0; flex-basis: 0; }
	.act-bar { height: 6px; border-radius: 1px; background: var(--color-nr-line-soft); overflow: hidden; }
	.act-bar span { display: block; height: 100%; background: linear-gradient(90deg, #4ee8d2, #4ab8ff 60%, #8174e8); opacity: 0.85; transition: width 300ms ease; }
	.act-label { margin-top: 4px; display: flex; gap: 6px; overflow: hidden; color: var(--color-nr-dim); font: 10px var(--font-mono); white-space: nowrap; }
	.act-label b { color: var(--color-nr-text); font: 600 9.5px var(--font-sans); letter-spacing: 0.1em; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; }
	.act-head { margin-bottom: 6px; display: flex; align-items: center; gap: 10px; }
	.act-head .line { flex: 1; height: 1px; background: var(--color-nr-line-soft); }
	.scene { display: flex; width: 100%; align-items: center; gap: 12px; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; background: transparent; padding: 7px 10px; transition: border-color 140ms ease; }
	.scene:hover, .scene[aria-expanded='true'] { border-color: var(--color-nr-line); }
	.meta { flex: none; width: 52px; color: var(--color-nr-dim); font-size: 11px; text-align: right; }
	.budget { flex: none; display: grid; width: 104px; gap: 4px; justify-items: end; }
	.meter { display: block; width: 100%; height: 2px; background: var(--color-nr-line-soft); }
	.meter span { display: block; height: 100%; background: linear-gradient(90deg, #4ee8d2, #4ab8ff); transition: width 300ms ease; }
	.scene-body { margin: 2px 0 6px; display: grid; gap: 6px; border-left: 1px solid var(--color-nr-line); padding: 4px 0 4px 12px; color: var(--color-nr-text); font-size: 12px; line-height: 1.6; }
	.scene-body .beats { color: var(--color-nr-muted); white-space: pre-wrap; }
	@media (max-width: 560px) { .meta { display: none; } .budget { width: 86px; } }
	@media (prefers-reduced-motion: reduce) { .act-bar span, .meter span { transition: none; } }
</style>
