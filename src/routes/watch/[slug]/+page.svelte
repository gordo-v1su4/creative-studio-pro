<script lang="ts">
	import type { PublicSnapshot } from '$lib/domain/publish';

	/** One published project, read-only: its films (exported cuts), the episode outline, and the board. */
	let { data } = $props();
	const snap: PublicSnapshot = $derived(data.snapshot);
	const url = (file: string) => data.urls[file] ?? '';
	const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

	const films = $derived(snap.cuts.filter((cut) => cut.film));
	/** The board as sections: one per group in story order (Main for beats in no group). */
	const sections = $derived.by(() => {
		const name = new Map(snap.groups.map((group) => [group.group_id, group.name]));
		const out: Array<{ key: string; name: string; beats: PublicSnapshot['beats'] }> = [];
		for (const beat of snap.beats) {
			const key = beat.group_id ?? 'main';
			let section = out.find((entry) => entry.key === key);
			if (!section) { section = { key, name: beat.group_id ? (name.get(beat.group_id) ?? 'Group') : 'Main', beats: [] }; out.push(section); }
			section.beats.push(beat);
		}
		return out;
	});
	const acts = $derived.by(() => {
		const out: Array<{ act: string; scenes: NonNullable<PublicSnapshot['series']>['scenes'] }> = [];
		for (const scene of snap.series?.scenes ?? []) {
			const act = scene.act || 'Scenes';
			let entry = out.find((a) => a.act === act);
			if (!entry) { entry = { act, scenes: [] }; out.push(entry); }
			entry.scenes.push(scene);
		}
		return out;
	});
</script>

<svelte:head>
	<title>{snap.title} — Creative Studio Pro</title>
	<meta name="description" content={snap.logline.slice(0, 160)} />
</svelte:head>

<div class="mx-auto grid max-w-[1100px] gap-8 px-4 py-8 sm:px-6">
	<header>
		<a class="back" href="/watch">← All published work</a>
		{#if snap.series}<p class="cap mt-4">Episode {snap.series.episode_number}</p>{/if}
		<h1 class="title">{snap.title}</h1>
		{#if snap.logline}<p class="logline">{snap.logline}</p>{/if}
		<p class="meta">Published {new Date(snap.published_at).toLocaleDateString()} · {snap.beats.length} beats{snap.cuts.length ? ` · ${snap.cuts.length} cut${snap.cuts.length === 1 ? '' : 's'}` : ''}</p>
	</header>

	{#if films.length}
		<section class="grid gap-4" aria-label="Films">
			{#each films as cut (cut.id)}
				<figure class="film">
					<!-- svelte-ignore a11y_media_has_caption -->
					<video src={url(cut.film!.file)} controls preload="metadata" playsinline></video>
					<figcaption><b>{cut.name}</b> · v{cut.version} · {clock(cut.length_s)}</figcaption>
				</figure>
			{/each}
		</section>
	{/if}

	{#if snap.series}
		<section aria-label="Episode outline">
			<p class="cap">Episode outline</p>
			{#if snap.series.summary}<p class="summary">{snap.series.summary}</p>{/if}
			<div class="mt-4 grid gap-4">
				{#each acts as act (act.act)}
					<div>
						<div class="act-head"><span class="cap dim">{act.act}</span><span class="line"></span></div>
						<ul class="grid gap-1">
							{#each act.scenes as scene (scene.page_id)}
								<li class="scene">
									<p class="text-[12.5px] text-nr-ink">{scene.title}</p>
									<p class="text-[11px] text-nr-dim">{scene.location || '—'}{scene.characters.length ? ` · ${scene.characters.join(', ')}` : ''}</p>
									{#if scene.summary}<p class="scene-summary">{scene.summary}</p>{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<section aria-label="Board">
		<p class="cap">Board</p>
		{#each sections as section (section.key)}
			<div class="mt-5">
				<div class="act-head"><span class="cap dim">{section.name}</span><span class="line"></span><span class="mono">{section.beats.length}</span></div>
				<ul class="beats">
					{#each section.beats as beat (beat.id)}
						<li class="beat">
							<div class="frame">
								{#if beat.take?.kind === 'video'}
									<!-- svelte-ignore a11y_media_has_caption -->
									<video src={url(beat.take.file)} controls preload="none" playsinline></video>
								{:else if beat.take?.kind === 'image'}
									<img src={url(beat.take.file)} alt={beat.title} loading="lazy" />
								{:else}
									<span class="none">No take yet</span>
								{/if}
							</div>
							<div class="beat-body">
								<p class="flex items-baseline gap-2"><b class="text-[12px] text-nr-ink">{beat.title}</b><span class="grow"></span><span class="mono">{beat.duration_s}s</span></p>
								<p class="beat-text">{beat.beat}</p>
								{#if beat.prompts}
									<details class="prompts"><summary>Prompts</summary><p><b>Image</b> {beat.prompts.image}</p><p><b>Video</b> {beat.prompts.video}</p></details>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</section>
</div>

<style>
	.cap { color: var(--color-nr-accent); font: 600 10px var(--font-sans); letter-spacing: 0.16em; text-transform: uppercase; }
	.cap.dim { color: var(--color-nr-dim); }
	.back { color: var(--color-nr-dim); font-size: 12px; text-decoration: none; }
	.back:hover { color: var(--color-nr-accent); }
	.title { margin-top: 4px; color: var(--color-nr-mark); font-size: 22px; font-weight: 600; line-height: 1.25; }
	.logline { margin-top: 6px; max-width: 760px; color: var(--color-nr-muted); font-size: 13px; line-height: 1.6; }
	.meta, .mono { color: var(--color-nr-dim); font: 10.5px var(--font-mono); }
	.meta { margin-top: 8px; }
	.film { margin: 0; }
	.film video { width: 100%; max-height: 70vh; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; background: #000; }
	.film figcaption { margin-top: 6px; color: var(--color-nr-muted); font-size: 12px; }
	.film figcaption b { color: var(--color-nr-ink); font-weight: 500; }
	.summary { margin-top: 6px; max-width: 760px; color: var(--color-nr-text); font-size: 12.5px; line-height: 1.6; }
	.act-head { margin-bottom: 6px; display: flex; align-items: center; gap: 10px; }
	.act-head .line { flex: 1; height: 1px; background: var(--color-nr-line-soft); }
	.scene { border: 1px solid var(--color-nr-line-soft); border-radius: 2px; padding: 8px 10px; }
	.scene-summary { margin-top: 4px; color: var(--color-nr-muted); font-size: 11.5px; line-height: 1.55; }
	.beats { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
	.beat { overflow: hidden; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; background: var(--color-nr-card); }
	.frame { display: grid; aspect-ratio: 16 / 9; place-items: center; background: var(--color-nr-deep); }
	.frame video, .frame img { width: 100%; height: 100%; object-fit: cover; }
	.none { color: var(--color-nr-faint); font-size: 11px; }
	.beat-body { display: grid; gap: 4px; padding: 8px 10px 10px; }
	.beat-text { display: -webkit-box; overflow: hidden; color: var(--color-nr-muted); font-size: 11.5px; line-height: 1.5; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; }
	.prompts summary { cursor: pointer; color: var(--color-nr-dim); font: 600 9.5px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; }
	.prompts p { margin-top: 4px; color: var(--color-nr-muted); font-size: 11px; line-height: 1.5; }
	.prompts b { color: var(--color-nr-text); font-weight: 500; }
</style>
