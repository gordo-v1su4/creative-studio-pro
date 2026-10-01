<script lang="ts">
	import { onMount } from 'svelte';

	/** Settings → Video generation: the Higgsfield CLI that Animate and Finalize run through. */
	type Status = { cli: string | null; installed: boolean; logged_in: boolean; balance: { credits: number; plan: string | null } | null };
	let status = $state<Status | null>(null);
	let error = $state<string | null>(null);

	async function refresh() {
		error = null;
		try {
			const result = (await (await fetch('/api/settings/generation')).json()) as { ok: true; data: Status } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			status = result.data;
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Failed to load'; }
	}

	onMount(() => void refresh());
</script>

<div class="meta-label mt-8">Video generation</div>
<div class="mt-2 rounded-sm border border-border-default bg-surface-raised p-3">
	<div class="flex items-center gap-2">
		<b>Higgsfield</b>
		<span class="meta-label" class:text-gate-approved={status?.logged_in} class:text-gate-pending={status && !status.logged_in}>
			{status === null ? '…' : !status.installed ? 'CLI not found' : !status.logged_in ? 'not logged in' : `${status.balance?.credits} credits · ${status.balance?.plan ?? 'plan'}`}
		</span>
		<span class="grow"></span>
		<button type="button" class="btn" onclick={() => void refresh()}>Recheck</button>
	</div>
	<p class="mt-1 text-text-muted">
		Animate and Finalize run Seedance through the Higgsfield CLI on your higgsfield.ai account — plan credits and draft mode (480p drafts you can finalize to 1080p from the same render for seven days), the same account the Higgsfield connector uses.
	</p>
	{#if status && !status.installed}
		<p class="mt-1 text-gate-pending">Install it with <code>bun add -g @higgsfield/cli</code> (or npm), then run <code>higgsfield auth login</code>. Set HIGGSFIELD_CLI to point at a different binary.</p>
	{:else if status && !status.logged_in}
		<p class="mt-1 text-gate-pending">Found at <code>{status.cli}</code>, but it isn't logged in: run <code>higgsfield auth login</code>.</p>
	{/if}
	{#if error}<p class="mt-1 text-gate-failed">{error}</p>{/if}
</div>
