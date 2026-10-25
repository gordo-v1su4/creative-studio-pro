<script lang="ts">
	import type { StillApproval } from '$lib/domain/stills';

	/**
	 * The approval step for one still (V1S-373): the exact prompt, the references in the order they attach (each
	 * with its exact name), the model and resolution, and the predicted credits with the episode's running total.
	 * Nothing is sent until Approve; any QC or gate finding disables it.
	 */
	let { title, approval, busy = false, busyLabel = 'Sending…', onapprove }: {
		title: string; approval: StillApproval; busy?: boolean; busyLabel?: string; onapprove: (approval: StillApproval) => void;
	} = $props();
	let showPrompt = $state(false);
	const blocked = $derived(approval.blocked.length > 0 || approval.credits === null);
</script>

<div class={['approval', blocked && 'bad']} aria-label={`Approve ${title}`}>
	<div class="head">
		<b>{title}</b>
		<span class="mono">{approval.model} · {approval.resolution} · {approval.aspect_ratio}</span>
		<span class="mono cost">{approval.credits ?? '—'} cr · episode {approval.episode_spent} → {approval.episode_after} cr</span>
	</div>
	{#if approval.references.length}
		<ol class="refs" aria-label="References in attach order">
			{#each approval.references as ref (ref.order)}
				<li>
					{#if ref.url}<img src={ref.url} alt={ref.name} loading="lazy" />{:else}<span class="noimg" aria-hidden="true"></span>{/if}
					<span class="n">image {ref.order}</span>
					<span class="name" title={ref.name}>{ref.name}</span>
				</li>
			{/each}
		</ol>
	{:else}
		<p class="none">No references attached.</p>
	{/if}
	<button type="button" class="link" onclick={() => (showPrompt = !showPrompt)} aria-expanded={showPrompt}>{showPrompt ? 'Hide prompt' : 'Show the exact prompt'}</button>
	{#if showPrompt}<pre class="prompt">{approval.prompt}</pre>{/if}
	{#each approval.blocked as reason, r (r)}<p class="reason">{reason}</p>{/each}
	<div>
		<button type="button" class="key on" disabled={busy || blocked} onclick={() => onapprove(approval)}>
			{busy ? busyLabel : blocked ? 'Blocked' : `Approve · ${approval.credits} cr`}
		</button>
	</div>
</div>

<style>
	.approval { display: grid; gap: 8px; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; padding: 8px 10px; }
	.approval.bad { border-color: var(--color-nr-danger-line); }
	.head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; font-size: 11.5px; color: var(--color-nr-text); }
	.head b { font-weight: 600; }
	.mono { color: var(--color-nr-muted); font: 11px var(--font-mono); }
	.cost { color: var(--color-nr-text); }
	.refs { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
	.refs li { display: grid; width: 96px; gap: 2px; }
	.refs img, .noimg { width: 96px; height: 72px; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; object-fit: contain; background: var(--color-nr-deep); }
	.n { color: #4ab8ff; font: 600 9px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; }
	.name { overflow: hidden; color: var(--color-nr-text); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
	.none { color: var(--color-nr-muted); font-size: 11.5px; }
	.link { justify-self: start; border: 0; background: transparent; padding: 0; color: var(--color-nr-muted); font-size: 11px; text-decoration: underline; text-underline-offset: 3px; }
	.link:hover { color: var(--color-nr-ink); }
	.prompt { max-height: 220px; overflow: auto; margin: 0; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; background: var(--color-nr-deep); padding: 8px; color: var(--color-nr-text); font: 11px/1.55 var(--font-mono); white-space: pre-wrap; }
	.reason { color: var(--color-nr-danger-text); font-size: 11px; }
	.key { display: inline-flex; align-items: center; border: 1px solid var(--color-nr-line); border-radius: 2px; background: transparent; padding: 0 10px; color: var(--color-nr-muted); font: 600 9px/24px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; transition: border-color 140ms ease, color 140ms ease; }
	.key:hover:not(:disabled) { border-color: color-mix(in srgb, var(--color-nr-accent) 55%, transparent); color: var(--color-nr-ink); }
	.key.on { border-color: color-mix(in srgb, var(--color-nr-accent) 45%, transparent); color: var(--color-nr-accent); }
	.key:disabled { opacity: 0.5; }
</style>
