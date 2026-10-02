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
				<div class="flex flex-wrap gap-2">
					{#each [['Episodes', s.checks.episodes], ['Scenes', s.checks.scenes], ['Shots', s.checks.shots]] as const as [name, check] (name)}
						<span class={['chip', check.ok ? 'ok' : 'bad']} title={[...check.missing, ...check.wrongType].join('\n') || (check.optionalMissing.length ? `Optional, not found: ${check.optionalMissing.join(', ')}` : 'Matches the template')}>{check.ok ? '✓' : '✗'} {name}</span>
					{/each}
					<span class={['chip', s.story ? 'ok' : 'bad']}>{s.story ? '✓' : '✗'} Story page</span>
				</div>
				{#if !allOk(s)}
					<ul class="grid gap-0.5 text-[12px] text-nr-danger-text">
						{#each [...s.checks.episodes.missing, ...s.checks.episodes.wrongType, ...s.checks.scenes.missing, ...s.checks.scenes.wrongType, ...s.checks.shots.missing, ...s.checks.shots.wrongType] as item (item)}<li>Missing or wrong: {item}</li>{/each}
					</ul>
				{/if}

				{#if s.story}
					<div>
						<button type="button" class="link" onclick={() => (storyOpen = storyOpen === s.series_id ? null : s.series_id)}>{storyOpen === s.series_id ? 'Hide' : 'Read'} the season story · {s.story.title}</button>
						{#if storyOpen === s.series_id}<pre class="story">{s.story.text}</pre>{/if}
					</div>
				{/if}

				<!-- Episode length to plan for -->
				<div class="flex flex-wrap items-center gap-2">
					<span class="cap">Episode length</span>
					{#each [10, 15, 30] as minutes (minutes)}
						<button type="button" class={['key', s.runtime_min === minutes && 'accent']} aria-pressed={s.runtime_min === minutes} onclick={() => setRuntime(s.series_id, minutes)} disabled={!!busy}>{minutes} min</button>
					{/each}
					<span class="text-[11px] text-nr-faint">≈ {s.runtime_min * 12} shots of 5 s per episode</span>
				</div>

				<!-- Episodes -->
				<div class="episodes">
					{#each s.episodes as episode (episode.page_id)}
						{@const project = s.episode_projects[episode.page_id]}
						<div class="episode">
							<span class="num">{String(episode.number).padStart(2, '0')}</span>
							<div class="min-w-0 grow">
								<p class="text-[13px] text-nr-ink">{episode.title}</p>
								<p class="line-clamp-2 text-[11.5px] leading-5 text-nr-muted">{episode.summary}</p>
							</div>
							<span class="meta">{episode.act || '—'}</span>
							<span class="meta">{episode.status || '—'}</span>
							<span class="meta">{episode.scene_count} scenes</span>
							{#if project}
								<a class="key" href={`/?project=${project}&tab=story`}>Open</a>
							{:else}
								<button type="button" class={['key', episode.scene_count && 'accent']} onclick={() => void importEpisode(s.series_id, episode.page_id)} disabled={!!busy || !allOk(s) || episode.scene_count === 0} title={episode.scene_count === 0 ? 'No scenes in Notion yet: an outline only' : 'Import this episode as its own project'}>{busy === `import:${episode.page_id}` ? 'Importing…' : 'Import'}</button>
							{/if}
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
	.link { border: 0; background: transparent; padding: 0; color: var(--color-nr-accent); font-size: 12px; text-decoration: underline; text-underline-offset: 2px; }
	.story { margin-top: 6px; max-height: 420px; overflow: auto; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; background: var(--color-nr-deep); padding: 10px 12px; color: var(--color-nr-text); font: 12px/1.6 var(--font-sans); white-space: pre-wrap; }
	.episodes { display: grid; gap: 4px; }
	.episode { display: flex; align-items: center; gap: 12px; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; padding: 8px 10px; }
	.num { flex: none; color: var(--color-nr-accent); font: 500 12px var(--font-mono); }
	.meta { flex: none; width: 76px; color: var(--color-nr-dim); font-size: 11px; }
</style>
