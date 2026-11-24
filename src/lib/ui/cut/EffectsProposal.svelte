<script lang="ts">
	/**
	 * The Agent's effects pass for the version open in Cut → Sound (V1S-129), shown in the Agent tab (slice 7,
	 * agreed with the mock): what it looked at, the effects it suggests from the folder (keep or remove each), and
	 * the ones it would have to generate, which are priced first and generated only from the button with the price.
	 */
	import { timecode } from '$lib/domain/viewer-keys';
	import { soundDesk } from './sound-desk.svelte';

	const desk = soundDesk;
	const suggested = $derived(desk.suggested);
	const db = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)} dB`;
</script>

<section class="effects" aria-label="The Agent's effects pass">
	<div class="acts">
		<button type="button" class="key agent" disabled={desk.proposing || !desk.version} onclick={() => void desk.propose()} title="Pick hits, whooshes and risers from your effects folder for the cuts and impacts in this version. Each lands as a suggestion you keep or remove; generating new ones always shows the price first.">{desk.proposing ? 'Listening…' : `Suggest effects for v${desk.version ?? ''}`}</button>
	</div>
	{#if desk.proposeNote || suggested.length || desk.offers.length || desk.error}
		<div class="msg">
			<span class="cp who">Agent</span>
			{#if desk.proposeNote}<p>{desk.proposeNote}</p>{:else if suggested.length || desk.offers.length}<p>Waiting on you in v{desk.version}:</p>{/if}
			{#if suggested.length || desk.offers.length}
				<div class="prop">
					{#each suggested as effect (effect.effect_id)}
						<div class="pl" title={effect.note ?? ''}>
							<span class="t">{effect.name}</span>
							<span class="code">{timecode(effect.at_s)} · {db(effect.gain_db)}</span>
							<button type="button" class="key agent" onclick={() => desk.keepEffect(effect.effect_id)}>Keep</button>
							<button type="button" class="key" onclick={() => desk.removeEffect(effect.effect_id)}>Remove</button>
						</div>
					{/each}
					{#each desk.offers as offer, i (i)}
						<div class="pl" title={offer.reason}>
							<span class="t">Generate “{offer.prompt}”</span>
							<span class="code">{offer.duration_s}s at {timecode(offer.at_s)}</span>
							{#if offer.confirming && offer.credits !== undefined}
								<button type="button" class="key agent" onclick={() => void desk.generateOffer(offer)} disabled={offer.busy}>{offer.busy ? 'Generating…' : `Generate for ${offer.credits} credits`}</button>
								<button type="button" class="key" onclick={() => (offer.confirming = false)}>Cancel</button>
							{:else}
								<button type="button" class="key" onclick={() => void desk.priceOffer(offer)} disabled={offer.busy}>{offer.busy ? 'Pricing…' : 'Price it'}</button>
							{/if}
							<button type="button" class="key" onclick={() => desk.skipOffer(offer)}>Skip</button>
						</div>
					{/each}
					<p class="note">Suggested effects stay out of the mix until you keep them.</p>
				</div>
			{/if}
			{#if desk.error}<p class="bad">{desk.error}</p>{/if}
		</div>
	{/if}
</section>

<style>
	.effects { display: flex; flex: none; flex-direction: column; gap: 8px; background: var(--color-panel); padding: 8px 10px; }
	.acts { display: flex; flex-wrap: wrap; gap: 4px; }
	.key.agent { background: var(--color-agent-purple-deep); color: #ddd6fe; }
	.msg { display: flex; flex-direction: column; gap: 4px; color: #c8c8ce; font: 12.5px/1.5 var(--font-sans); }
	.msg p { margin: 0; }
	.who { color: var(--color-agent-pink); }
	.prop { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; border-radius: 8px; background: var(--color-agent-surface); padding: 9px 10px; }
	.pl { display: flex; min-height: 24px; flex-wrap: wrap; align-items: center; gap: 3px 6px; }
	.pl .t { min-width: 0; flex: 1 1 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-ink); }
	.code { color: var(--color-ink-2); font: 10.5px var(--font-mono); letter-spacing: 0.01em; white-space: nowrap; }
	.note { margin-top: 6px !important; color: var(--color-ink-3); font-size: 11.5px; }
	.bad { color: #ff7a6b; }
</style>
