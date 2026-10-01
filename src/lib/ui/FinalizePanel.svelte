<script lang="ts">
	import { onMount } from 'svelte';
	import { timeLeft } from '$lib/domain/finalize';
	import type { Project } from '$lib/domain/schemas';
	import { clock } from '$lib/ui/clock.svelte';

	/**
	 * Finalize drafts to 1080p from the same render (CONTEXT.md: Finalize).
	 * Shows the quoted credits per take and in total; nothing is sent until an
	 * explicit "Finalize for N credits". The server re-quotes before any spend.
	 */
	let { project, takeIds, title, onUpdated, onclose, onsent }: {
		project: Project; takeIds: string[]; title: string; onUpdated: (project: Project) => void; onclose: () => void; onsent?: (message: string) => void;
	} = $props();

	type Quote = {
		items: Array<{ take_id: string; card_id: string; name: string; credits: number; closes_at: string }>;
		total_credits: number;
		balance: { credits: number; plan: string | null } | null;
	};

	let quote = $state<Quote | null>(null);
	let confirming = $state(false);
	let sending = $state(false);
	let error = $state<string | null>(null);
	let reasons = $state<string[]>([]);
	let short = $derived(!!quote?.balance && quote.balance.credits < quote.total_credits);
	const beat = (cardId: string) => project.production.cards.find((card) => card.card_id === cardId)?.title ?? cardId;

	async function post(body: Record<string, unknown>) {
		const response = await fetch(`/api/projects/${project.project_id}/finalize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		return (await response.json()) as { ok: true; data: unknown } | { ok: false; error: { message: string; reasons?: string[] } };
	}

	onMount(async () => {
		const result = await post({ action: 'quote', take_ids: takeIds });
		if (result.ok) quote = result.data as Quote;
		else error = result.error.message;
	});

	async function send() {
		if (!quote || sending) return;
		if (!confirming) { confirming = true; return; }
		sending = true; error = null; reasons = [];
		const result = await post({ action: 'send', take_ids: takeIds, expected_version: project.version, confirmed_credits: quote.total_credits });
		sending = false; confirming = false;
		if (!result.ok) { error = result.error.message; reasons = result.error.reasons ?? []; return; }
		onUpdated(result.data as Project);
		const count = quote.items.length;
		onsent?.(`Sent ${count === 1 ? quote.items[0].name : `${count} drafts`} to finalize at 1080p (${quote.total_credits} credits). Each take switches to 1080p when it lands; trims and ramps stay.`);
		onclose();
	}
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-[#050607]/90 p-4" role="dialog" aria-label="Finalize drafts to 1080p">
	<div class="panel">
		<header class="flex items-center gap-2">
			<span class="meta-label text-[#59d9cf]">FINALIZE · 1080P</span>
			<b class="min-w-0 grow truncate">{title}</b>
			<button type="button" class="ctl" onclick={onclose}>close</button>
		</header>
		<p class="mt-2 text-[12px] leading-5 text-[#789da7]">Re-renders each draft at 1080p from the same generation: same motion and timing, so trims and ramps carry over. The 480p file is kept.</p>
		{#if !quote}
			<p class="mt-4 text-[#789da7]">{error ?? 'Checking the price…'}</p>
		{:else}
			<ul class="mt-3 grid gap-1" aria-label="Drafts to finalize">
				{#each quote.items as item (item.take_id)}
					{@const msLeft = Date.parse(item.closes_at) - clock.now}
					<li class="row">
						<span class="min-w-0 grow truncate"><b>{beat(item.card_id)}</b> <span class="text-[#55747c]">· {item.name}</span></span>
						<span class={['font-mono text-[10px]', msLeft <= 48 * 3600_000 ? 'text-gate-failed' : 'text-gate-pending']}>{msLeft > 0 ? timeLeft(msLeft) : 'closed'}</span>
						<span class="w-[86px] text-right font-mono text-[11px] text-[#bce6e8]">{item.credits} credits</span>
					</li>
				{/each}
			</ul>
			<footer class="mt-4 flex flex-wrap items-center gap-3 border-t border-[#223039] pt-3">
				<span class="font-mono text-[11px] text-[#bce6e8]">Total {quote.total_credits} credits{#if quote.balance} · <span class={short ? 'text-gate-failed' : 'text-[#668d98]'}>{quote.balance.credits} left</span>{/if}</span>
				{#if short}<span class="text-[11px] text-gate-failed">Not enough credits; top up on higgsfield.ai first.</span>{/if}
				<span class="grow"></span>
				{#if confirming}<button type="button" class="ctl" onclick={() => (confirming = false)}>cancel</button>{/if}
				<button type="button" class="btn btn-accent" onclick={() => void send()} disabled={sending || short}>
					{sending ? 'Sending…' : confirming ? `Finalize for ${quote.total_credits} credits` : 'Finalize…'}
				</button>
			</footer>
			{#if error}<p class="mt-2 text-gate-failed" role="alert">{error}</p>{/if}
			{#if reasons.length}<ul class="mt-1 grid gap-0.5 text-[11px] text-gate-failed">{#each reasons as reason, i (i)}<li>· {reason}</li>{/each}</ul>{/if}
		{/if}
	</div>
</div>

<style>
	.panel { width: min(640px, 100%); max-height: 92vh; overflow: auto; border: 1px solid #26383f; background: #0d1116; padding: 14px; color: #a8cbd2; }
	.ctl { border: 1px solid #233034; background: #0f1517; padding: 2px 8px; color: #9fc9cf; }
	.row { display: flex; align-items: center; gap: 10px; border: 1px solid #1d2a30; background: #0a0d11; padding: 5px 8px; font-size: 12px; }
</style>
