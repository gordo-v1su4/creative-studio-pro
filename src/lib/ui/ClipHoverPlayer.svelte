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
		if (draw && resident) draw(resident.view);
	}

	function showPoster() {
		if (draw && poster) draw(poster.view);
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
		<canvas bind:this={canvas} class="block h-full w-full"></canvas>
		<audio bind:this={audio} {src} preload="none" loop></audio>
		<div class="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
			{#if phase === 'loading'}
				<div class="h-full bg-[#55dfd5]/70" style:width={`${progress * 100}%`}></div>
			{:else if hovering && duration}
				<div class="h-full bg-[#55dfd5]" style:width={`${(playhead / duration) * 100}%`}></div>
				{#if inS != null || outS != null}<div class="absolute inset-y-0 border-x border-[#f2c14e]" style:left={`${(spanIn / duration) * 100}%`} style:width={`${((Math.min(spanOut, duration) - spanIn) / duration) * 100}%`}></div>{/if}
			{/if}
		</div>
		{#if hovering && duration}
			<span class="pointer-events-none absolute right-1 top-1 bg-black/60 px-1 font-mono text-[9px] text-[#bce6e8]">{sound ? '🔊 ' : ''}{playhead.toFixed(1)}s / {duration.toFixed(1)}s</span>
		{/if}
		{#if phase === 'error'}
			<span class="absolute inset-x-0 bottom-1 px-2 text-center font-mono text-[9px] text-[#e88]">{message}</span>
		{/if}
	{/if}
</div>
