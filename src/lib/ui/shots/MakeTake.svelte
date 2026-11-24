<script lang="ts">
	/**
	 * Making a take from a shot's still (DECISIONS 17): the settings, "Get price", then a separate "Confirm".
	 * Asking for a price spends nothing. Confirm opens only for a price asked for these exact settings, and the
	 * server runs every check again (the Ghost check, the 2K still, the price) before anything is sent.
	 */
	import { ANIMATE_MAX_S, ANIMATE_MIN_S, ANIMATE_RESOLUTIONS, type AnimateResolution } from '$lib/domain/animate';
	import { canConfirm, quoteKey, takeBlockers, takeSeconds, type Quote } from '$lib/domain/make-take';
	import type { Project, StoryCard } from '$lib/domain/schemas';
	import type { Take } from '$lib/domain/takes';

	let { project, card, pick, unsaved = false, onUpdated }: {
		project: Project; card: StoryCard; pick: Take | null;
		/** The workspace has edits that are not saved yet. */
		unsaved?: boolean;
		onUpdated: (project: Project) => void;
	} = $props();

	let seconds = $state<{ shot: string; value: number } | null>(null);
	const duration = $derived(seconds?.shot === card.card_id ? seconds.value : takeSeconds(card.duration_ms));
	let resolution = $state<AnimateResolution>('480p');
	let sound = $state(true);
	let quote = $state<Quote | null>(null);
	let busy = $state<'' | 'price' | 'send'>('');
	let said = $state<{ shot: string; text: string; bad?: boolean } | null>(null);
	let reasons = $state<string[]>([]);

	const key = $derived(quoteKey(card.card_id, { duration_s: duration, resolution, generate_audio: sound }));
	const blockers = $derived(takeBlockers({ pick, prompt: card.video_prompt, unsaved }));
	const priced = $derived(quote?.key === key ? quote : null);
	const open = $derived(canConfirm({ quote, key, blockers, busy: busy !== '' }));
	// What the last request said comes first, so asking for a price always shows an outcome; else what is in the way.
	const line = $derived((said?.shot === card.card_id ? said.text : '') || blockers[0] || '');

	async function post(body: Record<string, unknown>) {
		const response = await fetch(`/api/projects/${project.project_id}/animate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		const text = await response.text();
		type Answer = { ok: true; data: unknown } | { ok: false; error: { message: string; reasons?: string[] } };
		// A server in front of the app can replace a failed answer with its own page; say so instead of failing silently.
		try { return JSON.parse(text) as Answer; }
		catch { return { ok: false, error: { message: `The provider could not be reached from this server (HTTP ${response.status}); making takes may not be set up here` } } satisfies Answer; }
	}

	/** Step one: what these settings cost. Nothing is uploaded and nothing is spent. */
	async function getPrice() {
		if (busy) return;
		const asked = key, shot = card.card_id;
		busy = 'price'; said = null; reasons = [];
		try {
			// The price depends on length, resolution and sound, not on the prompt's wording.
			const result = await post({ action: 'estimate', settings: { prompt: 'price', duration_s: duration, resolution, generate_audio: sound } });
			if (result.ok) quote = { key: asked, credits: (result.data as { credits: number }).credits };
			else said = { shot, text: result.error.message, bad: true };
		} catch { said = { shot, text: 'The price could not be fetched', bad: true }; }
		finally { busy = ''; }
	}

	/** Step two: send it for the price shown. */
	async function confirm() {
		if (!open || !priced) return;
		const shot = card.card_id, credits = priced.credits;
		busy = 'send'; said = null; reasons = [];
		try {
			const result = await post({
				action: 'send', card_id: shot, expected_version: project.version,
				settings: { prompt: card.video_prompt, duration_s: duration, resolution, generate_audio: sound },
				mode: { kind: 'confirm', confirmed_credits: credits }
			});
			if (!result.ok) { said = { shot, text: result.error.message, bad: true }; reasons = result.error.reasons ?? []; return; }
			quote = null;
			onUpdated(result.data as Project);
			said = { shot, text: `Sent for ${credits} credits; it lands as a new take when it finishes` };
		} catch { said = { shot, text: 'The take could not be sent', bad: true }; }
		finally { busy = ''; }
	}
</script>

<div class="make">
	<p class="cp head"><span class="title">Make a take</span><span class="skill">Seedance</span></p>
	<div class="set">
		<label class="cp" for="take-seconds">Length</label>
		<input id="take-seconds" type="number" min={ANIMATE_MIN_S} max={ANIMATE_MAX_S} step="1" value={duration} oninput={(event) => { const value = Math.round(Number(event.currentTarget.value)); if (value >= ANIMATE_MIN_S && value <= ANIMATE_MAX_S) seconds = { shot: card.card_id, value }; }} />
		{#each ANIMATE_RESOLUTIONS as option (option)}
			<button type="button" class="tg" aria-pressed={resolution === option} onclick={() => (resolution = option)} title={option === '480p' ? '480p, for review. A higher-resolution take is a new render and will not match it.' : `${option}: a render of its own`}>{option}</button>
		{/each}
		<button type="button" class="tg" aria-pressed={sound} onclick={() => (sound = !sound)} title="Generate the take's own sound">Sound</button>
	</div>
	<div class="steps">
		<button type="button" class="key" disabled={busy !== ''} onclick={() => void getPrice()} title="Ask what these settings cost; nothing is spent">Get price</button>
		<span class="price" class:has={!!priced} aria-live="polite">{busy === 'price' ? 'Pricing…' : priced ? `${priced.credits} credits` : 'No price yet'}</span>
		<button type="button" class="key go" disabled={!open} onclick={() => void confirm()} title={open ? 'Send this shot to Seedance for the price shown' : (blockers[0] ?? 'Get a price for these settings first')}>{busy === 'send' ? 'Sending…' : 'Confirm'}</button>
	</div>
	<p class="why" class:bad={said?.shot === card.card_id ? !!said.bad : !!blockers.length} title={blockers.join('\n')}>{line}</p>
	{#if reasons.length}<ul class="found">{#each reasons as reason, i (i)}<li>{reason}</li>{/each}</ul>{/if}
</div>

<style>
	.make { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
	.head { display: flex; align-items: baseline; gap: 10px; margin: 0; color: var(--color-ink-3); }
	.title { color: var(--color-ink-2); }
	.skill { color: var(--color-agent-pink); }
	.set { display: flex; min-width: 0; align-items: center; gap: 2px; overflow: hidden; }
	.set label { margin: 0 4px 0 0; color: var(--color-ink-3); }
	.set input { width: 44px; height: 20px; flex: none; margin-right: 6px; border: 0; border-radius: 5px; background: var(--color-control); padding: 0 4px; color: var(--color-ink); font: 11px var(--font-mono); }
	.steps { display: flex; align-items: center; gap: 4px; }
	.price { min-width: 0; flex: 1; overflow: hidden; padding: 0 6px; text-overflow: ellipsis; white-space: nowrap; color: var(--color-ink-3); font: 11px var(--font-mono); }
	.price.has { color: var(--color-amber); }
	.why { min-height: 18px; margin: 0; color: var(--color-ink-3); font-size: 11.5px; line-height: 18px; }
	.why.bad { color: #ff7a6b; }
	.found { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; color: #ff7a6b; font-size: 11.5px; line-height: 1.45; }
</style>
