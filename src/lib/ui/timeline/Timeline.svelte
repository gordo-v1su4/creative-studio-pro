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
	import { onMount, untrack } from 'svelte';
	import { isFlat, programElapsed } from '$lib/media/speed-curve';
	import Filmstrip from './Filmstrip.svelte';
	import SpeedLane from './SpeedLane.svelte';
	import Waveform from './Waveform.svelte';

	/**
	 * One-track review timeline. Clips butt end to end in sequence order, each block as
	 * long as its kept span plays (speed ramps included). Hover a block's edge to trim it
	 * (the trimmed-off media shows as a ghost while you drag), drag a block's body to move
	 * it, click to jump there. The selected clip's speed ramp sits in the lane below it.
	 * Zoom (buttons, or ⌘/Ctrl + wheel or a pinch around the pointer) widens the track
	 * inside a scrolling view; while it plays, the view keeps the playhead on screen.
	 */
	let {
		clips,
		index,
		programTime,
		phase = 0,
		onseek,
		onseekstart,
		onseekend,
		ontrim,
		ontrimend,
		onmove,
		onspeed,
		marks = {},
		locked = false,
		beats = [],
		song = null,
		zoom = $bindable(1),
		zoomMax = $bindable(1),
		showZoom = true,
		rows = 'all'
	}: {
		clips: TimelineClip[];
		index: number;
		programTime: number;
		/** Playing clip's position through its kept span, 0..1. */
		phase?: number;
		onseek: (programSeconds: number) => void;
		onseekstart?: () => void;
		onseekend?: () => void;
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
		/** 1 = the whole cut fits the view; above 1 the track is that many views wide. Bindable, for zoom keys drawn elsewhere. */
		zoom?: number;
		/** The most the track may be zoomed, written here for zoom keys drawn elsewhere. */
		zoomMax?: number;
		/** Draw the zoom keys above the lanes. */
		showZoom?: boolean;
		/** 'all': picture, scrub, take audio, music and speed lanes. 'picture': picture and scrub only, always fitted. */
		rows?: 'all' | 'picture';
	} = $props();

	/** Where a take time sits inside a clip's block, in pixels from its left edge (speed ramp included). */
	function markX(clip: TimelineClip, at: number) {
		const span = Math.max(1e-6, clip.out - clip.in);
		return programElapsed(clip.speed, span, Math.min(1, Math.max(0, (at - clip.in) / span))) * scale;
	}

	const EDGE = 7;
	/** Most a clip block may be stretched: one second of program as wide as the view. */
	const MAX_PX_PER_S = 900;
	/** A long cut opens zoomed in enough that an average clip is about this wide. */
	const OPEN_CLIP_PX = 86;
	let host = $state<HTMLDivElement>();
	let scroller = $state<HTMLDivElement>();
	let width = $state(900);
	let zoomTouched = false;
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
	const scale = $derived(gesture && gesture.kind !== 'seek' ? gesture.scale : (width * zoom) / Math.max(1, total));
	const maxZoom = $derived(rows === 'picture' ? 1 : Math.max(1, (MAX_PX_PER_S * Math.max(1, total)) / width));
	$effect(() => { zoomMax = maxZoom; });
	// A zoom asked for from outside (the keys drawn elsewhere) counts as the operator's own.
	let lastZoom = 1;
	$effect(() => { if (Math.abs(zoom - lastZoom) > 1e-6 && untrack(() => clips.length)) zoomTouched = true; lastZoom = zoom; });
	// A long cut opens readable, until the operator picks a zoom themselves.
	$effect(() => {
		if (rows === 'picture') { zoom = 1; return; }
		if (zoomTouched || !clips.length) return;
		zoom = lastZoom = Math.min(maxZoom, Math.max(1, (clips.length * OPEN_CLIP_PX) / width));
	});

	/** Zoom keeping one program time (the pointer's, else the playhead's) at the same place in the view. */
	function setZoom(next: number, anchorClientX?: number) {
		zoomTouched = true;
		const view = scroller;
		const target = Math.min(maxZoom, Math.max(1, next));
		if (!view) { zoom = target; return; }
		const rect = view.getBoundingClientRect();
		const offset = anchorClientX !== undefined ? anchorClientX - rect.left : Math.min(rect.width, Math.max(0, programTime * scale - view.scrollLeft));
		const time = (view.scrollLeft + offset) / scale;
		zoom = lastZoom = target;
		const nextScale = (width * target) / Math.max(1, total);
		requestAnimationFrame(() => (view.scrollLeft = Math.max(0, time * nextScale - offset)));
	}

	function wheel(event: WheelEvent) {
		// ⌘/Ctrl + wheel, and a trackpad pinch (which arrives as Ctrl + wheel), zoom; plain wheel scrolls.
		if (!(event.ctrlKey || event.metaKey) || rows === 'picture') return;
		event.preventDefault();
		setZoom(zoom * Math.exp(-event.deltaY * 0.01), event.clientX);
	}

	// While playing zoomed in, keep the playhead on screen: page on when it nears the right edge.
	$effect(() => {
		const view = scroller;
		if (!view || zoom <= 1 || gesture) return;
		const x = programTime * scale;
		if (x < view.scrollLeft || x > view.scrollLeft + view.clientWidth - 24) view.scrollLeft = Math.max(0, x - view.clientWidth * 0.2);
	});
	const starts = $derived(gesture && gesture.kind !== 'seek' ? gesture.starts : liveStarts);

	/** Some clip has its own sound to draw. */
	const heard = $derived(clips.some((clip) => clip.wave));

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
		if (event.button !== 0) return;
		gesture = { kind: 'seek' };
		onseekstart?.();
		onseek(programAt(event.clientX));
	}

	function blockDown(event: PointerEvent, clip: number) {
		if (event.button !== 0) return;
		event.stopPropagation();
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const offset = event.clientX - rect.left;
		focusId = clips[clip].id;
		if (locked) { seekDown(event); return; }
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
		if (done.kind === 'seek') onseekend?.();
		else if (done.kind === 'trim') ontrimend();
		else if (done.kind === 'move') {
			if (done.moved && target !== null && target !== done.clip) onmove(done.clip, target);
			else if (!done.moved) onseek(programAt(event.clientX));
		}
	}

	onMount(() => {
		const resize = new ResizeObserver(([entry]) => (width = Math.max(200, entry.contentRect.width)));
		resize.observe(scroller!);
		return () => resize.disconnect();
	});
