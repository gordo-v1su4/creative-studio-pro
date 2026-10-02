<script lang="ts">
	import type { Project, SoundPlan } from '$lib/domain/schemas';
	import { cutLength, cutsOf } from '$lib/domain/cuts';
	import { defaultSoundPlan, type Layer } from '$lib/domain/sound';

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
			<label class="field-inline">Cut
				<select class="pick" value={selected.key} onchange={(event) => (selectedKey = event.currentTarget.value)} aria-label="Locked cut version">
					{#each locked as entry (entry.key)}<option value={entry.key}>{entry.cut.name} v{entry.v.version} · {cutLength(entry.v).toFixed(1)}s</option>{/each}
				</select>
			</label>
			<span class="grow"></span>
			<span class="meta-label text-[#55747c]">{saving ? 'saving…' : 'saved'}</span>
		</div>

		<ul class="grid gap-2" aria-label="Layers">
			{#each layers as layer (layer.key)}
				<li class="layer">
					<div class="flex items-center gap-3">
						<b class="w-[92px]">{layer.label}</b>
						<label class="field-inline"><input type="checkbox" checked={!plan.layers[layer.key].mute} onchange={(event) => { plan.layers[layer.key].mute = !event.currentTarget.checked; changed(); }} aria-label={`${layer.label} on`} /> on</label>
						<input type="range" min="-24" max="12" step="0.5" bind:value={plan.layers[layer.key].gain_db} oninput={changed} aria-label={`${layer.label} gain`} class="grow" />
						<span class="w-[64px] text-right font-mono text-[11px] text-[#bce6e8]">{plan.layers[layer.key].gain_db > 0 ? '+' : ''}{plan.layers[layer.key].gain_db} dB</span>
					</div>
					<p class="mt-1 text-[11px] text-[#668d98]">{layer.note}</p>
					{#if layer.key === 'ambience'}
						<div class="mt-1 flex items-center gap-2 text-[11px]">
							{#if plan.ambience}<span class="text-[#bce6e8]">{plan.ambience.name}</span><button type="button" class="ctl" onclick={() => { plan.ambience = undefined; changed(); }}>remove</button>{:else}<span class="text-[#55747c]">no bed</span>{/if}
							<label class="ctl cursor-pointer">choose file<input type="file" accept="audio/*" class="hidden" onchange={(event) => { void setAmbience(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label>
						</div>
					{:else if layer.key === 'music'}
						<p class="mt-1 text-[11px] {selected.cut.music ? 'text-[#f2c14e]' : 'text-[#55747c]'}">{selected.cut.music ? `♪ ${selected.cut.music.name} · ${selected.cut.music.bpm} BPM` : 'No song on this cut: attach one in the cut player.'}</p>
					{:else if layer.key === 'effects'}
						<ul class="mt-1 grid gap-1" aria-label="Placed effects">
							{#each plan.effects as effect, i (effect.effect_id)}
								<li class="flex items-center gap-2 text-[11px]">
									<span class="w-[160px] truncate text-[#bce6e8]">{effect.name}</span>
									<label class="field-inline">at <input type="number" min="0" step="0.05" bind:value={plan.effects[i].at_s} onchange={changed} class="num" />s</label>
									<label class="field-inline">gain <input type="number" min="-24" max="12" step="0.5" bind:value={plan.effects[i].gain_db} onchange={changed} class="num" />dB</label>
									<button type="button" class="ctl" onclick={() => { plan.effects = plan.effects.filter((e) => e.effect_id !== effect.effect_id); changed(); }}>remove</button>
								</li>
							{/each}
						</ul>
						<div class="mt-1 flex items-center gap-2 text-[11px]">
							<label class="field-inline">add at <input type="number" min="0" step="0.05" bind:value={effectAt} class="num" />s</label>
							<label class="ctl cursor-pointer">choose file<input type="file" accept="audio/*" class="hidden" onchange={(event) => { void addEffect(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label>
						</div>
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
				<!-- svelte-ignore a11y_media_has_caption -->
				<audio class="mt-2 w-full" controls src={`${mix.url}?t=${encodeURIComponent(mix.built_at)}`}></audio>
				{#if mix.report.length}<ul class="mt-2 grid gap-0.5 text-[11px] text-[#9fc9cf]">{#each mix.report as line, i (i)}<li>· {line}</li>{/each}</ul>{/if}
			</section>
		{/if}
	{/if}
</div>

<style>
	.layer { border: 1px solid #26383f; background: #11161c; padding: 8px 10px; color: #bce6e8; font-size: 12px; }
	.ctl { border: 1px solid #233034; background: #0f1517; padding: 1px 7px; color: #9fc9cf; }
	.field-inline { display: flex; align-items: center; gap: 5px; color: #84cbd0; font: 600 10px var(--font-mono); text-transform: uppercase; }
	.pick { border: 1px solid #26383f; background: #0a0d11; padding: 2px 4px; color: #bce6e8; font: 12px var(--font-mono); text-transform: none; }
	.num { width: 64px; border: 1px solid #26383f; background: #0a0d11; padding: 1px 4px; color: #bce6e8; font: 11px var(--font-mono); }
</style>
