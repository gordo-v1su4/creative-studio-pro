<script lang="ts">
	import { onMount } from 'svelte';
	import type { ResidentFrameBank } from '$lib/media/gpu/ResidentFrameBank';
	import { attachCanvas, loadBank, loadPoster, type Poster } from '$lib/media/gpu/clipBanks';
	import { rateAt, type SpeedPoint } from '$lib/media/speed-curve';

	/**
	 * Hover to review: the clip plays its kept span (in → out, with its speed ramp) and loops; leaving
	 * shows the poster. Click toggles the clip's own sound (shift-click is left to the
	 * sequence selection). Frames come from a resident GPU frame bank, so playback starts
	 * instantly once a clip has been hovered once.
	 */
	let { src, label, maxHeight = 216, inS = null, outS = null, speed = null }: {
		src: string; label: string; maxHeight?: number; inS?: number | null; outS?: number | null; speed?: SpeedPoint[] | null;
	} = $props();

	let canvas = $state<HTMLCanvasElement>();
	let audio = $state<HTMLAudioElement>();
	let host: HTMLDivElement;
	let phase = $state<'idle' | 'loading' | 'ready' | 'unsupported' | 'error'>('idle');
	let progress = $state(0);
	let playhead = $state(0);
	let duration = $state(0);
	let hovering = $state(false);
	let sound = $state(false);
	let message = $state('');
	// The canvas fades in once something (poster or frame) has been drawn on it.
	let shown = $state(false);
	// The trimmed span the reviewer kept; hover plays and loops only this part.
	const spanIn = $derived(Math.max(0, inS ?? 0));
	const spanOut = $derived(Math.min(duration || Infinity, outS ?? Infinity));

	let draw: ((view: GPUTextureView) => void) | null = null;
	let poster: Poster | null = null;
	let bank: ResidentFrameBank | null = null;
	let pressedAt: { x: number; y: number } | null = null;
	let lastTick = 0;
	let frame = 0;

	function showPlayhead() {
		const resident = bank?.frameAt(playhead);
		if (draw && resident) { draw(resident.view); shown = true; }
	}

	function showPoster() {
		if (draw && poster) { draw(poster.view); shown = true; }
	}

	function tick(now: number) {
		if (!hovering) return;
		if (bank) {
			// With sound on, the audio clock drives the picture so the two stay in sync.
			const end = Math.min(spanOut, bank.duration);
			// Same ramp the sequence player uses, so a card plays the way the cut does.
			const rate = rateAt(speed, (playhead - spanIn) / Math.max(1e-6, end - spanIn));
			if (sound && audio && Math.abs(audio.playbackRate - rate) > 0.01) audio.playbackRate = rate;
			playhead = sound && audio ? audio.currentTime : playhead + ((now - lastTick) / 1000) * rate;
			if (playhead >= end || playhead < spanIn) {
				playhead = spanIn;
				if (sound && audio) audio.currentTime = spanIn;
			}
			showPlayhead();
		}
		lastTick = now;
		frame = requestAnimationFrame(tick);
	}

	function enter() {
		hovering = true;
		playhead = spanIn;
		lastTick = performance.now();
		frame = requestAnimationFrame(tick);
		if (bank || phase === 'unsupported' || phase === 'loading') return;
		phase = 'loading';
		loadBank(src, maxHeight, (p) => (progress = p.total ? p.frames / p.total : 0))
			.then((loaded) => {
				bank = loaded;
				duration = loaded.duration;
				phase = 'ready';
				playhead = spanIn;
			})
			.catch((error: unknown) => {
				phase = 'error';
				message = error instanceof Error ? error.message : 'Clip failed to load';
			});
	}

	function down(event: PointerEvent) {
		pressedAt = { x: event.clientX, y: event.clientY };
	}

	function up(event: PointerEvent) {
		// A drag moves the card on the canvas; only a still click toggles sound.
		const still = pressedAt && Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) < 4;
		pressedAt = null;
		if (!still || event.shiftKey || event.button !== 0 || !audio) return;
		sound = !sound;
		if (sound) {
			audio.currentTime = playhead;
			void audio.play().catch(() => (sound = false));
		} else audio.pause();
	}

	function leave() {
		hovering = false;
		cancelAnimationFrame(frame);
		audio?.pause();
		sound = false;
		showPoster();
	}

	onMount(() => {
		let disposed = false;
		const resize = new ResizeObserver(() => {
			const ratio = window.devicePixelRatio || 1;
			canvas!.width = Math.max(2, Math.round(host.clientWidth * ratio));
			canvas!.height = Math.max(2, Math.round(host.clientHeight * ratio));
			if (hovering && bank) showPlayhead();
			else showPoster();
		});
		const visible = new IntersectionObserver(async ([entry]) => {
			if (!entry?.isIntersecting || poster) return;
			visible.disconnect();
			try {
				poster = await loadPoster(src);
				if (disposed) return;
				duration ||= poster.duration;
				if (!hovering) showPoster();
			} catch {
				// The bank load on hover reports its own error.
			}
		});
		attachCanvas(canvas!)
			.then((attached) => {
				if (disposed) return;
				draw = attached;
				resize.observe(host);
				visible.observe(host);
			})
			.catch((error: unknown) => {
				phase = 'unsupported';
				message = error instanceof Error ? error.message : 'WebGPU unavailable';
			});
		return () => {
			disposed = true;
			cancelAnimationFrame(frame);
			resize.disconnect();
			visible.disconnect();
		};
	});
