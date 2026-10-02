<script lang="ts" module>
	import type { ResidentFrameBank } from '$lib/media/gpu/ResidentFrameBank';
	import type { SpeedPoint } from '$lib/media/speed-curve';

	export interface TimelineClip {
		id: string;
		title: string;
		bank: ResidentFrameBank | null;
		duration: number;
		in: number;
		out: number;
		speed: SpeedPoint[] | undefined;
		/** The take's own audio peaks over its full length (see media/waveform), when it has audio. */
		wave?: number[] | null;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { isFlat, programElapsed } from '$lib/media/speed-curve';
	import Filmstrip from './Filmstrip.svelte';
	import SpeedLane from './SpeedLane.svelte';
	import Waveform from './Waveform.svelte';

	/**
	 * One-track review timeline. Clips butt end to end in sequence order, each block as
	 * long as its kept span plays (speed ramps included). Hover a block's edge to trim it
	 * (the trimmed-off media shows as a ghost while you drag), drag a block's body to move
	 * it, click to jump there. The selected clip's speed ramp sits in the lane below it.
	 */
	let {
		clips,
		index,
		programTime,
		phase = 0,
		onseek,
		ontrim,
		ontrimend,
		onmove,
		onspeed,
		marks = {},
		locked = false,
		beats = [],
		song = null
	}: {
		clips: TimelineClip[];
		index: number;
		programTime: number;
		/** Playing clip's position through its kept span, 0..1. */
		phase?: number;
		onseek: (programSeconds: number) => void;
		ontrim: (clip: number, edge: 'in' | 'out', seconds: number) => void;
		ontrimend: () => void;
		onmove: (from: number, to: number) => void;
		onspeed: (clip: number, points: SpeedPoint[]) => void;
		/** Suggested trims per clip id: a new in- or out-point in take seconds, drawn with what it would cut. */
		marks?: Record<string, Array<{ at: number; edge: 'in' | 'out' }>>;
		/** A locked cut: click to seek and look at ramps, but nothing can be trimmed, moved or ramped. */
		locked?: boolean;
		/** The attached song's beats, in cut seconds, ticked on the ruler. */
		beats?: number[];
		/** The attached song's peaks: drawn as the main audio lane under the clips, from the cut's start. */
		song?: number[] | null;
	} = $props();

	/** Where a take time sits inside a clip's block, in pixels from its left edge (speed ramp included). */
	function markX(clip: TimelineClip, at: number) {
		const span = Math.max(1e-6, clip.out - clip.in);
		return programElapsed(clip.speed, span, Math.min(1, Math.max(0, (at - clip.in) / span))) * scale;
	}

	const EDGE = 7;
	let host = $state<HTMLDivElement>();
	let width = $state(900);
	type Gesture =
		| { kind: 'trim'; clip: number; edge: 'in' | 'out'; startX: number; start: number; scale: number; starts: number[] }
		| { kind: 'move'; clip: number; startX: number; dx: number; moved: boolean; scale: number; starts: number[] }
		| { kind: 'seek' };
	let gesture = $state<Gesture | null>(null);
	/** The clip whose speed ramp is open — set by clicking or trimming a clip, not by playback. */
	let focusId = $state<string | null>(null);
	const focus = $derived(Math.max(0, clips.findIndex((clip) => clip.id === (focusId ?? clips[0]?.id))));

	const lengths = $derived(clips.map((clip) => programElapsed(clip.speed, Math.max(0, clip.out - clip.in))));
	const liveStarts = $derived(lengths.reduce<number[]>((starts, _l, i) => [...starts, i === 0 ? 0 : starts[i - 1] + lengths[i - 1]], []));
	const total = $derived(lengths.reduce((sum, length) => sum + length, 0));
	// Freeze the layout mid-gesture so blocks don't slide under the pointer.
	const scale = $derived(gesture && gesture.kind !== 'seek' ? gesture.scale : width / Math.max(1, total));
	const starts = $derived(gesture && gesture.kind !== 'seek' ? gesture.starts : liveStarts);

	const tickStep = $derived([0.5, 1, 2, 5, 10, 15, 30].find((step) => step * scale >= 56) ?? 60);
	const ticks = $derived(Array.from({ length: Math.floor(total / (tickStep / 2)) + 1 }, (_, i) => (i * tickStep) / 2));

	/** Where the dragged block would land, as an index into the sequence. */
	const dropIndex = $derived.by(() => {
		if (gesture?.kind !== 'move' || !gesture.moved) return null;
		const g = gesture;
		const center = starts[g.clip] + lengths[g.clip] / 2 + g.dx / g.scale;
		return clips.reduce((target, _clip, i) => (i !== g.clip && starts[i] + lengths[i] / 2 < center ? target + 1 : target), 0);
	});
	const dropX = $derived.by(() => {
		const g = gesture;
		if (dropIndex === null || g?.kind !== 'move') return 0;
		const others = clips.map((_, i) => i).filter((i) => i !== g.clip);
		return dropIndex < others.length ? starts[others[dropIndex]] * scale : total * scale;
	});

	function programAt(clientX: number) {
		const rect = host!.getBoundingClientRect();
		return Math.min(total, Math.max(0, (clientX - rect.left) / scale));
	}

	function seekDown(event: PointerEvent) {
		gesture = { kind: 'seek' };
		onseek(programAt(event.clientX));
	}

	function blockDown(event: PointerEvent, clip: number) {
		if (event.button !== 0) return;
		event.stopPropagation();
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const offset = event.clientX - rect.left;
		focusId = clips[clip].id;
		if (locked) { gesture = { kind: 'seek' }; onseek(programAt(event.clientX)); return; }
		if (offset < EDGE || rect.right - event.clientX < EDGE) {
			const edge = offset < EDGE ? 'in' : 'out';
			gesture = { kind: 'trim', clip, edge, startX: event.clientX, start: clips[clip][edge], scale, starts: [...liveStarts] };
		} else {
			gesture = { kind: 'move', clip, startX: event.clientX, dx: 0, moved: false, scale, starts: [...liveStarts] };
		}
	}

	function windowMove(event: PointerEvent) {
		if (!gesture) return;
		if (gesture.kind === 'seek') onseek(programAt(event.clientX));
		else if (gesture.kind === 'trim') ontrim(gesture.clip, gesture.edge, gesture.start + (event.clientX - gesture.startX) / gesture.scale);
		else {
			gesture.dx = event.clientX - gesture.startX;
			gesture.moved ||= Math.abs(gesture.dx) > 4;
		}
	}

	function windowUp(event: PointerEvent) {
		if (!gesture) return;
		const done = gesture;
		const target = dropIndex;
		gesture = null;
		if (done.kind === 'trim') ontrimend();
		else if (done.kind === 'move') {
			if (done.moved && target !== null && target !== done.clip) onmove(done.clip, target);
			else if (!done.moved) onseek(programAt(event.clientX));
		}
	}

	const fmt = (seconds: number) => (seconds >= 60 ? `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(0).padStart(2, '0')}` : `${seconds % 1 ? seconds.toFixed(1) : seconds.toFixed(0)}s`);

	onMount(() => {
		const resize = new ResizeObserver(([entry]) => (width = Math.max(200, entry.contentRect.width)));
		resize.observe(host!);
		return () => resize.disconnect();
	});
</script>

<svelte:window onpointermove={windowMove} onpointerup={windowUp} />

<div class="timeline select-none">
	<div bind:this={host} class="relative">
		<!-- Ruler -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="ruler relative h-[20px] cursor-text border-b border-[#1d2528]" onpointerdown={seekDown}>
			{#each beats.filter((b) => b <= total) as b, i (i)}
				<div class="pointer-events-none absolute bottom-0 h-[5px] w-px bg-[#f2c14e]/70" style:left={`${b * scale}px`}></div>
			{/each}
			{#each ticks as t (t)}
				{@const major = Math.abs(t / tickStep - Math.round(t / tickStep)) < 1e-6}
				<div class={['absolute bottom-0 w-px', major ? 'h-[7px] bg-[#3a4a4e]' : 'h-[4px] bg-[#263236]']} style:left={`${t * scale}px`}></div>
				{#if major}<span class="absolute top-[3px] font-mono text-[9px] text-[#4c5b5a]" style:left={`${t * scale + 3}px`}>{fmt(t)}</span>{/if}
			{/each}
		</div>

		<!-- Video track -->
		<div class="relative mt-[6px] h-[54px]">
			{#each clips as clip, i (clip.id)}
				{@const left = starts[i] * scale}
				{@const w = Math.max(6, lengths[i] * scale - 2)}
				{@const moving = gesture?.kind === 'move' && gesture.clip === i && gesture.moved}
				{@const trimming = gesture?.kind === 'trim' && gesture.clip === i}
				{#if trimming}
					<!-- Ghosts of the media trimmed off each end -->
					<div class="ghost absolute inset-y-0 rounded-l-[3px]" style:left={`${left - clip.in * scale}px`} style:width={`${clip.in * scale}px`}></div>
					<div class="ghost absolute inset-y-0 rounded-r-[3px]" style:left={`${left + w + 2}px`} style:width={`${(clip.duration - clip.out) * scale}px`}></div>
				{/if}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class={['block group absolute inset-y-0 overflow-hidden rounded-[3px] border', i === focus ? 'border-[#99f6e4]/90' : i === index ? 'border-[#99f6e4]/35' : 'border-[#233034]', moving ? 'z-20 opacity-90 shadow-[0_6px_18px_rgba(0,0,0,.55)]' : 'z-10']}
					style:left={`${left}px`}
					style:width={`${w}px`}
					style:transform={moving && gesture?.kind === 'move' ? `translateX(${gesture.dx}px)` : undefined}
					onpointerdown={(event) => blockDown(event, i)}
				>
					<div class="pointer-events-none absolute inset-0 opacity-80"><Filmstrip bank={clip.bank} inS={clip.in} outS={clip.out} /></div>
					{#if clip.wave}
						<!-- The take's own audio, as it plays in the cut: line its peaks up with the song lane below. -->
						<div class="pointer-events-none absolute inset-x-0 bottom-0 h-[16px] bg-black/55"><Waveform peaks={clip.wave} from={clip.in} to={clip.out} speed={clip.speed} color="#99f6e4" mirror={false} /></div>
					{/if}
					<div class="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1 bg-gradient-to-b from-black/75 to-transparent px-1.5 pb-2 pt-[3px] font-mono text-[9px] text-[#d6f4f5]">
						<span class="text-[#99f6e4]">{i + 1}</span>
						<span class="truncate">{clip.title.split(' — ').slice(1).join(' — ') || clip.title}</span>
						<span class="grow"></span>
						{#if !isFlat(clip.speed)}<span class="text-[#99f6e4]">⟿</span>{/if}
						<span class="text-[#8fb3b8]">{lengths[i].toFixed(1)}s</span>
					</div>
					{#each marks[clip.id] ?? [] as mark, m (m)}
						{@const x = markX(clip, mark.at)}
						<!-- A suggested trim: the part it would cut is shaded, the new edge is a line. -->
						<div class="mark-cut pointer-events-none absolute inset-y-0" style:left={`${mark.edge === 'in' ? 0 : x}px`} style:width={`${mark.edge === 'in' ? x : Math.max(0, w - x)}px`}></div>
						<div class="mark-line pointer-events-none absolute inset-y-0 w-[2px]" style:left={`${x - 1}px`}></div>
					{/each}
					<div class="edge edge-in absolute inset-y-0 left-0 cursor-ew-resize" style:width={`${EDGE}px`}></div>
					<div class="edge edge-out absolute inset-y-0 right-0 cursor-ew-resize" style:width={`${EDGE}px`}></div>
				</div>
			{/each}
			{#if dropIndex !== null}
				<div class="pointer-events-none absolute -inset-y-1 z-30 w-[2px] -translate-x-1/2 rounded bg-[#99f6e4]" style:left={`${dropX}px`}></div>
			{/if}
		</div>

		{#if song}
			<!-- The song: the main audio the takes were made with, playing straight through under the cut. -->
			<div class="relative mt-[4px] h-[30px] overflow-hidden rounded-[3px] border border-[#3a3420] bg-[#0f0d07]" aria-label="Song waveform">
				<div class="absolute inset-y-0 left-0" style:width={`${total * scale}px`}><Waveform peaks={song} from={0} to={total} color="#f2c14e" /></div>
				<span class="pointer-events-none absolute left-1 top-0 font-mono text-[8px] tracking-[.12em] text-[#8a7a46]">SONG</span>
			</div>
		{/if}
		<!-- Playhead -->
		<div class="pointer-events-none absolute inset-y-0 z-30" style:left={`${programTime * scale}px`}>
			<div class="absolute -left-[4px] top-0 h-0 w-0 border-x-[4px] border-t-[6px] border-x-transparent border-t-[#e6fff8]"></div>
			<div class="absolute top-0 bottom-0 w-px bg-[#e6fff8]/90"></div>
		</div>
	</div>

	<!-- Speed lane under the selected clip -->
	{#if clips[focus]}
		<div class="relative mt-2 h-[86px] border-t border-[#1d2528] pt-1">
			<span class="absolute left-0 top-1 font-mono text-[8px] tracking-[.12em] text-[#49645f]">SPEED · {focus + 1}</span>
			<div class="absolute top-1" style:left={`${starts[focus] * scale}px`} style:width={`${Math.max(60, lengths[focus] * scale - 2)}px`}>
				{#key clips[focus].id}
					<SpeedLane points={clips[focus].speed} phase={focus === index ? Math.min(1, Math.max(0, phase)) : null} onchange={(points) => onspeed(focus, points)} {locked} />
				{/key}
			</div>
		</div>
	{/if}
</div>

<style>
	.timeline { background: #0b0e10; }
	.ghost { background: repeating-linear-gradient(135deg, rgba(153, 246, 228, .07) 0 4px, transparent 4px 8px); border: 1px dashed rgba(153, 246, 228, .25); }
	.block { background: #0f1517; cursor: grab; }
	.block:active { cursor: grabbing; }
	.mark-cut { background: repeating-linear-gradient(135deg, rgba(242, 193, 78, .28) 0 3px, rgba(242, 193, 78, .08) 3px 6px); }
	.mark-line { background: #f2c14e; box-shadow: 0 0 6px rgba(242, 193, 78, .6); }
	.edge::after { content: ''; position: absolute; top: 0; bottom: 0; width: 2px; background: #99f6e4; opacity: 0; transition: opacity 90ms ease; }
	.edge-in::after { left: 0; }
	.edge-out::after { right: 0; }
	.edge:hover::after { opacity: 1; }
</style>
