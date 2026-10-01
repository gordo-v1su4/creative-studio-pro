<script lang="ts" module>
	/**
	 * What the player plays and where its edits go. A selection (the shift-clicked beats)
	 * saves trims and ramps onto the takes themselves, as their defaults, and can be pushed
	 * into a new cut. A cut saves trims, ramps and order onto the cut only.
	 */
	export type PlayerSource = { kind: 'selection' } | { kind: 'cut'; cutId: string };
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import type { CutEntry, Project } from '$lib/domain/schemas';
	import { cutsOf, nextCutName } from '$lib/domain/cuts';
	import { attachCanvas, loadBank } from '$lib/media/gpu/clipBanks';
	import { fractionAtProgram, isFlat, normalizeSpeed, programElapsed, rateAt, type SpeedPoint } from '$lib/media/speed-curve';
	import { reviewSequence } from '$lib/ui/review-sequence.svelte';
	import Timeline, { type TimelineClip } from '$lib/ui/timeline/Timeline.svelte';

	/**
	 * Rough-cut review of a selection or a cut: each clip's kept span (in → out) plays
	 * back to back in order with its own sound and speed ramp, looping. Trims, ramps and
	 * order are edited on the timeline below and saved per the source (see PlayerSource).
	 * Keys: space pause · ←/→ one frame (shift: 10) · ↑/↓ previous/next clip ·
	 * I / O set in / out · Esc close.
	 */
	let { project, onUpdated, source = { kind: 'selection' }, onclose }: {
		project: Project; onUpdated: (project: Project) => void; source?: PlayerSource; onclose?: () => void
	} = $props();

	const MAX_HEIGHT = 288;
	const MIN_SPAN = 0.2;

	let canvas = $state<HTMLCanvasElement>();
	/** One preloaded audio element per clip, so a cut switches sound instantly instead of reloading. */
	const voices = new Map<string, HTMLAudioElement>();
	/** id is the beat for a selection, the cut entry for a cut. */
	type Clip = TimelineClip & { src: string; assetId: string; cardId: string };
	let clips = $state<Clip[]>([]);
	let index = $state(0);
	let playhead = $state(0);
	let paused = $state(false);
	let loading = $state(0);
	let expected = $state(0);
	let error = $state('');
	let saveState = $state<'' | 'saving' | 'saved'>('');
	let scrubbing = false;
	/** Push: the name being typed (null = closed), and the last pushed cut's name. */
	let pushName = $state<string | null>(null);
	let pushing = $state(false);
	let pushed = $state('');
	/** A cut whose takes are missing plays what it can but is not saved, so nothing is dropped from it. */
	let readOnly = $state(false);

	const cut = $derived(source.kind === 'cut' ? cutsOf(project.production).find((entry) => entry.cut_id === source.cutId) : undefined);

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
		if (source.kind === 'selection') reviewSequence.playing = false;
		onclose?.();
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
		// A cut keeps its order; a selection's order lives in the card badges.
		if (source.kind === 'cut') scheduleSave();
		else reviewSequence.items = next.map((c) => reviewSequence.items.find((item) => item.id === c.id)).filter((item) => item !== undefined);
	}

	// --- Cut editing beyond trims (V1S-122): swap an entry's take, drop an entry, see where it came from.
	let swapping = $state(false);
	const assetOf = (id: string) => project.production.assets.find((entry) => entry.asset_id === id);
	/** Live video takes of the selected entry's beat, the one in use first among equals by creation order. */
	const takeChoices = $derived(current ? project.production.assets.filter((asset) => asset.card_id === current.cardId && asset.kind === 'video' && (!asset.rejected || asset.asset_id === current.assetId)) : []);
	const currentTake = $derived(current ? assetOf(current.assetId) : undefined);
	const currentCard = $derived(current ? project.production.cards.find((card) => card.card_id === current.cardId) : undefined);

	/** Put another take of the same beat in this entry's place; its trim and ramp stay, clamped to the new take's length. */
	async function swapTake(i: number, assetId: string) {
		const clip = clips[i];
		const asset = assetOf(assetId);
		if (!clip || !asset || asset.asset_id === clip.assetId || swapping) return;
		swapping = true; error = '';
		try {
			const bank = await loadBank(asset.url, MAX_HEIGHT);
			const out = Math.min(clip.out, bank.duration);
			voices.get(clip.id)?.pause();
			const voice = new Audio(asset.url);
			voice.preload = 'auto';
			voices.set(clip.id, voice);
			clips[i] = { ...clip, assetId: asset.asset_id, src: asset.url, bank, duration: bank.duration, out, in: Math.min(clip.in, out - MIN_SPAN) };
			if (i === index) startClip(i);
			scheduleSave();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'That take failed to load';
		} finally {
			swapping = false;
		}
	}

	/** Remove an entry from the cut (the take itself stays on its beat). A cut keeps at least one entry. */
	function dropEntry(i: number) {
		if (clips.length < 2) return;
		const [gone] = clips.splice(i, 1);
		const voice = voices.get(gone.id);
		if (voice) { voice.pause(); voice.removeAttribute('src'); voice.load(); voices.delete(gone.id); }
		startClip(Math.min(i, clips.length - 1));
		scheduleSave();
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
		if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
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
		if (readOnly) return;
		saveState = 'saving';
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void save(), 500);
	}

	/** Write any pending edit now (before a push, so it carries the same version). */
	async function flushSave() {
		if (!saveTimer || saveState !== 'saving') return;
		clearTimeout(saveTimer);
		saveTimer = null;
		await save();
	}

	async function post(path: string, body: Record<string, unknown>): Promise<Project> {
		const response = await fetch(`/api/projects/${project.project_id}/${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const result = (await response.json()) as { ok: true; data: Project } | { ok: false; error: { message: string } };
		if (!result.ok) throw new Error(result.error.message);
		onUpdated(result.data);
		return result.data;
	}

	/** The clips as cut entries: their order, takes, trims and ramps. */
	const entriesOf = (list: Clip[]) => list.map((clip) => ({
		card_id: clip.cardId, asset_id: clip.assetId, in_s: clip.in, out_s: clip.out, ...(clip.speed ? { speed: clip.speed } : {})
	}));

	async function save() {
		saveTimer = null;
		try {
			if (source.kind === 'cut') {
				const entries: CutEntry[] = entriesOf(clips).map((entry, i) => ({ entry_id: clips[i].id, ...entry }));
				await post('cuts', { command: 'edit_cut', expected_version: project.version, cut_id: source.cutId, entries });
			} else {
				// A selection's trims and ramps are the takes' own defaults.
				const byAsset = new Map(clips.map((clip) => [clip.assetId, clip]));
				const assets = project.production.assets.map((asset) => {
					const clip = byAsset.get(asset.asset_id);
					if (!clip) return asset;
					const { speed: _old, ...rest } = asset;
					return { ...rest, in_s: clip.in, out_s: clip.out, ...(clip.speed ? { speed: clip.speed } : {}) };
				});
				await post('production', { mode: 'save', expected_version: project.version, production: { ...project.production, assets } });
			}
			saveState = 'saved';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Save failed';
			saveState = '';
		}
	}

	async function push() {
		const name = pushName?.trim();
		if (!name || pushing) return;
		pushing = true;
		error = '';
		try {
			await flushSave();
			await post('cuts', { command: 'push_cut', expected_version: project.version, name, entries: entriesOf(clips) });
			pushed = name;
			pushName = null;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Push failed';
		} finally {
			pushing = false;
		}
	}

	function pushKey(event: KeyboardEvent) {
		if (event.key === 'Enter') { event.preventDefault(); void push(); }
		else if (event.key === 'Escape') { event.preventDefault(); pushName = null; }
	}

	/** What to load: each clip's beat, take and starting trim and ramp. */
	function sources(): Array<{ id: string; cardId: string; assetId: string; title: string; src: string; in?: number; out?: number; speed?: SpeedPoint[] }> {
		const assetOf = (id: string) => project.production.assets.find((entry) => entry.asset_id === id);
		if (source.kind === 'selection') {
			// Start from the take's saved trim and ramp; untouched takes keep their whole length at 1×.
			return reviewSequence.items.map((item) => {
				const asset = assetOf(item.assetId);
				return { id: item.id, cardId: item.id, assetId: item.assetId, title: item.title, src: item.src, in: asset?.in_s, out: asset?.out_s, speed: asset?.speed };
			});
		}
		if (!cut) throw new Error('Cut not found');
		const found = cut.entries.flatMap((entry) => {
			const asset = assetOf(entry.asset_id);
			const title = project.production.cards.find((card) => card.card_id === entry.card_id)?.title ?? entry.card_id;
			return asset ? [{ id: entry.entry_id, cardId: entry.card_id, assetId: entry.asset_id, title, src: asset.url, in: entry.in_s, out: entry.out_s, speed: entry.speed }] : [];
		});
		if (found.length < cut.entries.length) {
			readOnly = true;
			error = `${cut.entries.length - found.length} of this cut's takes are missing; playing the rest, edits are not saved`;
		}
		return found;
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
				const items = sources();
				expected = items.length;
				for (const item of items) {
					const bank = await loadBank(item.src, MAX_HEIGHT);
					if (disposed) return;
					loading = loaded.length + 1;
					const out = Math.min(item.out ?? bank.duration, bank.duration);
					const voice = new Audio(item.src);
					voice.preload = 'auto';
					voices.set(item.id, voice);
					loaded.push({ id: item.id, title: item.title, src: item.src, assetId: item.assetId, cardId: item.cardId, bank, duration: bank.duration, in: Math.min(item.in ?? 0, out - MIN_SPAN), out, speed: item.speed });
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

<div class="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-[#050607]/95 px-6 py-4" role="dialog" aria-label={source.kind === 'cut' ? 'Cut player' : 'Sequence player'}>
	<div class="w-full max-w-[1180px]">
		<div class="mb-2 flex items-center gap-3 font-mono text-[10px] text-[#8fb3b8]">
			{#if source.kind === 'cut'}
				<span class="tracking-[.14em] text-[#99f6e4]">CUT</span>
				<span class="text-[#e6fff8]">{cut?.name ?? ''}</span>
			{:else}
				<span class="tracking-[.14em] text-[#99f6e4]">SEQUENCE</span>
			{/if}
			<span>{clips.length ? `${clips.length} ${clips.length === 1 ? "clip" : "clips"} · ${total.toFixed(2)}s` : `loading ${loading}/${expected}`}</span>
			<span class="text-[#4c5b5a]" title={source.kind === 'cut' ? 'Trims, ramps and order save to this cut; takes and beats are untouched' : 'Trims and ramps save to the takes'}>
				{source.kind === 'cut' ? (readOnly ? 'read-only' : 'edits save to this cut') : 'trims save to the takes'}
			</span>
			<span class="grow"></span>
			{#if saveState}<span class="text-[#55747c]">{saveState === 'saving' ? 'saving…' : 'saved'}</span>{/if}
			{#if source.kind === 'selection'}
				{#if pushName !== null}
					<!-- svelte-ignore a11y_autofocus -->
					<input class="name" bind:value={pushName} onkeydown={pushKey} aria-label="Cut name" autofocus />
					<button type="button" class="ctl push" onclick={() => void push()} disabled={pushing || !pushName.trim() || !clips.length}>{pushing ? 'pushing…' : 'push'}</button>
					<button type="button" class="ctl" onclick={() => (pushName = null)}>cancel</button>
				{:else}
					{#if pushed}<span class="text-[#99f6e4]">pushed “{pushed}” · open it in Cuts</span>{/if}
					<button type="button" class="ctl push" onclick={() => (pushName = nextCutName(project.production))} disabled={!clips.length} title="Save this selection — order, takes, trims and ramps — as a new cut">push to cut</button>
				{/if}
			{/if}
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

		{#if source.kind === 'cut' && current}
			<!-- Editing an entry pauses playback, so the panel stays on the entry being edited. -->
			<section class="entry mt-2" aria-label="Selected entry" onpointerdown={() => { if (!paused) togglePause(); }}>
				<div class="flex flex-wrap items-center gap-2">
					<span class="tracking-[.14em] text-[#99f6e4]">ENTRY {index + 1} / {clips.length}</span>
					<b class="text-[#e6fff8]">{current.title}</b>
					<span class="grow"></span>
					<span title="The cut's running length, with every trim and ramp">cut length <b class="text-[#e6fff8]">{total.toFixed(2)}s</b></span>
					<label class="flex items-center gap-1">take
						<select class="pick" value={current.assetId} onchange={(event) => void swapTake(index, event.currentTarget.value)} disabled={readOnly || swapping || takeChoices.length < 2} aria-label="Take for this entry">
							{#each takeChoices as take, i (take.asset_id)}<option value={take.asset_id}>{i + 1} · {take.name}{take.rejected ? ' (rejected)' : ''}</option>{/each}
						</select>
					</label>
					{#if swapping}<span class="text-[#55747c]">loading…</span>{/if}
					<button type="button" class="ctl" onclick={() => dropEntry(index)} disabled={readOnly || clips.length < 2} title={clips.length < 2 ? 'A cut keeps at least one entry' : 'Remove this entry from the cut; the take stays on its beat'}>drop entry</button>
				</div>
				<dl class="source mt-1.5">
					<dt>take</dt><dd>{currentTake?.name ?? current.assetId}</dd>
					<dt>full length</dt><dd>{current.duration.toFixed(2)}s · kept {current.in.toFixed(2)}–{current.out.toFixed(2)}{currentTake?.width ? ` · ${currentTake.width}×${currentTake.height}` : ''}</dd>
					<dt>generation</dt><dd>{#if currentTake?.job_id}{currentTake.generation?.model ?? 'job'} · {currentTake.job_id}{currentTake.generation?.resolution ? ` · ${currentTake.generation.resolution}` : ''}{currentTake.generation?.draft && !currentTake.generation.finalized_at ? ' draft' : ''}{:else}<span class="text-[#4c5b5a]">no generation job on record</span>{/if}</dd>
					<dt>prompt</dt><dd class="prompt">{#if currentTake?.generation?.prompt}{currentTake.generation.prompt}{:else if currentCard?.video_prompt}<span class="text-[#4c5b5a]">beat's video prompt:</span> {currentCard.video_prompt}{:else}<span class="text-[#4c5b5a]">none on record</span>{/if}</dd>
				</dl>
			</section>
		{/if}

		<p class="mt-2 font-mono text-[9px] text-[#4c5b5a]">space pause · ←/→ step one frame (shift: 10) · ↑/↓ previous/next clip · I / O set in / out at the playhead · drag a clip edge to trim · drag a clip to move it · click the ruler or a clip to jump · speed lane: click to add, drag, double-click to remove · esc close</p>
		{#if error}<p class="mt-1 font-mono text-[10px] text-[#e88]">{error}</p>{/if}
	</div>
</div>

<style>
	.ctl { border: 1px solid #233034; background: #0f1517; padding: 2px 8px; color: #9fc9cf; border-radius: 2px; }
	.ctl:hover { border-color: #99f6e4; color: #e6fff8; }
	.ctl:disabled { opacity: .45; }
	.ctl.push { border-color: #2f6f6a; color: #99f6e4; }
	.entry { border: 1px solid #1d2528; background: #0b0e10; padding: 6px 8px; border-radius: 3px; font: 10px var(--font-mono); color: #8fb3b8; }
	.pick { max-width: 260px; border: 1px solid #233034; background: #0f1517; padding: 1px 4px; color: #e6fff8; border-radius: 2px; }
	.source { display: grid; grid-template-columns: 84px 1fr; gap: 2px 8px; }
	.source dt { color: #4c5b5a; text-transform: uppercase; }
	.source dd { margin: 0; color: #9fc9cf; overflow-wrap: anywhere; }
	.source .prompt { max-height: 3.6em; overflow-y: auto; }
	.name { width: 160px; border: 1px solid #2f6f6a; background: #0b1113; padding: 2px 6px; color: #e6fff8; outline: none; border-radius: 2px; }
</style>