</script>

<div
	bind:this={host}
	class="clip-hover relative h-full w-full overflow-hidden bg-black"
	role="img"
	aria-label={`${label} — hover to play, click for sound`}
	onpointerenter={enter}
	onpointerdown={down}
	onpointerup={up}
	onpointerleave={leave}
>
	{#if phase === 'unsupported'}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video {src} controls preload="metadata" class="h-full w-full object-contain" title={message}></video>
	{:else}
		<canvas bind:this={canvas} class={['clip-canvas block h-full w-full', shown && 'shown']}></canvas>
		{#if !shown && phase !== 'error'}<span class="clip-wait" aria-hidden="true"></span>{/if}
		<audio bind:this={audio} {src} preload="none" loop></audio>
		<div class="clip-line">
			{#if phase === 'loading'}
				<div class="clip-fill loading" style:width={`${Math.max(4, progress * 100)}%`}></div>
			{:else if hovering && duration}
				{#if inS != null || outS != null}<div class="clip-span" style:left={`${(spanIn / duration) * 100}%`} style:width={`${((Math.min(spanOut, duration) - spanIn) / duration) * 100}%`}></div>{/if}
				<div class="clip-fill" style:width={`${(playhead / duration) * 100}%`}></div>
			{/if}
		</div>
		{#if hovering && duration}
			<span class="clip-chip time">{playhead.toFixed(1)}<i>/</i>{duration.toFixed(1)}s</span>
			<span class={['clip-chip sound', sound && 'on']} title={sound ? 'Sound on: click to mute' : 'Click for sound'}><b aria-hidden="true"></b>{sound ? 'Sound' : 'Muted'}</span>
		{/if}
		{#if phase === 'error'}
			<span class="absolute inset-x-0 bottom-1 px-2 text-center font-mono text-[9px] text-nr-danger-text">{message}</span>
		{/if}
	{/if}
</div>

<style>
	.clip-canvas { opacity: 0; transition: opacity 220ms ease; }
	.clip-canvas.shown { opacity: 1; }
	.clip-wait { position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--color-nr-accent) 6%, transparent) 50%, transparent 70%) 0 0 / 220% 100%; animation: clip-sweep 1.4s ease-in-out infinite; pointer-events: none; }
	.clip-line { position: absolute; inset: auto 0 0 0; height: 2px; background: rgb(255 255 255 / 0.07); pointer-events: none; }
	.clip-fill { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, color-mix(in srgb, var(--color-nr-accent) 15%, transparent), var(--color-nr-accent)); }
	.clip-fill.loading { animation: clip-pulse 1.1s ease-in-out infinite; transition: width 160ms linear; }
	.clip-span { position: absolute; inset: -1px auto -1px auto; border-inline: 1px solid var(--color-nr-mark); }
	.clip-chip { position: absolute; top: 5px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid rgb(255 255 255 / 0.08); border-radius: 2px; background: rgb(5 7 10 / 0.72); padding: 1px 5px; color: var(--color-nr-text); font: 500 9px/14px var(--font-mono); letter-spacing: 0.04em; pointer-events: none; }
	.clip-chip.time { right: 5px; }
	.clip-chip.time i { margin: 0 2px; color: var(--color-nr-faint); font-style: normal; }
	.clip-chip.sound { left: 5px; color: var(--color-nr-dim); font-family: var(--font-sans); font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; }
	.clip-chip.sound b { width: 5px; height: 5px; border-radius: 999px; background: var(--color-nr-faint); }
	.clip-chip.sound.on { color: var(--color-nr-accent); }
	.clip-chip.sound.on b { background: var(--color-nr-accent); box-shadow: 0 0 6px var(--color-nr-accent); }
	@keyframes clip-sweep { from { background-position: 100% 0; } to { background-position: -100% 0; } }
	@keyframes clip-pulse { 50% { opacity: 0.45; } }
	@media (prefers-reduced-motion: reduce) {
		.clip-canvas, .clip-fill.loading { transition: none; }
		.clip-wait, .clip-fill.loading { animation: none; }
	}
</style>
