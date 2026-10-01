<script lang="ts">
	import { onMount } from 'svelte';
	import type { Project } from '$lib/domain/schemas';
	import { attachCanvas, loadBank } from '$lib/media/gpu/clipBanks';
	import { fractionAtProgram, isFlat, normalizeSpeed, programElapsed, rateAt, type SpeedPoint } from '$lib/media/speed-curve';
	import { reviewSequence } from '$lib/ui/review-sequence.svelte';
	import Timeline, { type TimelineClip } from '$lib/ui/timeline/Timeline.svelte';

	/**
	 * Rough-cut review of the shift-selected clips: each clip's kept span (in → out) plays
	 * back to back in sequence order with its own sound and speed ramp, looping. Trims,
	 * ramps and order are edited on the timeline below and saved to the clips, so they
	 * carry to the cards. Keys: space pause · ←/→ one frame (shift: 10) · ↑/↓ previous/next clip ·
	 * I / O set in / out · Esc close.
	 */
	let { project, onUpdated }: { project: Project; onUpdated: (project: Project) => void } = $props();

	const MAX_HEIGHT = 288;
	const MIN_SPAN = 0.2;

	let canvas = $state<HTMLCanvasElement>();
	/** One preloaded audio element per clip, so a cut switches sound instantly instead of reloading. */
	const voices = new Map<string, HTMLAudioElement>();
	let clips = $state<Array<TimelineClip & { src: string; assetId: string }>>([]);
	let index = $state(0);
	let playhead = $state(0);
	let paused = $state(false);
	let loading = $state(0);
	let error = $state('');
	let saveState = $state<'' | 'saving' | 'saved'>('');
	let scrubbing = false;

	let draw: ((view: GPUTextureView) => void) | null = null;
	let frame = 0;
	let lastTick = 0;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	const current = $derived(clips[index]);
	const lengths = $derived(clips.map((clip) => programElapsed(clip.speed, clip.out - clip.in)));
	const starts = $derived(lengths.reduce<number[]>((acc, _l, i) => [...acc, i === 0 ? 0 : acc[i - 1] + lengths[i - 1]], []));
	const total = $derived(lengths.reduce((sum, length) => sum + length, 0));
	const fraction = $derived(current ? (playhead - current.in) / Math.max(1e-6, current.out - current.in) : 0);
	const programTime = $derived(current ? starts[index] + programElapsed(current.speed, current.out - current.in, fraction) : 0);
	const rate = $derived(current ? rateAt(current.speed, fraction) : 1);
	/** Frames per second of the playing take (from its decoded frames), for frame stepping. */
	const fps = $derived(current?.bank?.fps && current.bank.fps > 0 ? current.bank.fps : 24);
	const frameNumber = $derived(current ? Math.floor(playhead * fps + 1e-6) : 0);
	const frameTotal = $derived(current ? Math.round(current.duration * fps) : 0);

	function syncAudio(play = !paused) {
		const audio = current ? voices.get(current.id) : undefined;
		for (const [id, other] of voices) if (id !== current?.id) other.pause();
		if (!audio || !current) return;
		audio.currentTime = playhead;
		audio.playbackRate = rate;
		if (play) void audio.play().catch(() => {});
		else audio.pause();
	}

	function startClip(next: number) {
		if (!clips.length) return;
		index = (next + clips.length) % clips.length;
		playhead = clips[index].in;
		syncAudio();
	}

	function tick(now: number) {
		const clip = clips[index];
		if (clip && !paused && !scrubbing) {
			playhead += ((now - lastTick) / 1000) * rate;
			const audio = voices.get(clip.id);
			if (audio && Math.abs(audio.playbackRate - rate) > 0.01) audio.playbackRate = rate;
			if (playhead >= clip.out) startClip(index + 1);
		}
		const resident = clip?.bank?.frameAt(Math.min(playhead, clip.bank.duration - 1e-3));
		if (draw && resident) draw(resident.view);
		lastTick = now;
		frame = requestAnimationFrame(tick);
	}

	function pauseAll() {
		for (const audio of voices.values()) audio.pause();
	}

	function togglePause() {
		paused = !paused;
		syncAudio();
	}

	function close() {
		pauseAll();
		reviewSequence.playing = false;
	}

	function seekProgram(seconds: number) {
		const i = Math.max(0, starts.findLastIndex((start) => start <= seconds + 1e-9));
		const clip = clips[i];
		if (!clip) return;
		index = i;
		const span = clip.out - clip.in;
		playhead = Math.min(clip.out - 0.02, clip.in + fractionAtProgram(clip.speed, span, seconds - starts[i]) * span);
		syncAudio();
	}

	function trim(i: number, edge: 'in' | 'out', seconds: number) {
		const clip = clips[i];
		const value = edge === 'in'
			? Math.min(Math.max(0, seconds), clip.out - MIN_SPAN)
			: Math.max(Math.min(clip.duration, seconds), clip.in + MIN_SPAN);
		clips[i] = { ...clip, [edge]: Math.round(value * 100) / 100 };
		// Show the frame at the edge being trimmed.
		scrubbing = true;
		index = i;
		playhead = edge === 'in' ? clips[i].in : clips[i].out - 0.04;
		pauseAll();
	}

	function trimEnd() {
		scrubbing = false;
		playhead = clips[index].in;
		syncAudio();
		scheduleSave();
	}

	function move(from: number, to: number) {
		const next = [...clips];
		const [clip] = next.splice(from, 1);
		next.splice(to, 0, clip);
		const playing = clips[index]?.id;
		clips = next;
		index = Math.max(0, next.findIndex((c) => c.id === playing));
		// Keep the card badges in the new order.
		reviewSequence.items = next.map((c) => reviewSequence.items.find((item) => item.id === c.id)).filter((item) => item !== undefined);
	}

	function speed(i: number, points: SpeedPoint[]) {
		clips[i] = { ...clips[i], speed: isFlat(points) ? undefined : normalizeSpeed(points) };
		scheduleSave();
	}

	/** Step whole frames, pausing; crossing a clip edge continues into the neighbouring clip. */
	function step(frames: number) {
		if (!current) return;
		paused = true;
		pauseAll();
		let i = index;
		let target = Math.floor(playhead * fps + 1e-6) + frames;
		for (;;) {
			const clip = clips[i];
			const clipFps = clip.bank?.fps && clip.bank.fps > 0 ? clip.bank.fps : 24;
			const first = Math.ceil(clip.in * clipFps - 1e-6);
			const last = Math.ceil(clip.out * clipFps - 1e-6) - 1;
			if (target > last && i < clips.length - 1) { target = target - last - 1; i += 1; target += Math.ceil(clips[i].in * (clips[i].bank?.fps || 24) - 1e-6); continue; }
			if (target < first && i > 0) { const over = first - target; i -= 1; const prev = clips[i]; const prevFps = prev.bank?.fps || 24; target = Math.ceil(prev.out * prevFps - 1e-6) - over; continue; }
			index = i;
			// Land in the middle of the frame so the frame bank picks exactly that frame.
			playhead = (Math.min(last, Math.max(first, target)) + 0.5) / clipFps;
			return;
		}
	}

	function key(event: KeyboardEvent) {
		if (event.target instanceof HTMLInputElement) return;
		if (event.key === 'Escape') close();
		else if (event.key === ' ') { event.preventDefault(); togglePause(); }
		else if (event.key === 'ArrowRight') { event.preventDefault(); step(event.shiftKey ? 10 : 1); }
		else if (event.key === 'ArrowLeft') { event.preventDefault(); step(event.shiftKey ? -10 : -1); }
		else if (event.key === 'ArrowDown') { event.preventDefault(); startClip(index + 1); }
		else if (event.key === 'ArrowUp') { event.preventDefault(); startClip(index - 1); }
		else if ((event.key === 'i' || event.key === 'I') && current) { trim(index, 'in', playhead); trimEnd(); }
		else if ((event.key === 'o' || event.key === 'O') && current) { trim(index, 'out', playhead); trimEnd(); }
	}

	function scheduleSave() {
		saveState = 'saving';
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void save(), 500);
	}

	async function save() {
		const byAsset = new Map(clips.map((clip) => [clip.assetId, clip]));
		const assets = project.production.assets.map((asset) => {
			const clip = byAsset.get(asset.asset_id);
			if (!clip) return asset;
			const { speed: _old, ...rest } = asset;
			return { ...rest, in_s: clip.in, out_s: clip.out, ...(clip.speed ? { speed: clip.speed } : {}) };
		});
		try {
			const response = await fetch(`/api/projects/${project.project_id}/production`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ mode: 'save', expected_version: project.version, production: { ...project.production, assets } })
			});
			const result = (await response.json()) as { ok: true; data: Project } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			onUpdated(result.data);
			saveState = 'saved';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Save failed';
			saveState = '';
		}
	}

	onMount(() => {
		let disposed = false;
		(async () => {
			try {
				draw = await attachCanvas(canvas!);
				const ratio = window.devicePixelRatio || 1;
				canvas!.width = Math.round(canvas!.clientWidth * ratio);
				canvas!.height = Math.round(canvas!.clientHeight * ratio);
				const loaded: typeof clips = [];
				for (const item of reviewSequence.items) {
					const bank = await loadBank(item.src, MAX_HEIGHT);
					if (disposed) return;
					loading = loaded.length + 1;
					// Start from the clip's saved trim and ramp; untouched clips keep their whole length at 1×.
					const asset = project.production.assets.find((entry) => entry.asset_id === item.assetId);
					const out = Math.min(asset?.out_s ?? bank.duration, bank.duration);
					const voice = new Audio(item.src);
					voice.preload = 'auto';
					voices.set(item.id, voice);
					loaded.push({ id: item.id, title: item.title, src: item.src, assetId: item.assetId, bank, duration: bank.duration, in: Math.min(asset?.in_s ?? 0, out - MIN_SPAN), out, speed: asset?.speed });
				}
				clips = loaded;
				startClip(0);
				lastTick = performance.now();
				frame = requestAnimationFrame(tick);
			} catch (cause) {
				error = cause instanceof Error ? cause.message : 'Sequence failed to load';
			}
		})();
		return () => {
			disposed = true;
			cancelAnimationFrame(frame);
			for (const voice of voices.values()) { voice.pause(); voice.removeAttribute('src'); voice.load(); }
			voices.clear();
			if (saveTimer) clearTimeout(saveTimer);
		};
	});
