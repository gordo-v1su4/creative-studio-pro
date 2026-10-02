<script lang="ts">
	import type { Project, SoundPlan } from '$lib/domain/schemas';
	import { cutLength, cutsOf } from '$lib/domain/cuts';
	import { defaultSoundPlan, type Layer } from '$lib/domain/sound';
	import Range from '$lib/ui/controls/Range.svelte';
	import Toggle from '$lib/ui/controls/Toggle.svelte';
	import Pick from '$lib/ui/controls/Pick.svelte';
	import AudioPlayer from '$lib/ui/controls/AudioPlayer.svelte';

	/**
	 * Sound stage (V1S-128): lay sound against a locked cut version. Four
	 * layers (take audio, ambience bed, music, added effects) with mute and
	 * gain on top of the auto-mix; build renders the mix with ffmpeg; play it
	 * alone or under the picture.
	 */
	let { project, onUpdated, onplay }: {
		project: Project; onUpdated: (project: Project) => void; onplay: (cutId: string, version: number, mixUrl: string) => void;
	} = $props();

	const locked = $derived(cutsOf(project.production).flatMap((cut) => (cut.versions ?? []).map((v) => ({ cut, v, key: `${cut.cut_id}:${v.version}` }))).reverse());
	let selectedKey = $state<string | null>(null);
	const selected = $derived(locked.find((entry) => entry.key === selectedKey) ?? locked[0] ?? null);
	let plan = $state<SoundPlan>(defaultSoundPlan());
	let loadedFor = $state('');
	let saving = $state(false);
	let building = $state(false);
	let error = $state<string | null>(null);
	let effectAt = $state(0);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	// Load the selected version's plan (again when the project changes underneath and nothing is pending).
	$effect(() => {
		const key = selected ? `${selected.key}@${project.version}` : '';
		if (key === loadedFor || saveTimer) return;
		loadedFor = key;
		plan = JSON.parse(JSON.stringify(selected?.v.sound ?? defaultSoundPlan())) as SoundPlan;
	});

	async function send(body: Record<string, unknown>) {
		const response = await fetch(`/api/projects/${project.project_id}/sound`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		const result = (await response.json()) as { ok: true; data: Project } | { ok: false; error: { message: string } };
		if (!result.ok) throw new Error(result.error.message);
		onUpdated(result.data);
		return result.data;
	}

	function changed() {
		if (!selected) return;
		if (saveTimer) clearTimeout(saveTimer);
		saving = true;
		saveTimer = setTimeout(async () => {
			saveTimer = null;
			try {
				const { mix: _old, ...rest } = $state.snapshot(plan);
				await send({ action: 'save', cut_id: selected.cut.cut_id, version: selected.v.version, expected_version: project.version, plan: rest });
			} catch (cause) { error = cause instanceof Error ? cause.message : 'Saving the sound plan failed'; }
			finally { saving = false; }
		}, 400);
	}

	async function upload(file: File | undefined): Promise<{ url: string; name: string } | null> {
		if (!file) return null;
		const response = await fetch(`/api/projects/${project.project_id}/sound?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'content-type': file.type || 'audio/*' }, body: file });
		const result = (await response.json()) as { ok: true; data: { url: string; name: string } } | { ok: false; error: { message: string } };
		if (!result.ok) { error = result.error.message; return null; }
		return result.data;
	}

	async function setAmbience(file: File | undefined) {
		const stored = await upload(file);
		if (!stored) return;
		plan.ambience = stored;
		changed();
	}

	async function addEffect(file: File | undefined) {
		const stored = await upload(file);
		if (!stored) return;
		plan.effects = [...plan.effects, { effect_id: crypto.randomUUID(), ...stored, at_s: Math.max(0, effectAt), gain_db: 0 }].sort((a, b) => a.at_s - b.at_s);
		changed();
	}

	async function build() {
		if (!selected) return;
		building = true; error = null;
		try {
			if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; const { mix: _old, ...rest } = $state.snapshot(plan); await send({ action: 'save', cut_id: selected.cut.cut_id, version: selected.v.version, expected_version: project.version, plan: rest }); }
			await send({ action: 'build', cut_id: selected.cut.cut_id, version: selected.v.version });
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Building the mix failed'; }
		finally { building = false; }
	}

	const layers: Array<{ key: Layer; label: string; note: string }> = [
		{ key: 'take', label: 'Take audio', note: 'each take\'s own sound, crossfaded at cuts; cut-off hits ring out; ramps stretch ≤1.5×, muted above' },
		{ key: 'ambience', label: 'Ambience', note: 'one bed looped under the whole cut' },
		{ key: 'music', label: 'Music', note: 'the cut\'s song, ducked under hits, dialogue and effects' },
		{ key: 'effects', label: 'Effects', note: 'hits, whooshes and risers placed at times in the cut' }
	];
	const mix = $derived(selected?.v.sound?.mix ?? null);

	// --- Agent effects pass (V1S-129): suggestions to keep or remove, and generate offers that need a priced OK.
	type Offer = { moment_s: number; prompt: string; duration_s: number; at_s: number; reason: string; credits?: number; confirming?: boolean; busy?: boolean };
	let proposing = $state(false);
	let offers = $state<Offer[]>([]);
	let proposeNote = $state<string | null>(null);

	async function propose() {
		if (!selected) return;
		proposing = true; error = null; proposeNote = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/sound`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'propose', cut_id: selected.cut.cut_id, version: selected.v.version }) });
			const result = (await response.json()) as { ok: true; data: Project; offers: Offer[]; dropped: string[]; moments: number } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			onUpdated(result.data);
			offers = result.offers;
			const suggested = (cutsOf(result.data.production).find((c) => c.cut_id === selected.cut.cut_id)?.versions?.find((v) => v.version === selected.v.version)?.sound?.effects ?? []).filter((e) => e.suggested).length;
			proposeNote = `${result.moments} moments looked at · ${suggested} suggested from the folder · ${result.offers.length} to generate${result.dropped.length ? ` · ${result.dropped.length} picks discarded (${result.dropped.join('; ')})` : ''}`;
		} catch (cause) { error = cause instanceof Error ? cause.message : 'The effects pass failed'; }
		finally { proposing = false; }
	}

	function keepEffect(id: string) {
		plan.effects = plan.effects.map((e) => (e.effect_id === id ? { ...e, suggested: false } : e));
		changed();
	}

	async function priceOffer(offer: Offer) {
		offer.busy = true;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/sound`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'quote_effect', prompt: offer.prompt, duration_s: offer.duration_s }) });
			const result = (await response.json()) as { ok: true; data: { credits: number } } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			offer.credits = result.data.credits;
			offer.confirming = true;
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Price check failed'; }
		finally { offer.busy = false; }
	}

	async function generateOffer(offer: Offer) {
		if (!selected || offer.credits === undefined) return;
		offer.busy = true;
		try {
			await send({ action: 'generate_effect', cut_id: selected.cut.cut_id, version: selected.v.version, prompt: offer.prompt, duration_s: offer.duration_s, at_s: offer.at_s, confirmed_credits: offer.credits });
			offers = offers.filter((o) => o !== offer);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Generating the effect failed'; offer.busy = false; }
	}
</script>

<div class="mx-auto max-w-4xl p-5" aria-label="Sound stage">
	<div class="mb-4 border-b border-[#223039] pb-4">
		<div class="meta-label text-[#59d9cf]">SOUND</div>
		<p class="mt-2 text-[12px] leading-5 text-[#789da7]">Sound is laid against a locked cut version: take audio, an ambience bed, music and added effects, auto-mixed (levels, ducking, limiter). Mute or trim any layer on top of the auto-mix.</p>
	</div>
	{#if !selected}
		<p class="border border-dashed border-[#29434a] p-4 text-[12px] text-[#668d98]">No locked cuts yet. Lock a cut in the Cuts tab to lay sound against it.</p>
	{:else}
		<div class="mb-4 flex flex-wrap items-center gap-2">
			<span class="field-inline">Cut
				<Pick label="Locked cut version" value={selected.key} options={locked.map((entry) => ({ value: entry.key, label: `${entry.cut.name} v${entry.v.version}`, hint: `${cutLength(entry.v).toFixed(1)}s` }))} onchange={(key) => (selectedKey = key)} />
			</span>
			<span class="grow"></span>
			<span class="meta-label text-[#55747c]">{saving ? 'saving…' : 'saved'}</span>
		</div>

		<ul class="grid border-t border-[#1a1f23]" aria-label="Layers">
			{#each layers as layer (layer.key)}
				<li class="layer">
					<div class="flex items-center gap-3">
						<span class="cap">{layer.label}</span>
						<span class="note">{layer.note}</span>
						<span class="grow"></span>
						<Toggle label={`${layer.label} on`} checked={!plan.layers[layer.key].mute} onchange={(on) => { plan.layers[layer.key].mute = !on; changed(); }} />
						<span class="readout">{plan.layers[layer.key].gain_db > 0 ? '+' : ''}{plan.layers[layer.key].gain_db.toFixed(1)} dB</span>
					</div>
					<div class="mt-1.5"><Range label={`${layer.label} gain`} min={-24} max={12} step={0.5} bind:value={plan.layers[layer.key].gain_db} oninput={changed} /></div>
					{#if layer.key === 'ambience'}
						<div class="mt-1 flex items-center gap-2 text-[11px]">
							{#if plan.ambience}<span class="text-[#bce6e8]">{plan.ambience.name}</span><button type="button" class="ctl" onclick={() => { plan.ambience = undefined; changed(); }}>remove</button>{:else}<span class="text-[#55747c]">no bed</span>{/if}
							<label class="ctl cursor-pointer">choose file<input type="file" accept="audio/*" class="hidden" onchange={(event) => { void setAmbience(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label>
						</div>
					{:else if layer.key === 'music'}
						<p class="mt-1 text-[11px] {selected.cut.music ? 'text-[#d9c98a]' : 'text-[#5b6b70]'}">{selected.cut.music ? `♪ ${selected.cut.music.name} · ${selected.cut.music.bpm} BPM` : 'No song on this cut: attach one in the cut player.'}</p>
					{:else if layer.key === 'effects'}
						<ul class="mt-1 grid gap-1" aria-label="Placed effects">
							{#each plan.effects as effect, i (effect.effect_id)}
								<li class={['flex flex-wrap items-center gap-2 text-[11px]', effect.suggested && 'suggested']} title={effect.note ?? ''}>
									{#if effect.suggested}<span class="badge">suggested</span>{/if}
									<span class="w-[160px] truncate text-[#bce6e8]">{effect.name}</span>
									<label class="field-inline">at <input type="number" min="0" step="0.05" bind:value={plan.effects[i].at_s} onchange={changed} class="num" />s</label>
									<label class="field-inline">gain <input type="number" min="-24" max="12" step="0.5" bind:value={plan.effects[i].gain_db} onchange={changed} class="num" />dB</label>
									{#if effect.suggested}<button type="button" class="ctl keep" onclick={() => keepEffect(effect.effect_id)}>keep</button>{/if}
									<button type="button" class="ctl" onclick={() => { plan.effects = plan.effects.filter((e) => e.effect_id !== effect.effect_id); changed(); }}>remove</button>
									{#if effect.note}<span class="w-full pl-1 text-[#668d98]">{effect.note}</span>{/if}
								</li>
							{/each}
						</ul>
						{#if offers.length}
							<ul class="mt-2 grid gap-1 border-l border-[#2c5d5a] pl-2" aria-label="Effects to generate">
								{#each offers as offer, o (o)}
									<li class="flex flex-wrap items-center gap-2 text-[11px] text-[#9ee9df]">
										<span>generate “{offer.prompt}” · {offer.duration_s}s at {offer.at_s}s</span>
										<span class="text-[#6f7c84]">{offer.reason}</span>
										{#if offer.confirming && offer.credits !== undefined}
											<button type="button" class="ctl keep" onclick={() => void generateOffer(offer)} disabled={offer.busy}>{offer.busy ? 'generating…' : `Generate for ${offer.credits} credits`}</button>
											<button type="button" class="ctl" onclick={() => (offer.confirming = false)}>cancel</button>
										{:else}
											<button type="button" class="ctl" onclick={() => void priceOffer(offer)} disabled={offer.busy}>{offer.busy ? 'pricing…' : 'Generate…'}</button>
										{/if}
										<button type="button" class="ctl" onclick={() => (offers = offers.filter((x) => x !== offer))}>skip</button>
									</li>
								{/each}
							</ul>
						{/if}
						<div class="mt-1 flex items-center gap-2 text-[11px]">
							<button type="button" class="ctl keep" onclick={() => void propose()} disabled={proposing} title="The Agent picks hits, whooshes and risers from your effects folder for the cuts and impacts in this version; each lands as a suggestion you keep or remove. Generating new ones always asks first with the price.">{proposing ? 'Agent is listening…' : 'Agent: suggest effects'}</button>
							<label class="field-inline">add at <input type="number" min="0" step="0.05" bind:value={effectAt} class="num" />s</label>
							<label class="ctl cursor-pointer">choose file<input type="file" accept="audio/*" class="hidden" onchange={(event) => { void addEffect(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label>
						</div>
						{#if proposeNote}<p class="mt-1 text-[11px] text-[#9fc9cf]">{proposeNote}</p>{/if}
						{#if plan.effects.some((e) => e.suggested)}<p class="mt-1 text-[11px] text-[#6f7c84]">Suggested effects stay out of the mix until you keep them.</p>{/if}
					{/if}
				</li>
			{/each}
		</ul>

		<div class="mt-3 flex flex-wrap items-center gap-4 text-[11px]">
			<label class="field-inline">crossfade <input type="number" min="0" max="500" step="5" value={Math.round(plan.crossfade_s * 1000)} onchange={(event) => { plan.crossfade_s = Math.min(1, Math.max(0, Number(event.currentTarget.value) / 1000)); changed(); }} class="num" />ms</label>
			<label class="field-inline">duck music <input type="number" min="-40" max="0" step="1" bind:value={plan.duck_db} onchange={changed} class="num" />dB</label>
			<label class="field-inline">limiter <input type="number" min="-12" max="0" step="0.5" bind:value={plan.limiter_db} onchange={changed} class="num" />dBFS</label>
			<span class="grow"></span>
			<button type="button" class="btn btn-accent" onclick={() => void build()} disabled={building}>{building ? 'Building the mix…' : mix ? 'Rebuild mix' : 'Build mix'}</button>
		</div>
		{#if error}<p class="mt-2 text-gate-failed" role="alert">{error}</p>{/if}

		{#if mix}
			<section class="mt-4 border border-[#29434a] bg-[#0d1418] p-3" aria-label="Mix">
				<div class="flex flex-wrap items-center gap-3">
					<span class="meta-label text-[#59d9cf]">MIX · v{selected.v.version}</span>
					<span class="text-[11px] text-[#668d98]">built {new Date(mix.built_at).toLocaleString()}</span>
					<span class="grow"></span>
					<button type="button" class="btn" onclick={() => onplay(selected.cut.cut_id, selected.v.version, `${mix.url}?t=${encodeURIComponent(mix.built_at)}`)}>Play with picture</button>
				</div>
				<div class="mt-2"><AudioPlayer label="the mix" src={`${mix.url}?t=${encodeURIComponent(mix.built_at)}`} /></div>
				{#if mix.report.length}<ul class="mt-2 grid gap-0.5 text-[11px] text-[#9fc9cf]">{#each mix.report as line, i (i)}<li>· {line}</li>{/each}</ul>{/if}
			</section>
		{/if}
	{/if}
</div>

<style>
	/* Hardware panel look: dark plates, spaced capitals, boxed readouts, bordered keys. */
	.layer { border-bottom: 1px solid #1a1f23; padding: 10px 2px 12px; color: #cfd8dc; font-size: 12px; }
	.cap { color: #7b878f; font: 600 10px var(--font-sans); letter-spacing: 0.16em; text-transform: uppercase; white-space: nowrap; }
	.note { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #55626a; font-size: 11px; }
	.readout { min-width: 58px; border: 1px solid #22282d; border-radius: 2px; background: #0a0c0e; padding: 0 6px; color: #b9cfd2; font: 11px/16px var(--font-mono); text-align: right; }
	.ctl { border: 1px solid #262c31; border-radius: 2px; background: transparent; padding: 0 6px; color: #7b878f; font: 600 9px/16px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; transition: border-color 140ms ease, color 140ms ease; }
	.ctl:hover:not(:disabled) { border-color: #44505a; color: #c4d0d6; }
	.ctl:disabled { opacity: 0.45; }
	.field-inline { display: flex; align-items: center; gap: 6px; color: #6f7c84; font: 600 10px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; }
	.suggested { border-left: 2px solid #4ee8d2; padding-left: 6px; }
	.badge { border: 1px solid #2c5d5a; border-radius: 2px; padding: 0 5px; color: #7de5dc; font: 600 9px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; }
	.ctl.keep { border-color: rgba(78, 232, 210, 0.45); color: #7de5dc; }
	.num { width: 56px; border: 1px solid #22282d; border-radius: 2px; background: #0a0c0e; padding: 0 5px; color: #b9cfd2; font: 11px/16px var(--font-mono); outline: none; }
	.num:focus { border-color: #4ee8d2; }
</style>