</script>

<svelte:window onpointermove={windowMove} onpointerup={windowUp} onpointercancel={windowUp} />

<!-- The viewer's lanes (DESIGN.md: Viewer lanes): picture, an 8px scrub bar, the takes' own sound and the song, with
     one rectangular playhead across them; the selected clip's speed ramp sits under it. -->
<div class="timeline select-none">
	{#if showZoom && rows === 'all'}
		<div class="zoom" role="group" aria-label="Timeline zoom">
			<button type="button" class="tg" onclick={() => setZoom(zoom / 1.6)} disabled={zoom <= 1} aria-label="Zoom out" title="Zoom out (⌘/Ctrl + scroll)">−</button>
			<span class="code" title="How many screens wide the cut is">{zoom < 1.05 ? 'Fit' : `${zoom.toFixed(1)}×`}</span>
			<button type="button" class="tg" onclick={() => setZoom(zoom * 1.6)} disabled={zoom >= maxZoom} aria-label="Zoom in" title="Zoom in (⌘/Ctrl + scroll, or pinch)">+</button>
		</div>
	{/if}
	<div class="frame">
		{#if rows === 'all'}
			<div class="lbs cp" aria-hidden="true">
				<span class="l-pic">Pic</span><span class="l-trk"></span>
				{#if heard}<span class="l-wav">Aud</span>{/if}
				{#if song}<span class="l-wav">Mus</span>{/if}
				{#if clips[focus]}<span class="l-spd">Spd</span>{/if}
			</div>
		{/if}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div bind:this={scroller} class="scroller" onwheel={wheel}>
		<div class="content" style:width={`${Math.max(width, total * scale)}px`}>
		<div bind:this={host} class="lanes">
			<!-- Picture: one block per clip, as long as it plays -->
			<div class="pic">
				{#each clips as clip, i (clip.id)}
					{@const left = starts[i] * scale}
					{@const w = Math.max(6, lengths[i] * scale - 2)}
					{@const moving = gesture?.kind === 'move' && gesture.clip === i && gesture.moved}
					{@const trimming = gesture?.kind === 'trim' && gesture.clip === i}
					{#if trimming}
						<!-- What the trim takes off each end -->
						<div class="ghost" style:left={`${left - clip.in * scale}px`} style:width={`${clip.in * scale}px`}></div>
						<div class="ghost" style:left={`${left + w + 2}px`} style:width={`${(clip.duration - clip.out) * scale}px`}></div>
					{/if}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class={['clip', !gesture && 'settle', moving && 'lifted']}
						data-now={i === index ? '' : undefined}
						data-focus={i === focus ? '' : undefined}
						style:left={`${left}px`}
						style:width={`${w}px`}
						style:transform={moving && gesture?.kind === 'move' ? `translateX(${gesture.dx}px)` : undefined}
						title={`${i + 1} · ${clip.title} · ${lengths[i].toFixed(1)}s${isFlat(clip.speed) ? '' : ' · ramped'}`}
						onpointerdown={(event) => blockDown(event, i)}
					>
						<div class="strip"><Filmstrip bank={clip.bank} inS={clip.in} outS={clip.out} /></div>
						<span class="num code">{i + 1}{isFlat(clip.speed) ? '' : ' ⟿'}</span>
						{#each marks[clip.id] ?? [] as mark, m (m)}
							{@const x = markX(clip, mark.at)}
							<!-- A suggested trim: the part it would cut is shaded, the new edge is a line. -->
							<div class="mark-cut" style:left={`${mark.edge === 'in' ? 0 : x}px`} style:width={`${mark.edge === 'in' ? x : Math.max(0, w - x)}px`}></div>
							<div class="mark-line" style:left={`${x - 1}px`}></div>
						{/each}
						{#if !locked}
							<div class="edge edge-in" style:width={`${EDGE}px`}></div>
							<div class="edge edge-out" style:width={`${EDGE}px`}></div>
						{/if}
					</div>
				{/each}
				{#if dropIndex !== null}<div class="drop" style:left={`${dropX}px`}></div>{/if}
			</div>

			<!-- Scrub bar: press or drag to move the playhead -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="trk" onpointerdown={seekDown}><i style:width={`${programTime * scale}px`}></i></div>

			{#if rows === 'all' && heard}
				<!-- Each take's own sound, under its clip, through its ramp -->
				<div class="wav">
					{#each clips as clip, i (clip.id)}
						{#if clip.wave}<div class="part" style:left={`${starts[i] * scale}px`} style:width={`${Math.max(2, lengths[i] * scale - 2)}px`}><Waveform peaks={clip.wave} from={clip.in} to={clip.out} speed={clip.speed} color="#45454d" /></div>{/if}
					{/each}
					<div class="played" style:width={`${programTime * scale}px`}>
						{#each clips as clip, i (clip.id)}
							{#if clip.wave}<div class="part" style:left={`${starts[i] * scale}px`} style:width={`${Math.max(2, lengths[i] * scale - 2)}px`}><Waveform peaks={clip.wave} from={clip.in} to={clip.out} speed={clip.speed} color="var(--color-teal)" /></div>{/if}
						{/each}
					</div>
				</div>
			{/if}
			{#if rows === 'all' && song}
				<!-- The song, straight through from the cut's start; its beats are the faint ticks -->
				<div class="wav" aria-label="Song waveform">
					<div class="part" style:left="0" style:width={`${total * scale}px`}><Waveform peaks={song} from={0} to={total} color="#45454d" /></div>
					<div class="played" style:width={`${programTime * scale}px`}><div class="part" style:left="0" style:width={`${total * scale}px`}><Waveform peaks={song} from={0} to={total} color="var(--color-teal)" /></div></div>
					{#each beats.filter((b) => b <= total) as b, i (i)}<i class="beat" style:left={`${b * scale}px`}></i>{/each}
				</div>
			{/if}
			<!-- Playhead -->
			<b class="head" style:left={`${programTime * scale}px`}></b>
		</div>

		{#if rows === 'all' && clips[focus]}
			<!-- The selected clip's speed ramp, under the clip (inside the scrolling content, so it stays with it) -->
			<div class="spd">
				<div class="ramp" style:left={`${starts[focus] * scale}px`} style:width={`${Math.max(60, lengths[focus] * scale - 2)}px`}>
					{#key clips[focus].id}
						<SpeedLane points={clips[focus].speed} phase={focus === index ? Math.min(1, Math.max(0, phase)) : null} onchange={(points) => onspeed(focus, points)} {locked} />
					{/key}
				</div>
			</div>
		{/if}
		</div>
		</div>
	</div>
</div>

<style>
	.timeline { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
	.zoom { display: flex; align-items: center; justify-content: flex-end; gap: 2px; }
	.code { color: var(--color-ink-3); font: 10.5px var(--font-mono); letter-spacing: 0.01em; white-space: nowrap; }
	.frame { display: flex; min-width: 0; gap: 8px; }
	.lbs { display: flex; width: 24px; flex: none; flex-direction: column; gap: 3px; color: var(--color-ink-3); }
	.lbs span { display: flex; align-items: center; }
	.l-pic { height: 40px; }
	.l-trk { height: 8px; }
	.l-wav { height: 22px; }
	.l-spd { height: 48px; }
	.scroller { min-width: 0; flex: 1; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; scrollbar-color: #26262b transparent; }
	.content { position: relative; }
	.lanes { position: relative; display: flex; flex-direction: column; gap: 3px; }
	.pic { position: relative; height: 40px; }
	.clip { position: absolute; top: 0; bottom: 0; z-index: 1; overflow: hidden; border-radius: 2px; background: var(--color-raised); cursor: grab; }
	.clip:active { cursor: grabbing; }
	.clip .strip { position: absolute; inset: 0; opacity: 0.55; pointer-events: none; }
	.clip[data-now] .strip { opacity: 1; }
	/* The selected clip: a teal rectangle at each end. */
	.clip[data-focus]::before, .clip[data-focus]::after { content: ''; position: absolute; top: 0; bottom: 0; z-index: 2; width: 3px; background: var(--color-teal); pointer-events: none; }
	.clip[data-focus]::before { left: 0; }
	.clip[data-focus]::after { right: 0; }
	.clip.lifted { z-index: 3; opacity: 0.9; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55); }
	.num { position: absolute; left: 3px; top: 2px; z-index: 2; border-radius: 2px; background: #000000b8; padding: 0 3px; color: var(--color-ink-2); pointer-events: none; }
	.clip[data-focus] .num { left: 6px; background: var(--color-teal-deep); color: var(--color-teal-ink); }
	/* After a drop or a swap the other clips slide to their new places instead of jumping. */
	.clip.settle { transition: left 180ms cubic-bezier(0.2, 0.7, 0.2, 1), width 180ms cubic-bezier(0.2, 0.7, 0.2, 1); }
	.ghost { position: absolute; top: 0; bottom: 0; border-radius: 2px; background: #7dd9c814; pointer-events: none; }
	.mark-cut { position: absolute; top: 0; bottom: 0; z-index: 2; background: #f5b84a40; pointer-events: none; }
	.mark-line { position: absolute; top: 0; bottom: 0; z-index: 2; width: 2px; background: var(--color-amber); pointer-events: none; }
	.edge { position: absolute; top: 0; bottom: 0; z-index: 3; cursor: ew-resize; }
	.edge-in { left: 0; }
	.edge-out { right: 0; }
	.edge::after { content: ''; position: absolute; top: 0; bottom: 0; width: 3px; background: var(--color-teal-ink); opacity: 0; transition: opacity 90ms ease; }
	.edge-in::after { left: 0; }
	.edge-out::after { right: 0; }
	.edge:hover::after { opacity: 1; }
	.drop { position: absolute; top: -3px; bottom: -3px; z-index: 4; width: 2px; margin-left: -1px; background: var(--color-teal); pointer-events: none; }
	.trk { position: relative; height: 8px; background: #1f1f23; cursor: ew-resize; touch-action: none; }
	.trk i { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, #123a35, #8be0c6); pointer-events: none; }
	.wav { position: relative; height: 22px; overflow: hidden; pointer-events: none; }
	.part { position: absolute; top: 0; bottom: 0; }
	.played { position: absolute; inset: 0 auto 0 0; overflow: hidden; }
	.beat { position: absolute; top: 0; bottom: 0; width: 1px; background: #ffffff26; }
	.head { position: absolute; top: -2px; bottom: -2px; z-index: 5; width: 3px; margin-left: -1px; background: #d9f7ef; pointer-events: none; }
	.spd { position: relative; min-height: 48px; margin-top: 3px; }
	.ramp { position: absolute; top: 0; }
	@media (prefers-reduced-motion: reduce) { .clip.settle, .edge::after { transition: none; } }
</style>
