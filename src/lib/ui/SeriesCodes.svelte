<script lang="ts">
	import type { SeriesRecord } from '$lib/server/series';
	import type { Project } from '$lib/domain/schemas';
	import { CODE_LEGEND, CODE_PATTERN, codeProblems, episodeCode, formatShotCode, sceneOrder, suggestCode } from '$lib/domain/shot-codes';
	import { actRank } from '$lib/domain/notion-series';

	/**
	 * Shot codes for one series (V1S-274): the show code, each imported episode's scene codes, and the lock.
	 * Codes are editable until locked; locking is for good (it happens on its own when the first take is sent).
	 */
	let { series, busy = false, onchange }: { series: SeriesRecord; busy?: boolean; onchange: (record: SeriesRecord) => void } = $props();

	let show = $state('');
	let open = $state(false);
	let legend = $state(false);
	let error = $state<string | null>(null);
	let saving = $state<string | null>(null);
	let episodes = $state<Record<string, Project>>({});
	let drafts = $state<Record<string, Record<string, string>>>({});
	// A series connected before shot codes has none yet: offer the suggestion, saved on Save.
	$effect(() => { show = series.show_code ?? suggestCode(series.title); });

	const locked = $derived(!!series.codes_locked_at);
	const imported = $derived(series.episodes.filter((episode) => series.episode_projects[episode.page_id]));

	async function post(payload: Record<string, unknown>, label: string) {
		saving = label; error = null;
		try {
			const response = await fetch(`/api/series/${series.series_id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
			const body = await response.json();
			if (!body.ok) throw new Error(body.error?.message ?? 'Saving failed');
			onchange(body.data as SeriesRecord);
			return body as { data: SeriesRecord; project?: Project };
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Saving failed'; return null; }
		finally { saving = null; }
	}

	async function loadEpisodes() {
		const loaded: Record<string, Project> = {};
		for (const episode of imported) {
			const response = await fetch(`/api/projects/${series.episode_projects[episode.page_id]}`);
			if (response.ok) loaded[episode.page_id] = ((await response.json()) as { project: Project }).project;
		}
		episodes = loaded;
	}
	$effect(() => { if (open) void loadEpisodes(); });

	const saveShow = () => void post({ action: 'show_code', show_code: show.trim().toUpperCase() }, 'show');
	async function saveEpisode(pageId: string) {
		const project = episodes[pageId];
		const edits = Object.fromEntries(Object.entries(drafts[pageId] ?? {}).map(([group, code]) => [group, code.trim().toUpperCase()]).filter(([, code]) => code));
		const done = await post({ action: 'episode_codes', project_id: project.project_id, expected_version: project.version, scene_codes: edits }, `episode:${pageId}`);
		if (done?.project) { episodes = { ...episodes, [pageId]: done.project }; drafts = { ...drafts, [pageId]: {} }; }
	}
	let confirming = $state(false);
	async function lock() {
		confirming = false;
		await post({ action: 'lock_codes' }, 'lock');
	}

	const scenesOf = (project: Project) => (project.series?.scenes ?? []).toSorted((a, b) => actRank(a.act) - actRank(b.act) || a.number - b.number);
	const codeFor = (pageId: string, groupId: string, current?: string) => drafts[pageId]?.[groupId] ?? current ?? '';
	function setDraft(pageId: string, groupId: string, value: string) {
		drafts = { ...drafts, [pageId]: { ...(drafts[pageId] ?? {}), [groupId]: value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) } };
	}
	function shotRange(project: Project, groupId: string, scene: string) {
		const numbers = project.production.cards.filter((card) => card.group_id === groupId && card.shot_number).map((card) => card.shot_number!).sort((a, b) => a - b);
		if (!numbers.length || !series.show_code || !CODE_PATTERN.test(scene)) return '';
		const ep = episodeCode(project.series?.season ?? null, project.series?.episode_number ?? 0);
		const first = formatShotCode({ show: series.show_code, episode: ep, scene, shot: numbers[0] });
		return numbers.length === 1 ? first : `${first} … ${String(numbers.at(-1)).padStart(4, '0')} · ${numbers.length} shots`;
	}
	function problems(project: Project, pageId: string) {
		const scenes = scenesOf(project).map((scene) => ({ title: scene.title, code: codeFor(pageId, scene.group_id, scene.code) || null }));
		return codeProblems(series.show_code ?? null, scenes).filter((problem) => !/has no scene code/.test(problem));
	}
</script>

<div class="codes">
	<div class="row">
		<span class="cap">Shot codes</span>
		<input class="code" value={show} maxlength="3" aria-label="Show code" disabled={locked || busy || !!saving}
			oninput={(event) => (show = event.currentTarget.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))}
			onkeydown={(event) => { if (event.key === 'Enter' && show.length === 3) saveShow(); }} />
		{#if !locked && show !== (series.show_code ?? '')}
			<button type="button" class="key accent" onclick={saveShow} disabled={show.length !== 3 || !!saving}>{saving === 'show' ? 'Saving…' : 'Save'}</button>
		{/if}
		<span class={['state', locked && 'locked']}>{locked ? `Locked ${new Date(series.codes_locked_at!).toLocaleDateString()}` : 'Editable until the first take is sent'}</span>
		<span class="grow"></span>
		<button type="button" class="link" onclick={() => (legend = !legend)} aria-expanded={legend}>Legend</button>
		<button type="button" class="key" onclick={() => (open = !open)} aria-expanded={open} disabled={imported.length === 0} title={imported.length ? 'Scene codes of the imported episodes' : 'Import an episode first'}>{open ? 'Hide scenes' : 'Scene codes'}</button>
		{#if !locked && !confirming}<button type="button" class="key" onclick={() => (confirming = true)} disabled={!series.show_code || !!saving}>{saving === 'lock' ? 'Locking…' : 'Lock'}</button>{/if}
	</div>
	{#if confirming}
		<div class="row confirm" role="alertdialog" aria-label="Lock the codes">
			<span>Lock the codes for {series.title}? The show code and every scene code stay as they are for good.</span>
			<button type="button" class="key accent" onclick={() => void lock()}>Lock for good</button>
			<button type="button" class="key" onclick={() => (confirming = false)}>Cancel</button>
		</div>
	{/if}

	{#if legend}
		<dl class="legend">
			<p class="example">{series.show_code ?? 'BLR'}_EP101_PAR_0020_v003</p>
			{#each CODE_LEGEND as item (item.part)}<div><dt>{item.part}</dt><dd>{item.means}</dd></div>{/each}
		</dl>
	{/if}

	{#if open}
		{#each imported as episode (episode.page_id)}
			{@const project = episodes[episode.page_id]}
			<div class="episode">
				<p class="title"><span class="ep">{episodeCode(project?.series?.season ?? episode.season, episode.number)}</span> {episode.title}</p>
				{#if !project}
					<p class="hint">Loading…</p>
				{:else}
					{@const rows = scenesOf(project)}
					{@const issues = problems(project, episode.page_id)}
					{@const missing = rows.some((scene) => !scene.code) || project.production.cards.some((card) => card.group_id && rows.some((s) => s.group_id === card.group_id) && !card.shot_number)}
					<div class="scenes">
						{#each rows as scene, i (scene.group_id)}
							<div class="scene">
								<span class="order">{sceneOrder(i)}</span>
								<input class="code" value={codeFor(episode.page_id, scene.group_id, scene.code)} maxlength="3" aria-label={`Scene code for ${scene.title}`} placeholder="—"
									disabled={locked || !!saving} oninput={(event) => setDraft(episode.page_id, scene.group_id, event.currentTarget.value)} />
								<span class="name" title={scene.title}>{scene.title}</span>
								<span class="range">{shotRange(project, scene.group_id, codeFor(episode.page_id, scene.group_id, scene.code))}</span>
							</div>
						{/each}
					</div>
					{#if issues.length}<ul class="issues">{#each issues as issue (issue)}<li>{issue}</li>{/each}</ul>{/if}
					{#if !locked && (missing || Object.keys(drafts[episode.page_id] ?? {}).length)}
						<button type="button" class="key accent" onclick={() => void saveEpisode(episode.page_id)} disabled={!!saving || issues.length > 0}>
							{saving === `episode:${episode.page_id}` ? 'Saving…' : missing ? 'Assign missing codes' : 'Save scene codes'}
						</button>
					{/if}
				{/if}
			</div>
		{/each}
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
	.codes { display: grid; gap: 10px; }
	.row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
	.grow { flex: 1; }
	.cap { color: var(--color-nr-dim); font: 600 10px var(--font-sans); letter-spacing: 0.16em; text-transform: uppercase; }
	.code { width: 52px; border: 1px solid var(--color-nr-line); border-radius: 2px; background: var(--color-nr-deep); padding: 3px 6px; color: var(--color-nr-ink); font: 500 12px var(--font-mono); letter-spacing: 0.12em; text-align: center; outline: none; }
	.code:focus { border-color: color-mix(in srgb, var(--color-nr-accent) 50%, transparent); }
	.code:disabled { color: var(--color-nr-muted); opacity: 0.8; }
	.state { color: var(--color-nr-faint); font-size: 11px; }
	.confirm { border: 1px solid color-mix(in srgb, var(--color-nr-accent) 35%, transparent); border-radius: 2px; padding: 8px 10px; color: var(--color-nr-text); font-size: 12px; }
	.state.locked { color: var(--color-nr-accent); }
	.key { display: inline-flex; align-items: center; border: 1px solid var(--color-nr-line); border-radius: 2px; background: transparent; padding: 0 10px; color: var(--color-nr-muted); font: 600 9px/24px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; white-space: nowrap; transition: border-color 140ms ease, color 140ms ease; }
	.key:hover:not(:disabled) { border-color: color-mix(in srgb, var(--color-nr-accent) 55%, transparent); color: var(--color-nr-ink); }
	.key.accent { border-color: color-mix(in srgb, var(--color-nr-accent) 45%, transparent); color: var(--color-nr-accent); }
	.key:disabled { opacity: 0.4; }
	.link { border: 0; background: transparent; padding: 0; color: var(--color-nr-accent); font-size: 11.5px; text-decoration: underline; text-underline-offset: 2px; }
	.legend { display: grid; gap: 4px; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; padding: 10px 12px; font-size: 11.5px; }
	.legend .example { color: var(--color-nr-ink); font: 500 13px var(--font-mono); letter-spacing: 0.04em; margin-bottom: 4px; }
	.legend div { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 10px; }
	.legend dt { color: var(--color-nr-accent); font-family: var(--font-mono); }
	.legend dd { color: var(--color-nr-muted); }
	.episode { display: grid; gap: 6px; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; padding: 10px 12px; justify-items: start; }
	.title { color: var(--color-nr-ink); font-size: 12.5px; }
	.ep { color: var(--color-nr-accent); font: 500 11.5px var(--font-mono); margin-right: 6px; }
	.scenes { display: grid; gap: 3px; width: 100%; }
	.scene { display: grid; grid-template-columns: 30px 52px minmax(0, 1fr) minmax(0, auto); align-items: center; column-gap: 10px; }
	.order { color: var(--color-nr-faint); font: 500 11px var(--font-mono); }
	.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-nr-text); font-size: 12px; }
	.range { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-nr-dim); font: 11px var(--font-mono); }
	.hint { color: var(--color-nr-faint); font-size: 11px; }
	.issues, .error { color: var(--color-nr-danger-text); font-size: 11.5px; }
	@media (max-width: 640px) {
		.legend div { grid-template-columns: 90px minmax(0, 1fr); }
		.scene { grid-template-columns: 26px 46px minmax(0, 1fr); }
		.range { grid-column: 3; }
	}
</style>
