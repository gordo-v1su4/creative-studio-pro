<script lang="ts">
	import Range from './Range.svelte';

	/**
	 * The app's audio player: a play key, the slim seek fader and a boxed time
	 * readout. Never the browser's default audio controls.
	 */
	let { src, label }: { src: string; label: string } = $props();

	let audio = $state<HTMLAudioElement>();
	let paused = $state(true);
	let time = $state(0);
	let duration = $state(0);
	let seeking = $state(false);
	let seekTo = $state(0);
	// The fader follows playback unless the operator is dragging it.
	$effect(() => { if (!seeking) seekTo = time; });

	const clock = (s: number) => `${Math.floor(s / 60)}:${(Math.floor(s) % 60).toString().padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;

	function toggle() {
		if (!audio) return;
		if (audio.paused) void audio.play().catch(() => (paused = true));
		else audio.pause();
	}

	function commit() {
		if (audio) audio.currentTime = seekTo;
		seeking = false;
	}
</script>

<div class="player" role="group" aria-label={label}>
	<audio bind:this={audio} {src} preload="metadata" bind:paused bind:currentTime={time} bind:duration onended={() => (time = 0)}></audio>
	<button type="button" class={['play', !paused && 'on']} onclick={toggle} aria-label={paused ? `Play ${label}` : `Pause ${label}`}>
		{#if paused}<span class="tri" aria-hidden="true"></span>{:else}<span class="bars" aria-hidden="true"></span>{/if}
	</button>
	<div class="seek">
		<Range label={`Seek ${label}`} min={0} max={duration || 1} step={0.01} oninput={() => { seeking = true; }} onchange={commit} bind:value={seekTo} />
	</div>
	<span class="readout">{clock(seeking ? seekTo : time)}<i>/</i>{clock(duration || 0)}</span>
</div>

<style>
	.player { display: flex; align-items: center; gap: 10px; }
	.play { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 24px; height: 20px; border: 1px solid var(--color-nr-line); border-radius: 2px; background: transparent; color: var(--color-nr-muted); transition: border-color 140ms ease, color 140ms ease; }
	.play:hover, .play.on { border-color: color-mix(in srgb, var(--color-nr-accent) 50%, transparent); color: var(--color-nr-accent); }
	.tri { width: 0; height: 0; margin-left: 2px; border-block: 4px solid transparent; border-left: 6px solid currentColor; }
	.bars { width: 6px; height: 8px; border-inline: 2px solid currentColor; }
	.seek { min-width: 0; flex: 1; }
	.readout { flex: none; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; padding: 0 5px; color: var(--color-nr-text); font: 500 10px/16px var(--font-mono); }
	.readout i { margin: 0 3px; color: var(--color-nr-faint); font-style: normal; }
</style>
