<script lang="ts">
	import { onMount } from 'svelte';
	import { ANIMATE_MAX_S, ANIMATE_MIN_S, ANIMATE_RESOLUTIONS, type AnimateResolution } from '$lib/domain/animate';
	import { lintPrompt } from '$lib/domain/prompt-lint';
	import { MIN_LONG_EDGE } from '$lib/domain/media';
	import type { Project } from '$lib/domain/schemas';

	/**
	 * Animate a beat's still through Seedance. The Agent drafts the prompt; the
	 * operator edits it, picks length, resolution and audio, and sees the price.
	 * Confirm sends after an explicit "Send for $X"; YOLO skips only that step
	 * and stops at the session cap. The server re-runs every check before spend.
	 */
	let { project, cardId, onUpdated, onclose, onsent }: {
		project: Project; cardId: string; onUpdated: (project: Project) => void; onclose: () => void; onsent: (message: string) => void;
	} = $props();

	type Prepared = {
		title: string; still: { url: string; name: string; width: number | null; height: number | null };
		draft_note: string | null; configured: boolean; estimate: { credits: number; usd: number } | null; estimate_error: string | null; session_spent_usd: number;
	};

	const read = (key: string) => { try { return sessionStorage.getItem(key); } catch { return null; } };
	const write = (key: string, value: string) => { try { sessionStorage.setItem(key, value); } catch { /* private mode */ } };
	const sessionId = read('csp.session-id') ?? (() => { const id = crypto.randomUUID(); write('csp.session-id', id); return id; })();

	let prepared = $state<Prepared | null>(null);
	let prompt = $state('');
	let duration = $state(5);
	let resolution = $state<AnimateResolution>('480p');
	let audio = $state(true);
	let estimate = $state<{ credits: number; usd: number } | null>(null);
	let pricing = $state(false);
	let yolo = $state(read('csp.yolo') === '1');
	let cap = $state(Number(read('csp.yolo-cap') ?? '0'));
	let confirming = $state(false);
	let sending = $state(false);
	let error = $state<string | null>(null);
	let reasons = $state<string[]>([]);

	let lint = $derived(lintPrompt(prompt, 'seedance').issues);
	let lintErrors = $derived(lint.filter((issue) => issue.severity === 'error'));
	let stillUnder2K = $derived(!!prepared?.still.width && !!prepared?.still.height && Math.max(prepared.still.width, prepared.still.height) < MIN_LONG_EDGE);

	async function post(body: Record<string, unknown>) {
		const response = await fetch(`/api/projects/${project.project_id}/animate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		return (await response.json()) as { ok: true; data: unknown } | { ok: false; error: { message: string; reasons?: string[] } };
	}

	onMount(async () => {
		const result = await post({ action: 'prepare', card_id: cardId, session_id: sessionId });
		if (!result.ok) { error = result.error.message; return; }
		const data = result.data as Prepared & { settings: { prompt: string; duration_s: number; resolution: AnimateResolution; generate_audio: boolean } };
		prepared = data;
		prompt = data.settings.prompt; duration = data.settings.duration_s; resolution = data.settings.resolution; audio = data.settings.generate_audio;
		estimate = data.estimate;
		if (data.estimate_error) error = data.estimate_error;
	});

	// Re-price when the priced settings change (not on every keystroke of the prompt).
	let priceTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const settings = { prompt: 'price', duration_s: duration, resolution, generate_audio: audio };
		if (!prepared?.configured) return;
		confirming = false;
		if (priceTimer) clearTimeout(priceTimer);
		priceTimer = setTimeout(async () => {
			pricing = true;
			const result = await post({ action: 'estimate', settings });
			pricing = false;
			if (result.ok) estimate = result.data as { credits: number; usd: number };
			else error = result.error.message;
		}, 350);
	});

	$effect(() => { write('csp.yolo', yolo ? '1' : '0'); write('csp.yolo-cap', String(cap || 0)); });

	async function send() {
		if (!estimate || sending) return;
		if (!yolo && !confirming) { confirming = true; return; }
		sending = true; error = null; reasons = [];
		const result = await post({
			action: 'send', card_id: cardId, expected_version: project.version,
			settings: { prompt, duration_s: duration, resolution, generate_audio: audio },
			mode: yolo ? { kind: 'yolo', cap_usd: cap || 0, session_id: sessionId } : { kind: 'confirm', confirmed_usd: estimate.usd }
		});
		sending = false; confirming = false;
		if (!result.ok) { error = result.error.message; reasons = result.error.reasons ?? []; return; }
		onUpdated(result.data as Project);
		onsent(`Sent ${prepared?.title ?? 'the beat'} to Seedance (${resolution}, ${duration}s, ~$${estimate.usd.toFixed(2)}). It lands as a new take when it finishes.`);
		onclose();
	}
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-[#050607]/90 p-4" role="dialog" aria-label="Animate a still">
	<div class="panel">
		<header class="flex items-center gap-2">
			<span class="meta-label text-[#59d9cf]">ANIMATE</span>
			<b class="min-w-0 grow truncate">{prepared?.title ?? '…'}</b>
			<button type="button" class="ctl" onclick={onclose}>close</button>
		</header>
		{#if !prepared}
			<p class="mt-4 text-[#789da7]">{error ?? 'The Agent is drafting a prompt…'}</p>
		{:else}
			<div class="mt-3 grid gap-3 md:grid-cols-[220px_1fr]">
				<div>
					<img src={prepared.still.url} alt={`${prepared.title} start frame`} class="w-full border border-[#26383f] object-contain" />
					<p class="mt-1 font-mono text-[10px] text-[#668d98]">@Image_1 · {prepared.still.name}{prepared.still.width ? ` · ${prepared.still.width}×${prepared.still.height}` : ''}</p>
					{#if stillUnder2K}<p class="mt-1 font-mono text-[10px] text-gate-failed">Under 2K: sends are blocked until the still is at least {MIN_LONG_EDGE}px on the long edge.</p>{/if}
				</div>
				<div class="grid gap-2">
					{#if prepared.draft_note}<p class="font-mono text-[10px] text-gate-pending">{prepared.draft_note}</p>{/if}
					<label class="field">Prompt <span class="text-[#55747c]">(drafted by the Agent; edit freely)</span>
						<textarea bind:value={prompt} rows="9"></textarea>
					</label>
					{#if lint.length}
						<ul class="grid gap-0.5 font-mono text-[10px]">
							{#each lint as issue, i (i)}<li class={issue.severity === 'error' ? 'text-gate-failed' : 'text-gate-pending'}>{issue.severity === 'error' ? 'Blocks send' : 'Note'} · {issue.message} <span class="text-[#55747c]">{issue.context}</span></li>{/each}
						</ul>
					{/if}
					<div class="flex flex-wrap items-center gap-3">
						<label class="field-inline">Length <input type="number" min={ANIMATE_MIN_S} max={ANIMATE_MAX_S} step="1" bind:value={duration} />s</label>
						<label class="field-inline">Resolution <select bind:value={resolution}>{#each ANIMATE_RESOLUTIONS as option (option)}<option value={option}>{option}</option>{/each}</select></label>
						<label class="field-inline"><input type="checkbox" bind:checked={audio} /> Generate audio</label>
					</div>
				</div>
			</div>
			<footer class="mt-4 flex flex-wrap items-center gap-3 border-t border-[#223039] pt-3">
				{#if !prepared.configured}
					<span class="text-gate-pending">Add a Higgsfield API key in <a href="/settings" class="underline">Settings</a> to price and send.</span>
				{:else}
					<span class="font-mono text-[11px] text-[#bce6e8]">{pricing ? 'pricing…' : estimate ? `$${estimate.usd.toFixed(2)} · ${estimate.credits} credits` : 'no price'}</span>
					<label class="field-inline"><input type="checkbox" bind:checked={yolo} /> YOLO</label>
					{#if yolo}
						<label class="field-inline">Session cap $<input type="number" min="0" step="0.5" bind:value={cap} /></label>
						<span class="font-mono text-[10px] text-[#668d98]">spent this session ${prepared.session_spent_usd.toFixed(2)}</span>
					{/if}
				{/if}
				<span class="grow"></span>
				<button type="button" class="btn btn-accent" onclick={() => void send()} disabled={!prepared.configured || !estimate || pricing || sending || lintErrors.length > 0 || stillUnder2K || (yolo && !(cap > 0))}>
					{sending ? 'Sending…' : confirming ? `Send for $${estimate?.usd.toFixed(2)}` : yolo ? 'Send (YOLO)' : 'Send…'}
				</button>
			</footer>
			{#if error}<p class="mt-2 text-gate-failed" role="alert">{error}</p>{/if}
			{#if reasons.length}<ul class="mt-1 grid gap-0.5 text-[11px] text-gate-failed">{#each reasons as reason, i (i)}<li>· {reason}</li>{/each}</ul>{/if}
		{/if}
	</div>
</div>

<style>
	.panel { width: min(920px, 100%); max-height: 92vh; overflow: auto; border: 1px solid #26383f; background: #0d1116; padding: 14px; color: #a8cbd2; }
	.ctl { border: 1px solid #233034; background: #0f1517; padding: 2px 8px; color: #9fc9cf; }
	.field { display: grid; gap: 5px; color: #63d9d0; font: 600 10px var(--font-mono); text-transform: uppercase; }
	.field textarea { width: 100%; border: 1px solid #26383f; background: #0a0d11; padding: 8px; color: #bce6e8; font: 12px/1.55 var(--font-mono); text-transform: none; outline: none; }
	.field textarea:focus { border-color: #4ee8d2; }
	.field-inline { display: flex; align-items: center; gap: 5px; color: #84cbd0; font: 600 10px var(--font-mono); text-transform: uppercase; }
	.field-inline input[type='number'], .field-inline select { width: 64px; border: 1px solid #26383f; background: #0a0d11; padding: 2px 4px; color: #bce6e8; font: inherit; }
</style>
