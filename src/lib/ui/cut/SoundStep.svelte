<script lang="ts">
	/**
	 * Cut → Sound (slice 7): the locked version plays with its mix, and each sound layer is a lane under the
	 * picture with its on/off and gain beside it (take audio, ambience, music, effects). Below the lanes, one line per
	 * layer for its file and settings, then the auto-mix. Placed effects are edited in the dock's Details; the Agent's
	 * effects pass shows in the Agent tab. What a mix is and how it is built is unchanged (V1S-128, V1S-129).
	 */
	import { onDestroy, onMount, untrack } from 'svelte';
	import type { Cut, Project } from '$lib/domain/schemas';
	import type { Layer } from '$lib/domain/sound';
	import { musicFlow } from '$lib/domain/sound';
	import { timecode } from '$lib/domain/viewer-keys';
	import { loadPeaks, PEAKS_HZ } from '$lib/media/waveform';
	import SequencePlayer, { type LaneView } from '$lib/ui/SequencePlayer.svelte';
	import Waveform from '$lib/ui/timeline/Waveform.svelte';
	import { soundDesk } from './sound-desk.svelte';

	let { project, cut, version, facts, detailsHost = null, onUpdated, onAgent }: {
		project: Project; cut: Cut; version: number; facts: string; detailsHost?: HTMLElement | null;
		onUpdated: (project: Project) => void;
		/** Show the dock's Agent tab, where the effects pass answers. */
		onAgent?: () => void;
	} = $props();

	onMount(() => { soundDesk.open = true; });
	onDestroy(() => { soundDesk.open = false; });
	$effect(() => { const p = project, id = cut.cut_id, v = version; untrack(() => soundDesk.sync(p, id, v)); });

	const desk = soundDesk;
	const plan = $derived(desk.plan);
	const mix = $derived(cut.versions?.find((v) => v.version === version)?.sound?.mix ?? null);
	const mixUrl = $derived(mix ? `${mix.url}?t=${encodeURIComponent(mix.built_at)}` : undefined);
	const LAYERS: Array<{ key: Layer; label: string; title: string }> = [
		{ key: 'take', label: 'Take audio', title: "Each take's own sound, crossfaded at cuts; cut-off hits ring out; ramps stretch up to 1.5×, muted above" },
		{ key: 'ambience', label: 'Ambience', title: 'One bed looped under the whole cut' },
		{ key: 'music', label: 'Music', title: "The cut's song, ducked under hits, dialogue and effects" },
		{ key: 'effects', label: 'Effects', title: 'Hits, whooshes and risers placed at times in the cut' }
	];

	// Peaks of the ambience bed and the song, read once per file.
	let bedPeaks = $state<number[] | null>(null);
	let songPeaks = $state<number[] | null>(null);
	$effect(() => { const url = plan.ambience?.url; bedPeaks = null; if (url) void loadPeaks(url).then((peaks) => { if (plan.ambience?.url === url) bedPeaks = peaks; }); });
	$effect(() => { const url = cut.music?.url; songPeaks = null; if (url) void loadPeaks(url).then((peaks) => { if (cut.music?.url === url) songPeaks = peaks; }); });

	const pct = (seconds: number, total: number) => `${Math.max(0, Math.min(100, (seconds / Math.max(1e-6, total)) * 100))}%`;
	const db = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)} dB`;
	const placed = $derived(plan.effects.filter((effect) => !effect.suggested).length);
	let effectAt = $state<number | null>(null);
	const song = $derived(cut.music ?? null);
	const flow = $derived(plan.music_flow);
	const loopFrom = $derived(flow?.loop_from_s ?? (song ? +(song.duration_s / 4).toFixed(1) : 0));
	const loopTo = $derived(flow?.loop_to_s ?? (song ? +((song.duration_s * 3) / 4).toFixed(1) : 0));
	const bed = $derived(flow?.bed_db ?? -6);
	function setFlow(patch: Partial<{ loop_from_s: number; loop_to_s: number; bed_db: number }>) {
		desk.setFlow({ loop_from_s: loopFrom, loop_to_s: loopTo, bed_db: bed, ...patch });
	}
	const num = (event: Event) => Number((event.currentTarget as HTMLInputElement).value.replace('−', '-'));

	function intoDock(node: HTMLElement, host: HTMLElement | null) {
		const place = (target: HTMLElement | null) => { if (target && node.parentNode !== target) target.appendChild(node); };
		place(host);
		return { update: place, destroy: () => node.remove() };
	}

	function suggest() {
		onAgent?.();
		void desk.propose();
	}
</script>

{#snippet build()}
	<button type="button" class="key go" onclick={() => void desk.build()} disabled={desk.building} title="Render the mix of this version: the four layers, auto-levelled, ducked and limited">{desk.building ? 'Building the mix…' : mix ? 'Rebuild mix' : 'Build mix'}</button>
{/snippet}

{#snippet layers(lane: LaneView)}
	{#each LAYERS as layer (layer.key)}
		{@const settings = plan.layers[layer.key]}
		<div class="mrow" data-off={settings.mute ? '' : undefined}>
			<div class="mh" title={layer.title}>
				<span class="cp lab">{layer.label}</span>
				<button type="button" class="tg" aria-pressed={!settings.mute} onclick={() => desk.setLayer(layer.key, { mute: !settings.mute })} aria-label={`${layer.label} ${settings.mute ? 'off' : 'on'}`}>{settings.mute ? 'Off' : 'On'}</button>
				<input class="gain" type="range" min="-24" max="12" step="0.5" value={settings.gain_db} style:--at={`${((settings.gain_db + 24) / 36) * 100}%`} oninput={(event) => desk.setLayer(layer.key, { gain_db: num(event) })} aria-label={`${layer.label} gain`} />
				<span class="code db">{db(settings.gain_db)}</span>
			</div>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="ml lane" onpointerdown={(event) => { const rect = event.currentTarget.getBoundingClientRect(); lane.seek(((event.clientX - rect.left) / rect.width) * lane.total); }}>
				{#if layer.key === 'take'}
					{#each [false, true] as played (played)}
						<div class="layer" class:played style:clip-path={played ? `inset(0 ${100 - (lane.time / Math.max(1e-6, lane.total)) * 100}% 0 0)` : undefined}>
							{#each lane.clips as clip, i (i)}
								{#if clip.wave}<div class="part" style:left={pct(clip.start, lane.total)} style:width={pct(clip.length, lane.total)}><Waveform peaks={clip.wave} from={clip.in} to={clip.out} speed={clip.speed} color={played ? 'var(--color-teal)' : '#45454d'} /></div>{/if}
							{/each}
						</div>
					{/each}
				{:else if layer.key === 'ambience'}
					{#if plan.ambience && bedPeaks?.length}
						{@const length = bedPeaks.length / PEAKS_HZ}
						{#each [false, true] as played (played)}
							<div class="layer" class:played style:clip-path={played ? `inset(0 ${100 - (lane.time / Math.max(1e-6, lane.total)) * 100}% 0 0)` : undefined}>
								{#each Array.from({ length: Math.min(200, Math.ceil(lane.total / Math.max(0.5, length))) }, (_, n) => n) as i (i)}
									<div class="part" style:left={pct(i * length, lane.total)} style:width={pct(Math.min(length, lane.total - i * length), lane.total)}><Waveform peaks={bedPeaks} from={0} to={Math.min(length, lane.total - i * length)} color={played ? 'var(--color-teal)' : '#45454d'} /></div>
								{/each}
							</div>
						{/each}
					{:else}
						<span class="cp empty">{plan.ambience ? 'Reading the bed…' : 'No bed'}</span>
					{/if}
				{:else if layer.key === 'music'}
					{#if song && songPeaks?.length}
						{@const pieces = musicFlow({ song_s: song.duration_s, cut_s: lane.total, beats: song.beats, flow }).pieces}
						{#each [false, true] as played (played)}
							<div class="layer" class:played style:clip-path={played ? `inset(0 ${100 - (lane.time / Math.max(1e-6, lane.total)) * 100}% 0 0)` : undefined}>
								{#each pieces as piece, i (i)}
									<div class="part" class:bed={piece.gain_db < 0} style:left={pct(piece.at_s, lane.total)} style:width={pct(piece.to - piece.from, lane.total)}><Waveform peaks={songPeaks} from={piece.from} to={piece.to} color={played ? 'var(--color-teal)' : '#45454d'} /></div>
								{/each}
							</div>
						{/each}
						{#each pieces.filter((piece) => piece.gain_db < 0).slice(0, 1) as piece (piece.at_s)}
							<span class="cp loop" style:left={pct(piece.at_s, lane.total)}>Loop</span>
						{/each}
					{:else}
						<span class="cp empty">{song ? 'Reading the song…' : 'No song · attach one in Picture'}</span>
					{/if}
				{:else}
					<div class="fx">
						{#each plan.effects as effect (effect.effect_id)}
							<i class:suggested={effect.suggested} style:left={pct(effect.at_s, lane.total)} title={`${effect.name} · ${timecode(effect.at_s)}${effect.suggested ? ' · suggested' : ''}`}></i>
						{/each}
					</div>
				{/if}
				<b class="head" style:left={pct(lane.time, lane.total)}></b>
			</div>
		</div>
	{/each}

	<div class="lines">
		<div class="ln">
			<span class="cp lab">Ambience</span>
			<span class="t">{plan.ambience?.name ?? 'No bed'}</span>
			{#if plan.ambience}<button type="button" class="key" onclick={() => desk.removeAmbience()}>Remove</button>{/if}
			<label class="key file">Choose file<input type="file" accept="audio/*" onchange={(event) => { void desk.setAmbience(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label>
		</div>
		<div class="ln">
			<span class="cp lab">Music</span>
			{#if song}
				<span class="t" title={`${song.name} · ${song.bpm} BPM · ${song.duration_s.toFixed(1)}s`}>{song.name} · {song.bpm} BPM</span>
				<label class="fd cp" title="When the cut runs longer than the song, these bars repeat quietly and the song's own ending lands on the last frame. Shots are never trimmed to the song.">Loop from<input class="num" type="text" inputmode="decimal" value={loopFrom.toFixed(1)} onchange={(event) => setFlow({ loop_from_s: num(event) })} aria-label="Loop from, seconds" /></label>
				<label class="fd cp">To<input class="num" type="text" inputmode="decimal" value={loopTo.toFixed(1)} onchange={(event) => setFlow({ loop_to_s: num(event) })} aria-label="Loop to, seconds" /></label>
				<label class="fd cp">Loop level<input class="num" type="text" inputmode="decimal" value={String(bed)} onchange={(event) => setFlow({ bed_db: num(event) })} aria-label="Loop level, dB" /></label>
				{#if flow}<button type="button" class="key" onclick={() => desk.setFlow(undefined)}>Default</button>{/if}
			{:else}
				<span class="t dim">No song on this cut: attach one in Picture</span>
			{/if}
		</div>
		<div class="ln">
			<span class="cp lab">Effects</span>
			<span class="t">{placed} placed{desk.suggested.length ? ` · ${desk.suggested.length} suggested` : ''}</span>
			<label class="fd cp">Add at<input class="num" type="text" inputmode="decimal" value={(effectAt ?? lane.time).toFixed(2)} onchange={(event) => (effectAt = Math.max(0, num(event)))} aria-label="Add the effect at, seconds" /></label>
			<label class="key file">Choose file<input type="file" accept="audio/*" onchange={(event) => { void desk.addEffect(event.currentTarget.files?.[0], effectAt ?? lane.time); event.currentTarget.value = ''; }} /></label>
			<button type="button" class="key agent" onclick={suggest} disabled={desk.proposing} title="The Agent picks hits, whooshes and risers from your effects folder for the cuts and impacts in this version; each lands as a suggestion you keep or remove. Generating new ones always asks first, with the price.">{desk.proposing ? 'Listening…' : 'Suggest effects'}</button>
		</div>
		<div class="ln">
			<span class="cp lab">Auto-mix</span>
			<label class="fd cp">Crossfade ms<input class="num" type="text" inputmode="numeric" value={String(Math.round(plan.crossfade_s * 1000))} onchange={(event) => desk.setMix({ crossfade_s: Math.min(1, Math.max(0, num(event) / 1000)) })} aria-label="Crossfade, milliseconds" /></label>
			<label class="fd cp">Duck music dB<input class="num" type="text" inputmode="numeric" value={String(plan.duck_db)} onchange={(event) => desk.setMix({ duck_db: Math.min(0, Math.max(-40, num(event))) })} aria-label="Duck music, dB" /></label>
			<label class="fd cp">Limiter dBFS<input class="num" type="text" inputmode="decimal" value={String(plan.limiter_db)} onchange={(event) => desk.setMix({ limiter_db: Math.min(0, Math.max(-12, num(event))) })} aria-label="Limiter, dBFS" /></label>
		</div>
		{#if desk.error}<p class="said" role="alert">{desk.error}</p>{/if}
	</div>
{/snippet}

{#key `${cut.cut_id}:${version}:${mixUrl ?? ''}`}
	<SequencePlayer {project} {onUpdated} source={{ kind: 'cut', cutId: cut.cut_id, version, mixUrl }} inline lanes="mix" facts={`${facts}${desk.saving ? ' · saving…' : ''}`} actions={build} below={layers} />
{/key}

{#if detailsHost}
	<div class="details" role="group" aria-label="Sound details" use:intoDock={detailsHost}>
		<section>
			<p class="cp">Mix · v{version}</p>
			{#if mix}
				<p class="code">Built {new Date(mix.built_at).toLocaleString()}</p>
				{#each mix.report as line, i (i)}<p class="line" title={line}>{line}</p>{/each}
			{:else}
				<p class="hint">Not built yet. Build it to hear it with the picture and to export.</p>
			{/if}
		</section>
		<section>
			<p class="cp">Effects · {plan.effects.length}</p>
			{#if !plan.effects.length}<p class="hint">None placed. Choose a file, or ask the Agent to suggest some.</p>{/if}
			{#each plan.effects as effect (effect.effect_id)}
				<div class="effect" class:suggested={effect.suggested}>
					<span class="name" title={effect.note ?? effect.name}>{effect.name}</span>
					<span class="row">
						<label class="fd cp">At<input class="num" type="text" inputmode="decimal" value={effect.at_s.toFixed(2)} onchange={(event) => desk.setEffect(effect.effect_id, { at_s: Math.max(0, num(event)) })} aria-label={`${effect.name}: at, seconds`} /></label>
						<label class="fd cp">Gain<input class="num" type="text" inputmode="decimal" value={String(effect.gain_db)} onchange={(event) => desk.setEffect(effect.effect_id, { gain_db: Math.min(12, Math.max(-24, num(event))) })} aria-label={`${effect.name}: gain, dB`} /></label>
						{#if effect.suggested}<button type="button" class="key agent" onclick={() => desk.keepEffect(effect.effect_id)}>Keep</button>{/if}
						<button type="button" class="key" onclick={() => desk.removeEffect(effect.effect_id)}>Remove</button>
					</span>
				</div>
			{/each}
			{#if desk.suggested.length}<p class="hint">Suggested effects stay out of the mix until you keep them.</p>{/if}
		</section>
	</div>
{/if}

<style>
	.code { color: var(--color-ink-3); font: 10.5px var(--font-mono); letter-spacing: 0.01em; white-space: nowrap; }
	.mrow { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 10px; }
	.mrow[data-off] .lane { opacity: 0.35; }
	.mh { display: flex; min-width: 0; height: 22px; flex: 0 0 284px; align-items: center; gap: 8px; }
	.mh .lab { width: 78px; flex: none; overflow: hidden; text-overflow: ellipsis; color: var(--color-ink-3); }
	.mh .db { width: 52px; flex: none; text-align: right; color: var(--color-ink); }
	.ml { position: relative; min-width: 0; flex: 1 1 320px; }
	.lane { height: 22px; cursor: ew-resize; touch-action: none; }
	.layer { position: absolute; inset: 0; pointer-events: none; }
	.part { position: absolute; top: 0; bottom: 0; }
	.part.bed { opacity: 0.55; }
	.loop { position: absolute; top: 50%; padding-left: 4px; transform: translateY(-50%); color: var(--color-ink-2); pointer-events: none; }
	.empty { position: absolute; top: 50%; left: 0; transform: translateY(-50%); color: var(--color-ink-3); pointer-events: none; }
	.fx { position: absolute; inset: 0; background: var(--color-raised); pointer-events: none; }
	.fx i { position: absolute; top: 4px; bottom: 4px; width: 6px; margin-left: -1px; background: #2f6f66; }
	.fx i.suggested { background: #6d5bd0; }
	.head { position: absolute; top: -2px; bottom: -2px; z-index: 2; width: 3px; margin-left: -1px; background: #d9f7ef; pointer-events: none; }
	/* A slider is a tall rectangle on a fine groove (DESIGN.md rule 8). */
	.gain { width: auto; min-width: 40px; height: 22px; flex: 1; margin: 0; appearance: none; -webkit-appearance: none; background: linear-gradient(#2f6f66, #2f6f66) 0 50% / var(--at) 3px no-repeat, linear-gradient(#27272a, #27272a) 0 50% / 100% 3px no-repeat; cursor: ew-resize; }
	.gain::-webkit-slider-thumb { width: 2px; height: 13px; appearance: none; -webkit-appearance: none; border-radius: 0; background: #d9f7ef; }
	.gain::-moz-range-thumb { width: 2px; height: 13px; border: 0; border-radius: 0; background: #d9f7ef; }
	.gain:focus-visible { outline: 2px solid var(--color-teal); outline-offset: 1px; }
	.lines { display: flex; flex-direction: column; padding: 8px 0 6px; }
	.ln { display: flex; min-height: 24px; flex-wrap: wrap; align-items: center; gap: 3px 10px; }
	.ln .lab { width: 78px; flex: none; color: var(--color-ink-3); }
	.ln .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-ink); }
	.ln .t.dim { color: var(--color-ink-3); }
	.fd { display: inline-flex; align-items: center; gap: 6px; color: var(--color-ink-3); }
	.num { width: 46px; height: 20px; box-sizing: border-box; border: 0; border-radius: 5px; background: var(--color-raised); padding: 0 6px; color: var(--color-ink); font: 10.5px var(--font-mono); text-align: right; outline: none; }
	.num:focus { background: var(--color-control); }
	.file { position: relative; overflow: hidden; }
	.file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
	.key.agent { background: var(--color-agent-purple-deep); color: #ddd6fe; }
	.said { margin: 4px 0 0; color: #ff7a6b; font: 10.5px var(--font-mono); }
	.details { display: flex; flex-direction: column; gap: 14px; padding: 12px 8px 10px; color: var(--color-ink-2); font: 12.5px/1.35 var(--font-sans); }
	.details section { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
	.details p { margin: 0; padding: 0 6px; }
	.details .cp { color: var(--color-ink-3); }
	.details .line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-ink-2); font-size: 12px; }
	.details .hint { color: var(--color-ink-3); font-size: 12px; line-height: 1.5; }
	.effect { display: flex; flex-direction: column; gap: 3px; border-radius: 5px; padding: 4px 6px; }
	.effect.suggested { background: var(--color-agent-surface); }
	.effect .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-ink); }
	.effect .row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
	@media (pointer: coarse) { .num { height: 36px; } }
</style>
