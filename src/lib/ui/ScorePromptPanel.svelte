<script lang="ts">
	/**
	 * Score prompt (V1S-378, parked): GhostSuno's three Suno fields for a cut, in copy boxes. Suno has no API, so
	 * the operator pastes them; nothing is sent.
	 */
	let { projectId, cutId, cutName, onclose }: { projectId: string; cutId: string; cutName: string; onclose: () => void } = $props();
	type Score = { cue: string; styles: string; lyrics: string; exclude: string; advice: string };
	let score = $state<Score | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);
	let copied = $state<string | null>(null);

	async function write() {
		busy = true; error = null;
		try {
			const body = await (await fetch(`/api/projects/${projectId}/score`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cut_id: cutId }) })).json();
			if (!body.ok) throw new Error(body.error?.message ?? 'No score prompt');
			score = body.data as Score;
		} catch (cause) { error = cause instanceof Error ? cause.message : 'No score prompt'; }
		finally { busy = false; }
	}
	$effect(() => { void cutId; void write(); });
	async function copy(label: string, text: string) {
		try { await navigator.clipboard.writeText(text); copied = label; setTimeout(() => (copied = null), 1500); } catch { copied = null; }
	}
</script>

<div class="score" aria-label={`Score prompt for ${cutName}`}>
	<div class="head"><span class="cap">Score prompt · {cutName}</span><span class="grow"></span><button type="button" class="key" onclick={onclose}>Close</button></div>
	{#if busy}<p class="muted">GhostSuno is writing…</p>{/if}
	{#if error}<p class="reason">{error}</p>{/if}
	{#if score}
		<p class="cue">{score.cue}</p>
		{#each [['Styles', score.styles], ['Lyrics', score.lyrics], ['Exclude Styles', score.exclude]] as [label, text] (label)}
			<div class="box">
				<div class="head"><span class="cap">{label}</span><span class="grow"></span><button type="button" class="key" onclick={() => void copy(label, text)}>{copied === label ? 'Copied' : 'Copy'}</button></div>
				<pre>{text}</pre>
			</div>
		{/each}
		{#if score.advice}<p class="muted">{score.advice}</p>{/if}
		<div><button type="button" class="key" disabled={busy} onclick={() => void write()}>Write again</button></div>
	{/if}
</div>

<style>
	.score { display: grid; gap: 8px; margin-bottom: 16px; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; padding: 10px; }
	.head { display: flex; align-items: center; gap: 8px; }
	.grow { flex: 1; }
	.cap { color: var(--color-nr-dim); font: 600 9px var(--font-sans); letter-spacing: 0.14em; text-transform: uppercase; }
	.cue { color: var(--color-nr-ink); font-size: 12.5px; }
	.box { display: grid; gap: 4px; }
	pre { margin: 0; max-height: 240px; overflow: auto; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; background: #0b0d11; padding: 8px; color: var(--color-nr-text); font: 11px/1.55 var(--font-mono); white-space: pre-wrap; }
	.muted { color: var(--color-nr-muted); font-size: 11.5px; }
	.reason { color: var(--color-nr-danger-text); font-size: 11.5px; }
	.key { display: inline-flex; align-items: center; border: 1px solid var(--color-nr-line); border-radius: 2px; background: transparent; padding: 0 10px; color: var(--color-nr-muted); font: 600 9px/24px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; transition: border-color 140ms ease, color 140ms ease; }
	.key:hover:not(:disabled) { border-color: color-mix(in srgb, var(--color-nr-accent) 55%, transparent); color: var(--color-nr-ink); }
	.key:disabled { opacity: 0.5; }
</style>
