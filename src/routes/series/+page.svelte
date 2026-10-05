<script lang="ts">
	import { onMount } from 'svelte';
	import type { SeriesRecord } from '$lib/server/series';

	/**
	 * Series from Notion. Connect a show by its root page (the only page the Creative Studio Pro connection
	 * can see), check it against the template, read the season story, pick the episode length, and import
	 * episodes: each becomes its own project, a board group per scene and a beat per shot.
	 */
	let configured = $state<boolean | null>(null);
	let series = $state<SeriesRecord[]>([]);
	let root = $state('');
	let busy = $state<string | null>(null);
	let error = $state<string | null>(null);
	let note = $state<string | null>(null);
	let storyOpen = $state<string | null>(null);

	async function load() {
		const response = await fetch('/api/series');
		const body = (await response.json()) as { ok: true; data: { notion_configured: boolean; series: SeriesRecord[] } };
		configured = body.data.notion_configured;
		series = body.data.series;
	}
	onMount(() => void load());

	async function call(url: string, payload: Record<string, unknown>, label: string): Promise<Record<string, unknown> | null> {
		busy = label; error = null; note = null;
		try {
			const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
			const body = (await response.json()) as { ok: true; data: SeriesRecord; [key: string]: unknown } | { ok: false; error: { message: string } };
			if (!body.ok) throw new Error(body.error.message);
			series = [...series.filter((s) => s.series_id !== body.data.series_id), body.data].sort((a, b) => a.title.localeCompare(b.title));
			return body;
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Request failed'; return null; }
		finally { busy = null; }
	}

	async function connect() {
		const done = await call('/api/series', { root }, 'connect');
		if (done) { root = ''; note = 'Connected. Check the template below, then import an episode.'; }
	}
	const refresh = (id: string) => void call(`/api/series/${id}`, { action: 'refresh' }, `refresh:${id}`);
	const setRuntime = (id: string, minutes: number) => void call(`/api/series/${id}`, { action: 'runtime', runtime_min: minutes }, `runtime:${id}`);
	async function importEpisode(id: string, episodePageId: string) {
		const done = await call(`/api/series/${id}`, { action: 'import', episode_page_id: episodePageId }, `import:${episodePageId}`);
		if (done) note = `Imported: ${done.scenes} scenes, ${done.shots} shots (${Math.round(Number(done.seconds))} s of shots). Open it below.`;
	}

	const allOk = (s: SeriesRecord) => s.checks.episodes.ok && s.checks.scenes.ok && s.checks.shots.ok;
	const notionUrl = (id: string) => `https://www.notion.so/${id}`;
</script>

<svelte:head><title>Series — Creative Studio Pro</title></svelte:head>

<div class="h-full overflow-y-auto p-6">
	<div class="mx-auto grid max-w-[920px] gap-8">
		<header>
			<p class="cap accent">Series</p>
			<h1 class="mt-1 text-[18px] font-semibold text-nr-ink">Shows from Notion</h1>
			<p class="mt-1 max-w-[680px] text-[12.5px] leading-6 text-nr-muted">A series lives in Notion: a root page with the season story and three linked databases, Episodes → Scenes → Shots. Connect the root and import an episode; it becomes its own project, with a board group for each scene and a beat for each shot. Notion stays the source. Nothing here writes to it.</p>
		</header>

		{#if configured === false}
			<section class="panel">
				<p class="cap">Set up the Notion connection (once)</p>
				<ol class="steps">
					<li>Open <a href="https://developers.notion.com" target="_blank" rel="noreferrer">developers.notion.com</a> → <b>Developer portal</b> → <b>Build</b> → <b>Internal connections</b> → <b>Create a new connection</b>, named <b>Creative Studio Pro</b>.</li>
					<li><b>Configuration</b>: leave only <b>Read content</b> on, and copy the installation access token.</li>
					<li><b>Content access</b> → <b>Edit access</b> → select only the top-level <i>Creative Studio Pro</i> page. Each show is a child page under it (duplicate its <i>Series Template</i> for a new one). Nothing else is shared.</li>
					<li>Add <code>NOTION_TOKEN=…</code> to <code>.env.local</code> and restart the app. The token stays on this machine.</li>
				</ol>
			</section>
		{/if}

		<section class="grid gap-2">
			<p class="cap">Connect a series</p>
			<div class="flex gap-2">
				<input class="field grow" bind:value={root} placeholder="The series root page link, e.g. https://www.notion.so/…" aria-label="Series root page link" onkeydown={(event) => { if (event.key === 'Enter' && root.trim()) void connect(); }} />
				<button type="button" class="key accent" onclick={() => void connect()} disabled={!root.trim() || !!busy || configured === false}>{busy === 'connect' ? 'Reading Notion…' : 'Connect'}</button>
			</div>
			{#if note}<p class="text-[12px] text-nr-accent" role="status">{note}</p>{/if}
			{#if error}<p class="text-[12px] text-nr-danger-text" role="alert">{error}</p>{/if}
		</section>

		{#each series as s (s.series_id)}
			<section class="grid gap-4">
				<div class="flex flex-wrap items-baseline gap-3">
					<h2 class="text-[17px] font-semibold text-nr-ink">{s.title}</h2>
					<a class="text-[11px] text-nr-dim" href={notionUrl(s.notion_root_id)} target="_blank" rel="noreferrer">open in Notion ↗</a>
					<span class="grow"></span>
					<span class="text-[11px] text-nr-faint">checked {new Date(s.checked_at).toLocaleString()}</span>
					<button type="button" class="key" onclick={() => refresh(s.series_id)} disabled={!!busy}>{busy === `refresh:${s.series_id}` ? 'Re-checking…' : 'Re-check'}</button>
				</div>

				<!-- The template check: the three databases and their required properties -->
				<div class="chips">
					{#each [['Episodes', s.checks.episodes, s.databases?.episodes], ['Scenes', s.checks.scenes, s.databases?.scenes], ['Shots', s.checks.shots, s.databases?.shots]] as const as [name, check, databaseId] (name)}
						{@const tip = [...check.missing, ...check.wrongType].join('\n') || (check.optionalMissing.length ? `Optional, not found: ${check.optionalMissing.join(', ')}` : 'Matches the template')}
						{#if databaseId}
							<a class={['chip', check.ok ? 'ok' : 'bad']} href={notionUrl(databaseId)} target="_blank" rel="noreferrer" title={`${tip}\nOpen the ${name} database in Notion`}>{check.ok ? '✓' : '✗'} {name} ↗</a>
						{:else}
							<span class={['chip', check.ok ? 'ok' : 'bad']} title={tip}>{check.ok ? '✓' : '✗'} {name}</span>
						{/if}
					{/each}
					{#if s.story}
						<a class="chip ok" href={notionUrl(s.story.page_id)} target="_blank" rel="noreferrer" title={`Open “${s.story.title}” in Notion`}>✓ Story ↗</a>
					{:else}
						<span class="chip bad">✗ Story</span>
					{/if}
				</div>
				{#if !allOk(s)}
					<ul class="grid gap-0.5 text-[12px] text-nr-danger-text">
						{#each [...s.checks.episodes.missing, ...s.checks.episodes.wrongType, ...s.checks.scenes.missing, ...s.checks.scenes.wrongType, ...s.checks.shots.missing, ...s.checks.shots.wrongType] as item (item)}<li>Missing or wrong: {item}</li>{/each}
					</ul>
				{/if}

				{#if s.story}
					<div class="min-w-0">
						<button type="button" class="link" onclick={() => (storyOpen = storyOpen === s.series_id ? null : s.series_id)} title={s.story.title}>{storyOpen === s.series_id ? 'Hide' : 'Read'} the season story · {s.story.title}</button>
						{#if storyOpen === s.series_id}<pre class="story">{s.story.text}</pre>{/if}
					</div>
				{/if}

				<!-- Episode length to plan for -->
				<div class="length">
					<span class="cap">Episode length</span>
					{#each [10, 15, 30] as minutes (minutes)}
						<button type="button" class={['key', s.runtime_min === minutes && 'accent']} aria-pressed={s.runtime_min === minutes} onclick={() => setRuntime(s.series_id, minutes)} disabled={!!busy}>{minutes} min</button>
					{/each}
					<span class="hint" title={`About ${s.runtime_min * 12} shots of 5 s per episode`}>≈ {s.runtime_min * 12} shots</span>
				</div>

				<!-- Episodes -->
				<div class="episodes">
					<div class="episode-head" aria-hidden="true"><span></span><span>Episode</span><span>Act</span><span>Status</span><span>Scenes</span><span></span></div>
					{#each s.episodes as episode (episode.page_id)}
						{@const project = s.episode_projects[episode.page_id]}
						<div class="episode">
							<span class="num">{String(episode.number).padStart(2, '0')}</span>
							<div class="min-w-0">
								<p class="text-[13px] text-nr-ink">{episode.title} <a class="notion" href={notionUrl(episode.page_id)} target="_blank" rel="noreferrer" title="Open this episode in Notion" aria-label={`Open ${episode.title} in Notion`}>↗</a></p>
								<p class="line-clamp-2 text-[11.5px] leading-5 text-nr-muted">{episode.summary}</p>
								<p class="meta-line">{[episode.act, episode.status, `${episode.scene_count} scene${episode.scene_count === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</p>
							</div>
							<span class="meta">{episode.act || '—'}</span>
							<span class="meta">{episode.status || '—'}</span>
							<span class="meta">{episode.scene_count} scene{episode.scene_count === 1 ? '' : 's'}</span>
							<span class="action">
								{#if project}
									<a class="key" href={`/?project=${project}&tab=story`}>Open</a>
								{:else}
									<button type="button" class={['key', episode.scene_count && 'accent']} onclick={() => void importEpisode(s.series_id, episode.page_id)} disabled={!!busy || !allOk(s) || episode.scene_count === 0} title={episode.scene_count === 0 ? 'No scenes in Notion yet: an outline only' : 'Import this episode as its own project'}>{busy === `import:${episode.page_id}` ? 'Importing…' : 'Import'}</button>
								{/if}
							</span>
						</div>
					{/each}
				</div>
			</section>
		{/each}
	</div>
</div>

<style>
	.cap { color: var(--color-nr-dim); font: 600 10px var(--font-sans); letter-spacing: 0.16em; text-transform: uppercase; }
	.cap.accent { color: var(--color-nr-accent); }
	.panel { border: 1px solid var(--color-nr-line); border-radius: 2px; padding: 12px 14px; }
	.steps { margin-top: 8px; display: grid; gap: 6px; padding-left: 18px; list-style: decimal; color: var(--color-nr-text); font-size: 12.5px; line-height: 1.6; }
	.steps a { color: var(--color-nr-accent); }
	.steps code { font-family: var(--font-mono); font-size: 11.5px; }
	.field { border: 1px solid var(--color-nr-line); border-radius: 2px; background: var(--color-nr-deep); padding: 6px 9px; color: var(--color-nr-ink); font: 12.5px var(--font-sans); outline: none; }
	.field:focus { border-color: color-mix(in srgb, var(--color-nr-accent) 50%, transparent); }
	.key { display: inline-flex; align-items: center; border: 1px solid var(--color-nr-line); border-radius: 2px; background: transparent; padding: 0 10px; color: var(--color-nr-muted); font: 600 9px/24px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; white-space: nowrap; transition: border-color 140ms ease, color 140ms ease; }
	.key:hover:not(:disabled) { border-color: color-mix(in srgb, var(--color-nr-accent) 55%, transparent); color: var(--color-nr-ink); }
	.key.accent { border-color: color-mix(in srgb, var(--color-nr-accent) 45%, transparent); color: var(--color-nr-accent); }
	.key:disabled { opacity: 0.4; }
	.chip { border: 1px solid var(--color-nr-line); border-radius: 2px; padding: 0 7px; font: 600 9px/18px var(--font-sans); letter-spacing: 0.1em; text-transform: uppercase; }
	.chip.ok { border-color: color-mix(in srgb, var(--color-nr-accent) 40%, transparent); color: var(--color-nr-accent); }
	.chip.bad { border-color: var(--color-nr-danger-line); color: var(--color-nr-danger-text); }
	/* Each of these rows stays on one line; on a phone they get smaller rather than wrap. */
	.chips { display: flex; flex-wrap: nowrap; gap: 8px; overflow-x: auto; scrollbar-width: none; }
	.chip { flex: none; white-space: nowrap; }
	a.chip { text-decoration: none; transition: border-color 140ms ease, color 140ms ease; }
	a.chip.ok:hover { border-color: color-mix(in srgb, var(--color-nr-accent) 70%, transparent); color: var(--color-nr-ink); }
	.length { display: flex; flex-wrap: nowrap; align-items: center; gap: 8px; white-space: nowrap; }
	.length .hint { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--color-nr-faint); font-size: 11px; }
	.notion { margin-left: 2px; color: var(--color-nr-dim); font-size: 11px; text-decoration: none; }
	.notion:hover { color: var(--color-nr-accent); }
	.link { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
	@media (max-width: 640px) {
		.chips { gap: 5px; }
		.chip { padding: 0 5px; font-size: 8.5px; letter-spacing: 0.06em; }
		.length { gap: 5px; }
		.length .cap { font-size: 9px; letter-spacing: 0.1em; }
		.length .key { padding: 0 7px; }
		.link { font-size: 11.5px; }
	}
	.link { border: 0; background: transparent; padding: 0; color: var(--color-nr-accent); font-size: 12px; text-decoration: underline; text-underline-offset: 2px; }
	.story { margin-top: 6px; max-height: 420px; overflow: auto; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; background: var(--color-nr-deep); padding: 10px 12px; color: var(--color-nr-text); font: 12px/1.6 var(--font-sans); white-space: pre-wrap; }
	.episodes { display: grid; gap: 4px; }
	/* One grid for the header and every row, so Act / Status / Scenes / the button line up whatever the button says. */
	.episode, .episode-head { display: grid; grid-template-columns: 22px minmax(0, 1fr) 76px 76px 72px 92px; align-items: center; column-gap: 12px; padding: 8px 10px; }
	.episode { border: 1px solid var(--color-nr-line-soft); border-radius: 2px; }
	.episode-head { padding-block: 0 2px; color: var(--color-nr-faint); font: 600 9px var(--font-sans); letter-spacing: 0.14em; text-transform: uppercase; }
	.num { color: var(--color-nr-accent); font: 500 12px var(--font-mono); }
	.meta { color: var(--color-nr-dim); font-size: 11px; }
	.action { display: flex; justify-content: flex-end; }
	/* Only on narrow screens: Act · Status · Scenes as one line under the summary. */
	.meta-line { display: none; margin-top: 4px; color: var(--color-nr-dim); font-size: 10.5px; letter-spacing: 0.04em; }
	@media (max-width: 640px) {
		.episode, .episode-head { grid-template-columns: 18px minmax(0, 1fr) auto; column-gap: 10px; }
		.episode { align-items: start; padding: 10px; }
		.episode .num { padding-top: 2px; }
		.episode .action { padding-top: 0; }
		.episode .meta, .episode-head { display: none; }
		.meta-line { display: block; }
	}
</style>
