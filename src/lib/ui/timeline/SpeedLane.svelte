<script lang="ts">
	import { onMount } from 'svelte';
	import { MAX_RATE, MIN_RATE, normalizeSpeed, rateAt, type SpeedPoint } from '$lib/media/speed-curve';

	/**
	 * Speed ramp editor for one clip, after beatsmaxxer-pro's timing curve: click the plot
	 * to add a point, drag to shape, double-click (or Delete) to remove. Rates snap to
	 * quarter steps; hold Alt for free values. Speed-up only: 1× to 4×.
	 */
	let { points, phase = null, onchange, locked = false }: { points: SpeedPoint[] | undefined; phase?: number | null; onchange: (points: SpeedPoint[]) => void; locked?: boolean } = $props();

	const H = 48;
	const TOP = 5;
	const BOTTOM = H - 5;
	let svg = $state<SVGSVGElement>();
	let W = $state(400);
	let drag = $state<number | null>(null);
	let selected = $state<number | null>(null);

	const curve = $derived(normalizeSpeed(points));
	const x = (v: number) => 6 + v * (W - 12);
	const y = (rate: number) => BOTTOM - ((rate - MIN_RATE) / (MAX_RATE - MIN_RATE)) * (BOTTOM - TOP);
	const path = $derived(Array.from({ length: 241 }, (_, i) => `${i ? 'L' : 'M'}${x(i / 240).toFixed(1)},${y(rateAt(curve, i / 240)).toFixed(1)}`).join(' '));

	function position(event: PointerEvent): SpeedPoint {
		const rect = svg!.getBoundingClientRect();
		const px = Math.min(1, Math.max(0, (event.clientX - rect.left - 6) / (rect.width - 12)));
		const raw = MIN_RATE + Math.min(1, Math.max(0, (BOTTOM - ((event.clientY - rect.top) / rect.height) * H) / (BOTTOM - TOP))) * (MAX_RATE - MIN_RATE);
		return { x: px, rate: event.altKey ? raw : Math.round(raw * 4) / 4 };
	}

	function edit(next: SpeedPoint[]) {
		onchange(normalizeSpeed(next));
	}

	function down(event: PointerEvent, index?: number) {
		if (event.button !== 0 || locked) return;
		event.preventDefault();
		event.stopPropagation();
		try { (event.currentTarget as Element).setPointerCapture(event.pointerId); } catch { /* window listeners still track it */ }
		if (index !== undefined) {
			drag = selected = index;
			return;
		}
		const added = position(event);
		const next = normalizeSpeed([...curve, added]);
		edit(next);
		const at = next.findIndex((p) => Math.abs(p.x - added.x) < 1e-6);
		drag = selected = at < 0 ? null : at;
	}

	function move(event: PointerEvent) {
		// The parent may refuse an edit (a locked cut), so the dragged point may not exist.
		if (drag === null || !curve[drag]) { drag = null; return; }
		const p = position(event);
		const last = curve.length - 1;
		// Endpoints stay on the span edges; inner points can't cross their neighbours.
		const nx = drag === 0 ? 0 : drag === last ? 1 : Math.min(curve[drag + 1].x - 0.01, Math.max(curve[drag - 1].x + 0.01, p.x));
		edit(curve.map((point, i) => (i === drag ? { x: nx, rate: p.rate } : point)));
	}

	function remove(index: number) {
		if (locked || index === 0 || index === curve.length - 1) return;
		edit(curve.filter((_, i) => i !== index));
		selected = null;
	}

	function key(event: KeyboardEvent) {
		if (selected !== null && (event.key === 'Delete' || event.key === 'Backspace')) {
			event.preventDefault();
			remove(selected);
		}
	}

	onMount(() => {
		const resize = new ResizeObserver(([entry]) => (W = Math.max(60, entry.contentRect.width)));
		resize.observe(svg!);
		return () => resize.disconnect();
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<svg
	bind:this={svg}
	viewBox={`0 0 ${W} ${H}`}
	preserveAspectRatio="none"
	class={['block h-[48px] w-full touch-none', locked ? 'cursor-default opacity-60' : 'cursor-crosshair']}
	role="group"
	aria-label="Speed ramp: click to add a point, drag to shape, double-click to remove"
	tabindex="-1"
	onpointerdown={(event) => down(event)}
	onpointermove={move}
	onpointerup={() => (drag = null)}
	onpointercancel={() => (drag = null)}
	onkeydown={key}
>
	<rect width={W} height={H} fill="#141417" />
	{#each [1, 1.5, 2, 2.5, 3, 3.5, 4] as rate (rate)}
		<line x1="0" x2={W} y1={y(rate)} y2={y(rate)} stroke={rate === 1 ? '#3f3f46' : rate % 1 === 0 ? '#26262b' : '#1c1c20'} stroke-width=".6" />
	{/each}
	<path d={`${path} L${x(1)},${BOTTOM} L${x(0)},${BOTTOM}Z`} fill="#7dd9c812" pointer-events="none" />
	<path d={path} fill="none" stroke="#7dd9c8" stroke-width="1.2" pointer-events="none" />
	{#if phase !== null}
		<rect x={x(phase) - 1} y="0" width="2" height={H} fill="#d9f7ef" opacity=".7" pointer-events="none" />
	{/if}
	{#each curve as point, i (i)}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<g class="cursor-grab" onpointerdown={(event) => down(event, i)} ondblclick={(event) => { event.stopPropagation(); remove(i); }}>
			<rect x={x(point.x) - 9} y={y(point.rate) - 9} width="18" height="18" fill="transparent" />
			<rect x={x(point.x) - 2} y={y(point.rate) - 4} width="4" height="8" fill={selected === i ? '#cdf3ea' : '#7dd9c8'} pointer-events="none" />
		</g>
	{/each}
	{#each [1, 2, 3, 4] as rate (rate)}
		<text x="4" y={y(rate) - 2} fill="#7c7c86" font-size="8" font-family="var(--font-mono)" pointer-events="none">{rate}×</text>
	{/each}
</svg>
{#if selected !== null && curve[selected]}
	<div class="mt-1 font-mono text-[9.5px] text-ink-3">{curve[selected].rate.toFixed(2)}× at {(curve[selected].x * 100).toFixed(0)}% · alt = free · double-click / delete removes</div>
{/if}
