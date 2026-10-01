<script lang="ts">
	import { onMount } from 'svelte';
	import type { ResidentFrameBank } from '$lib/media/gpu/ResidentFrameBank';
	import { attachTiles } from '$lib/media/gpu/clipBanks';

	/** Frames from the kept span laid side by side, drawn straight from the GPU frame bank. */
	let { bank, inS, outS }: { bank: ResidentFrameBank | null; inS: number; outS: number } = $props();

	let canvas = $state<HTMLCanvasElement>();
	let size = $state({ width: 0, height: 0 });
	let draw: ((views: GPUTextureView[]) => void) | null = $state(null);

	$effect(() => {
		if (!draw || !bank || !canvas || size.width < 2) return;
		const ratio = window.devicePixelRatio || 1;
		canvas.width = Math.round(size.width * ratio);
		canvas.height = Math.round(size.height * ratio);
		const count = Math.max(1, Math.round(size.width / Math.max(1, (size.height * 16) / 9)));
		const views: GPUTextureView[] = [];
		for (let i = 0; i < count; i++) {
			const frame = bank.frameAt(inS + ((i + 0.5) / count) * (outS - inS));
			if (frame) views.push(frame.view);
		}
		draw(views);
	});

	onMount(() => {
		const resize = new ResizeObserver(([entry]) => (size = { width: entry.contentRect.width, height: entry.contentRect.height }));
		resize.observe(canvas!);
		attachTiles(canvas!).then((attached) => (draw = attached)).catch(() => {});
		return () => resize.disconnect();
	});
</script>

<canvas bind:this={canvas} class="block h-full w-full"></canvas>
