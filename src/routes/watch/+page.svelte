<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Watch — Creative Studio Pro</title>
	<meta name="description" content="Published work from Creative Studio Pro: episodes, boards and cuts." />
</svelte:head>

<div class="mx-auto grid max-w-[1100px] gap-6 px-4 py-8 sm:px-6">
	<header>
		<p class="cap">Watch</p>
		<h1 class="mt-1 text-[20px] font-semibold text-nr-ink">Published work</h1>
		<p class="mt-1 max-w-[640px] text-[12.5px] leading-6 text-nr-muted">Episodes, boards and cuts from the studio, as they stand. Read-only.</p>
	</header>

	{#if data.entries.length === 0}
		<p class="empty">Nothing published yet.</p>
	{:else}
		<ul class="cards">
			{#each data.entries as entry (entry.slug)}
				<li>
					<a class="card" href={`/watch/${entry.slug}`}>
						<span class="poster">{#if entry.poster}<img src={entry.poster} alt="" loading="lazy" />{/if}</span>
						<span class="body">
							{#if entry.episode}<span class="chip">{entry.episode}</span>{/if}
							<span class="title">{entry.title}</span>
							{#if entry.logline}<span class="logline">{entry.logline}</span>{/if}
							<span class="meta">{entry.beats} beats{entry.cuts ? ` · ${entry.cuts} cut${entry.cuts === 1 ? '' : 's'}` : ''} · {new Date(entry.published_at).toLocaleDateString()}</span>
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.cap { color: var(--color-nr-accent); font: 600 10px var(--font-sans); letter-spacing: 0.16em; text-transform: uppercase; }
	.empty { border: 1px dashed var(--color-nr-line); border-radius: 2px; padding: 24px; color: var(--color-nr-dim); font-size: 12.5px; text-align: center; }
	.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
	.card { display: grid; height: 100%; overflow: hidden; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; background: var(--color-nr-card); text-decoration: none; transition: border-color 140ms ease; }
	.card:hover { border-color: color-mix(in srgb, var(--color-nr-accent) 45%, transparent); }
	.poster { display: block; aspect-ratio: 16 / 9; background: var(--color-nr-deep); }
	.poster img { width: 100%; height: 100%; object-fit: cover; }
	.body { display: grid; gap: 4px; padding: 10px 12px 12px; }
	.chip { justify-self: start; border: 1px solid color-mix(in srgb, var(--color-nr-accent) 40%, transparent); border-radius: 2px; padding: 0 6px; color: var(--color-nr-accent); font: 600 9px/16px var(--font-sans); letter-spacing: 0.1em; }
	.title { color: var(--color-nr-mark); font-size: 14px; font-weight: 600; }
	.logline { display: -webkit-box; overflow: hidden; color: var(--color-nr-muted); font-size: 12px; line-height: 1.5; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; }
	.meta { color: var(--color-nr-dim); font: 10.5px var(--font-mono); }
</style>