</script>

<svelte:window onkeydown={key} />

<div class="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-[#050607]/95 px-6 py-4" role="dialog" aria-label="Sequence player">
	<div class="w-full max-w-[1180px]">
		<div class="mb-2 flex items-center gap-3 font-mono text-[10px] text-[#8fb3b8]">
			<span class="tracking-[.14em] text-[#99f6e4]">SEQUENCE</span>
			<span>{clips.length ? `${clips.length} clips` : `loading ${loading}/${reviewSequence.items.length}`}</span>
			<span class="grow"></span>
			{#if saveState}<span class="text-[#55747c]">{saveState === 'saving' ? 'saving…' : 'saved'}</span>{/if}
			<button type="button" class="ctl" onclick={togglePause}>{paused ? 'play' : 'pause'}</button>
			<button type="button" class="ctl" onclick={close}>close</button>
		</div>

		<!-- The picture gives way to the timeline on short windows: height is capped, width follows 16:9. -->
		<canvas bind:this={canvas} class="mx-auto block aspect-video max-w-full rounded-[3px] bg-black" style:height="min(calc((min(100vw, 1180px) - 48px) * 0.5625), calc(100vh - 330px))" onclick={togglePause}></canvas>

		<div class="mt-2 flex items-center gap-3 font-mono text-[10px] text-[#8fb3b8]">
			<span class="text-[#e6fff8]">{programTime.toFixed(2)}s</span>
			{#if current}<span class="text-[#99f6e4]" title="Frame within this clip (source frames)">frame {frameNumber + 1} / {frameTotal}</span>{/if}
			<span class="text-[#4c5b5a]">/ {total.toFixed(2)}s</span>
			{#if current}
				<span class="text-[#4c5b5a]">·</span>
				<span>{index + 1} · {current.title}</span>
				<span class="text-[#4c5b5a]">in {current.in.toFixed(2)} · out {current.out.toFixed(2)}{rate > 1.001 ? ` · ${rate.toFixed(2)}×` : ''}</span>
			{/if}
		</div>

		<div class="mt-3 rounded-[3px] border border-[#1d2528] bg-[#0b0e10] p-2">
			{#if clips.length}
				<Timeline {clips} {index} {programTime} phase={fraction} onseek={seekProgram} ontrim={trim} ontrimend={trimEnd} onmove={move} onspeed={speed} />
			{:else}
				<div class="h-[170px]"></div>
			{/if}
		</div>

		<p class="mt-2 font-mono text-[9px] text-[#4c5b5a]">space pause · ←/→ step one frame (shift: 10) · ↑/↓ previous/next clip · I / O set in / out at the playhead · drag a clip edge to trim · drag a clip to move it · click the ruler or a clip to jump · speed lane: click to add, drag, double-click to remove · esc close</p>
		{#if error}<p class="mt-1 font-mono text-[10px] text-[#e88]">{error}</p>{/if}
	</div>
</div>

<style>
	.ctl { border: 1px solid #233034; background: #0f1517; padding: 2px 8px; color: #9fc9cf; border-radius: 2px; }
	.ctl:hover { border-color: #99f6e4; color: #e6fff8; }
</style>
