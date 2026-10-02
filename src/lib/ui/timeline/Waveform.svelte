<script lang="ts">
	import { onMount } from 'svelte';
	import { fractionAtProgram, programElapsed, type SpeedPoint } from '$lib/media/speed-curve';
	import { PEAKS_HZ } from '$lib/media/waveform';

	/**
	 * Audio peaks drawn across a span as it plays: source seconds [from, to)
	 * mapped through the speed ramp onto the width, so a hit sits where it
	 * is heard. Used for the song lane and each clip's own audio.
	 */
	let { peaks, from, to, speed = undefined, color = '#99f6e4', mirror = true }: {
		peaks: number[]; from: number; to: number; speed?: SpeedPoint[]; color?: string; mirror?: boolean;
	} = $props();

	let canvas = $state<HTMLCanvasElement>();
	let width = $state(0);
	let height = $state(0);

	$effect(() => {
		const c = canvas;
		if (!c || width < 2 || height < 2) return;
		const ratio = window.devicePixelRatio || 1;
		c.width = Math.round(width * ratio);
		c.height = Math.round(height * ratio);
		const g = c.getContext('2d')!;
		g.scale(ratio, ratio);
		g.clearRect(0, 0, width, height);
		g.fillStyle = color;
		const span = Math.max(1e-6, to - from);
		const played = programElapsed(speed, span);
		for (let x = 0; x < width; x++) {
			// The source time under each column, through the ramp (program → source).
			const t0 = from + fractionAtProgram(speed, span, (x / width) * played) * span;
			const t1 = from + fractionAtProgram(speed, span, ((x + 1) / width) * played) * span;
			let peak = 0;
			for (let i = Math.floor(t0 * PEAKS_HZ); i <= Math.ceil(t1 * PEAKS_HZ) && i < peaks.length; i++) if (i >= 0) peak = Math.max(peak, peaks[i]);
			const h = Math.max(1, peak * (mirror ? height : height - 1));
			g.fillRect(x, mirror ? (height - h) / 2 : height - h, 1, h);
		}
	});

	onMount(() => {
		const resize = new ResizeObserver(([entry]) => { width = entry.contentRect.width; height = entry.contentRect.height; });
		resize.observe(canvas!);
		return () => resize.disconnect();
	});
</script>

<canvas bind:this={canvas} class="block h-full w-full"></canvas>
