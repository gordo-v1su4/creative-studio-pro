<script lang="ts" module>
	/**
	 * What the player plays and where its edits go. A selection (the shift-clicked beats)
	 * saves trims and ramps onto the takes themselves, as their defaults, and can be pushed
	 * into a new cut. A cut saves trims, ramps and order onto the cut only.
	 */
	/** mixUrl: play this version's built sound mix instead of the takes' own audio and the song. */
	export type PlayerSource = { kind: 'selection' } | { kind: 'cut'; cutId: string; version?: number; mixUrl?: string };
</script>

<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { CutEntry, Project } from '$lib/domain/schemas';
	import { cutVersionEntries, cutsOf, nextCutName } from '$lib/domain/cuts';
	import { isSlateId, slateUrl } from '$lib/domain/slate';
	import { attachCanvas, estimateBankBytes, getResidentBudget, loadBank, loadClipBlob, loadClipMetadata, pinBank, stripUrl, unpinBank } from '$lib/media/gpu/clipBanks';
	import { stripFrameStyle, stripIndex } from '$lib/media/strips';
	import { canOpenUnread, readTimes, unreadTimes } from '$lib/media/timeline-open';
	import { fractionAtProgram, isFlat, normalizeSpeed, programElapsed, rateAt, type SpeedPoint } from '$lib/media/speed-curve';
	import { reviewSequence } from '$lib/ui/review-sequence.svelte';
	import Timeline, { type TimelineClip } from '$lib/ui/timeline/Timeline.svelte';
	import { acceptAll, type TrimSuggestion } from '$lib/domain/trim-suggest';
	import type { MatchedEntry } from '$lib/domain/music';
	import { loadPeaks } from '$lib/media/waveform';
	import Toggle from '$lib/ui/controls/Toggle.svelte';
	import Pick from '$lib/ui/controls/Pick.svelte';

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
	let seekPreview: HTMLVideoElement;
	let previewVisible = $state(false);
	let previewSource = '';
	let previewTarget = -1;
	let previewEpoch = 0;
	let previewObjectUrl = '';
	const LOOK_AHEAD = 3;
	type Voice = { audio: HTMLAudioElement; src: string; target: number; objectUrl: string };
	const voices = new Map<string, Voice>();
	/** id is the beat for a selection, the cut entry for a cut. */
	type Clip = TimelineClip & {
		src: string; assetId: string; cardId: string; fps: number; hasAudio: boolean;
		/** Laid out from what the cut or the take already says; its file has not been read yet (see timeline-open). */
		pending?: boolean;
	};
	let clips = $state<Clip[]>([]);
	let index = $state(0);
	let playhead = $state(0);
	let paused = $state(false);
	let loading = $state(0);
	let expected = $state(0);
	/** Clips playing from what is already known while their files are still being read. */
	let unread = $state(0);
	/** Resolves when every clip's file has been read; a save waits for it so it never writes a guessed length. */
	let allRead: Promise<void> = Promise.resolve();
	/** The clip at the playhead has no frame in memory yet: its frame strip stands in for the picture. */
	let cold = $state(false);
	let error = $state('');
	let saveState = $state<'' | 'saving' | 'saved'>('');
	let scrubbing = false;
	let buffering = $state(false);
	/** Push: the name being typed (null = closed), and the last pushed cut's name. */
	let pushName = $state<string | null>(null);
	let pushing = $state(false);
	let pushed = $state('');
	/** A cut whose takes are missing plays what it can but is not saved, so nothing is dropped from it. */
	let readOnly = $state(false);

	const cut = $derived(source.kind === 'cut' ? cutsOf(project.production).find((entry) => entry.cut_id === source.cutId) : undefined);
	/** Which version is shown: the asked-for one, else the cut's current. A locked or earlier version is read-only. */
	const shownVersion = $derived(source.kind === 'cut' ? source.version ?? cut?.version ?? 1 : 0);
	const frozen = $derived(source.kind === 'cut' && !!cut && (cut.locked || shownVersion !== cut.version));

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
	const fps = $derived(current?.fps || 24);
	const frameNumber = $derived(current ? Math.floor(playhead * fps + 1e-6) : 0);
	const frameTotal = $derived(current ? Math.round(current.duration * fps) : 0);

	// --- The cut's song (V1S-126): plays from the cut's start, kept in step with the program time.
	let song: HTMLAudioElement | null = null;
	let songOn = $state(true);
	const mixUrl = $derived(source.kind === 'cut' ? source.mixUrl : undefined);
	$effect(() => {
		const url = mixUrl ?? cut?.music?.url;
		if (!url) return;
		const audio = new Audio(url);
		audio.preload = 'auto';
		song = audio;
		untrack(() => syncSong(!paused && !scrubbing && !buffering));
		return () => { audio.pause(); audio.removeAttribute('src'); audio.load(); if (song === audio) song = null; };
	});

	// Waveforms: the song lane and each take's own audio, loaded in the background.
	let songPeaks = $state<number[] | null>(null);
	let takePeaks = $state<Record<string, number[] | null>>({});
	$effect(() => {
		const url = cut?.music?.url;
		songPeaks = null;
		if (url) void loadPeaks(url).then((peaks) => { if (cut?.music?.url === url) songPeaks = peaks; });
	});
	function warmPeaks(clip: Clip) {
		if (!clip.hasAudio || clip.src in takePeaks) return;
		takePeaks[clip.src] = null;
		void loadPeaks(clip.src).then((peaks) => { takePeaks[clip.src] = peaks; });
	}
	const timelineClips = $derived(clips.map((clip) => ({ ...clip, wave: takePeaks[clip.src] ?? null })));

	function syncSong(play = !paused && !scrubbing && !buffering) {
		if (!song) return;
		if (!songOn || !clips.length || programTime >= (mixUrl ? Infinity : cut?.music?.duration_s ?? Infinity)) { song.pause(); return; }
		if (!play) { song.pause(); return; }
		if (song.paused) {
			if (Math.abs(song.currentTime - programTime) > 0.06) song.currentTime = programTime;
			void song.play().catch(() => {});
		}
	}

	function releaseVoice(voice: Voice) {
		voice.audio.pause();
		voice.audio.removeAttribute('src');
		voice.audio.load();
		if (voice.objectUrl) URL.revokeObjectURL(voice.objectUrl);
	}

	/** Set the incoming trim while the previous shot is still playing. */
	function armVoice(clip: Clip, target: number): HTMLAudioElement | undefined {
		if (mixUrl || !clip.hasAudio) return;
		let voice = voices.get(clip.id);
		if (voice?.src !== clip.src) {
			if (voice) releaseVoice(voice);
			const audio = new Audio();
			audio.preload = 'auto';
			const staged: Voice = { audio, src: clip.src, target: NaN, objectUrl: '' };
			audio.addEventListener('loadedmetadata', () => {
				if (Number.isFinite(staged.target)) seekVoice(staged);
			}, { once: true });
			voices.set(clip.id, staged);
			void loadClipBlob(clip.src).then((blob) => {
				if (voices.get(clip.id) !== staged) return;
				staged.objectUrl = URL.createObjectURL(blob);
				audio.src = staged.objectUrl;
			}).catch(() => {
				if (voices.get(clip.id) === staged) audio.src = clip.src;
			});
			voice = staged;
		}
		if (voice.target !== target) {
			voice.target = target;
			seekVoice(voice);
		}
		return voice.audio;
	}

	function seekVoice({ audio, target }: { audio: HTMLAudioElement; target: number }) {
		if (audio.readyState >= HTMLMediaElement.HAVE_METADATA && Math.abs(audio.currentTime - target) > 0.025) audio.currentTime = target;
	}

	function readyAudio(audio: HTMLAudioElement | undefined) {
		return !audio || audio.ended || !!audio.error || (!audio.seeking && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);
	}

	function syncAudio(play = !paused) {
		if (!play || scrubbing || !current) { pauseAll(); return; }
		const audio = armVoice(current, playhead);
		const music = songOn && programTime < (mixUrl ? Infinity : cut?.music?.duration_s ?? Infinity) ? song ?? undefined : undefined;
		if (music?.paused && !music.seeking && Math.abs(music.currentTime - programTime) > 0.06) {
			music.currentTime = programTime;
		}
		if (!current.bank?.frameAt(playhead) || !readyAudio(audio) || !readyAudio(music)) { holdPlayback(); return; }
		buffering = false;
		syncSong();
		if (!audio || audio.error) return;
		audio.playbackRate = rate;
		if (audio.paused) {
			voices.get(current.id)!.target = NaN;
			void audio.play().catch(() => {});
		}
	}

	function startClip(next: number) {
		if (!clips.length) return;
		pauseAll();
		index = (next + clips.length) % clips.length;
		playhead = clips[index].in;
		lastTick = performance.now();
		syncAudio();
	}

	/** Keep the playing take and the consecutive ready takes it can cut to. */
	$effect(() => {
		if (!current) return;
		const urls = new Set([current.src]);
		if (current.bank?.stats.ready) {
			for (const clip of upcoming()) {
				if (!clip.bank?.stats.ready) break;
				urls.add(clip.src);
			}
		}
		for (const src of urls) pinBank(src, MAX_HEIGHT);
		return () => { for (const src of urls) unpinBank(src, MAX_HEIGHT); };
	});

	function upcoming() {
		return Array.from({ length: Math.min(LOOK_AHEAD, clips.length - 1) }, (_, offset) => clips[(index + offset + 1) % clips.length]);
	}

	/**
	 * Long cuts can outgrow the GPU frame budget, so the least-recently-used clips are
	 * evicted (their banks stop returning frames). Warm the next cold bank in order,
	 * if it fits alongside the banks already staged for playback.
	 */
	const reloading = new Set<string>();
	function startBankLoad(clip: Clip) {
		reloading.add(clip.id);
		void loadBank(clip.src, MAX_HEIGHT)
			.then((bank) => {
				const at = clips.findIndex((entry) => entry.id === clip.id && entry.src === clip.src && entry.assetId === clip.assetId);
				if (at >= 0) clips[at] = { ...clips[at], bank };
			})
			.catch(() => { /* a later tick retries */ })
			.finally(() => reloading.delete(clip.id));
	}
	// One metadata probe per candidate and playing take, including candidates that do not fit.
	let prefetchFor = '';
	function ensureBank(i: number) {
		const clip = clips[i];
		if (!clip || reloading.size || clip.bank?.frameAt(clip.in)) return;
		if (i !== index) {
			const playing = clips[index];
			if (!playing?.bank?.stats.ready) return;
			const budget = getResidentBudget();
			if (budget) {
				const request = JSON.stringify([playing.id, playing.src, clip.id, clip.src]);
				if (prefetchFor === request) return;
				prefetchFor = request;
				void estimateBankBytes(clip.src, MAX_HEIGHT)
					.then((needed) => {
						if (clips[index]?.id !== playing.id || clips[index]?.src !== playing.src) return;
						const live = getResidentBudget();
						const banks = new Set([playing.bank, ...upcoming().flatMap((entry) => entry.bank?.stats.ready ? [entry.bank] : [])]);
						const stagedBytes = [...banks].reduce((sum, bank) => sum + (bank?.stats.bytes ?? 0), 0);
						if (!live || needed > live.limit - stagedBytes) return;
						const again = clips[i];
						if (!again || again.src !== clip.src || again.assetId !== clip.assetId || reloading.size || again.bank?.frameAt(again.in)) return;
						startBankLoad(again);
					})
					.catch(() => {});
				return;
			}
		}
		prefetchFor = '';
		startBankLoad(clip);
	}

	function holdPlayback() {
		if (!buffering) pauseAll();
		buffering = true;
	}

	function previewSeek(clip: Clip) {
		if (clip.src !== previewSource) {
			clearSeekPreview();
			previewSource = clip.src;
			previewTarget = -1;
			const epoch = previewEpoch;
			void loadClipBlob(clip.src).then((blob) => {
				if (epoch !== previewEpoch) return;
				previewObjectUrl = URL.createObjectURL(blob);
				seekPreview.src = previewObjectUrl;
			}).catch(() => {});
		}
		if (Math.abs(previewTarget - playhead) < 0.02) return;
		previewTarget = playhead;
		if (seekPreview.readyState >= HTMLMediaElement.HAVE_METADATA) seekPreview.currentTime = previewTarget;
	}

	function seekPreviewAfterMetadata() {
		if (previewSource && current?.src === previewSource) seekPreview.currentTime = previewTarget;
	}

	function showSeekPreview() {
		if (current?.src === previewSource && !current.bank?.frameAt(playhead) &&
			!seekPreview.seeking && Math.abs(seekPreview.currentTime - playhead) < 0.06) previewVisible = true;
	}

	function clearSeekPreview() {
		if (!previewSource) return;
		previewEpoch++;
		previewSource = '';
		seekPreview.removeAttribute('src');
		seekPreview.load();
		if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
		previewObjectUrl = '';
		previewVisible = false;
	}

	// Compressed proxies for the clips coming up are fetched ahead of the playhead, so a frame bank never waits on the network.
	const FETCH_AHEAD = 8;
	const fetchedAhead = new Set<string>();
	function fetchAhead() {
		for (let offset = 0; offset <= FETCH_AHEAD && offset < clips.length; offset++) {
			const src = clips[(index + offset) % clips.length].src;
			if (fetchedAhead.has(src)) continue;
			fetchedAhead.add(src);
			void loadClipBlob(src).catch(() => fetchedAhead.delete(src));
		}
	}

	/** While the clip at the playhead is still loading, the nearest frame of its strip is shown in its place. */
	const standIn = $derived.by(() => {
		const strip = cold && current ? stripUrl(current.src) : null;
		return strip && current ? stripFrameStyle(strip, stripIndex(playhead, current.duration)) : '';
	});

	/** A clip's file has been read (or could not be): settle its length, frame rate and sound in place. */
	function settleClip(waiting: Clip, metadata: { duration: number; fps: number; hasAudio: boolean } | null, fail: (title: string) => void) {
		const at = clips.findIndex((entry) => entry.pending && entry.id === waiting.id && entry.src === waiting.src);
		// Swapped for another take or dropped while it was being read: nothing to settle.
		if (at < 0) return;
		if (!metadata) {
			fail(waiting.title);
			if (clips.length < 2) return;
			const voice = voices.get(waiting.id);
			if (voice) { releaseVoice(voice); voices.delete(waiting.id); }
			clips.splice(at, 1);
			if (at < index) index -= 1;
			else if (at === index) startClip(Math.min(at, clips.length - 1));
			return;
		}
		const now = clips[at];
		clips[at] = { ...now, ...metadata, ...readTimes(now, metadata.duration, MIN_SPAN), pending: false };
		// Its sound was unknown until now; start it if this is the clip playing.
		if (at === index && metadata.hasAudio) syncAudio();
	}

	function stageUpcoming() {
		if (scrubbing) return;
		const next = upcoming();
		const staged = new Set([current?.id, ...next.map((clip) => clip.id)]);
		for (const [id, voice] of voices) {
			if (staged.has(id)) continue;
			releaseVoice(voice);
			voices.delete(id);
		}
		for (const clip of next) armVoice(clip, clip.in);
		const cold = next.find((clip) => !clip.bank?.frameAt(clip.in));
		if (cold) ensureBank(clips.indexOf(cold));
	}

	function tick(now: number) {
		const clip = clips[index];
		const ready = !!clip?.bank?.frameAt(playhead);
		if (cold !== (!!clip && !ready)) cold = !!clip && !ready;
		fetchAhead();
		if (clip && !ready) {
			if (scrubbing) previewSeek(clip);
			else ensureBank(index);
			if (!paused && !scrubbing) armVoice(clip, playhead);
			if (!paused && !scrubbing) holdPlayback();
		}
		else if (clip) stageUpcoming();
		if (clip && ready && !paused && !scrubbing) {
			const audio = voices.get(clip.id)?.audio;
			const music = songOn && programTime < (mixUrl ? Infinity : cut?.music?.duration_s ?? Infinity) ? song ?? undefined : undefined;
			if (buffering) syncAudio();
			else if (!readyAudio(audio) || !readyAudio(music)) holdPlayback();
			else {
				const elapsed = Math.min(100, Math.max(0, now - lastTick)) / 1000;
				const nextTime = programTime + elapsed;
				if (nextTime >= starts[index] + lengths[index]) advanceClip(nextTime);
				else {
					playhead = sourceTime(clip, nextTime - starts[index]);
					if (audio && !audio.paused && !audio.ended) {
						if (Math.abs(audio.playbackRate - rate) > 0.01) audio.playbackRate = rate;
						if (Math.abs(audio.currentTime - playhead) > 0.15) audio.currentTime = playhead;
					}
					if (music && !music.paused && Math.abs(music.currentTime - programTime) > 0.18) music.currentTime = programTime;
				}
			}
		}
		const visible = clips[index]?.bank;
		const resident = visible?.frameAt(Math.min(playhead, visible.duration - 1e-3));
		if (draw && resident && (!buffering || paused || scrubbing)) {
			draw(resident.view);
			clearSeekPreview();
		}
		if (clip && ready) warmPeaks(clip);
		lastTick = now;
		frame = requestAnimationFrame(tick);
	}

	function sourceTime(clip: Clip, elapsed: number) {
		const span = clip.out - clip.in;
		return clip.in + fractionAtProgram(clip.speed, span, elapsed) * span;
	}

	function advanceClip(nextTime: number) {
		voices.get(current.id)?.audio.pause();
		const next = (index + 1) % clips.length;
		if (next === 0) { startClip(0); return; }
		index = next;
		const clip = clips[next];
		// Use the pre-armed trim for audio. Video-only shots can carry the fractional tick.
		const audio = voices.get(clip.id)?.audio;
		const ready = clip.bank?.frameAt(clip.in) && readyAudio(audio);
		playhead = ready && !audio ? sourceTime(clip, nextTime - starts[next]) : clip.in;
		syncAudio();
	}

	function pauseAll() {
		for (const { audio } of voices.values()) audio.pause();
		song?.pause();
	}

	function togglePause() {
		paused = !paused;
		lastTick = performance.now();
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
		if (!scrubbing) pauseAll();
		index = i;
		playhead = Math.max(clip.in, Math.min(clip.out - 0.02, sourceTime(clip, seconds - starts[i])));
		if (!clip.bank?.frameAt(playhead)) previewSeek(clip);
		if (!scrubbing) syncAudio();
	}

	function beginSeek() {
		scrubbing = true;
		pauseAll();
	}

	function endSeek() {
		scrubbing = false;
		lastTick = performance.now();
		syncAudio();
	}

	function trim(i: number, edge: 'in' | 'out', seconds: number) {
		if (frozen) return;
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
		if (frozen) return;
		scrubbing = false;
		if (clips[index]) pruneSuggestions(clips[index].id);
		playhead = clips[index].in;
		syncAudio();
		scheduleSave();
	}

	function move(from: number, to: number) {
		if (frozen) return;
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
			const metadata = await loadClipMetadata(asset.url);
			const bank = await loadBank(asset.url, MAX_HEIGHT);
			const out = Math.min(clip.out, bank.duration);
			const voice = voices.get(clip.id);
			if (voice) { releaseVoice(voice); voices.delete(clip.id); }
			clips[i] = { ...clip, ...metadata, assetId: asset.asset_id, src: asset.url, bank, duration: bank.duration, out, in: Math.max(0, Math.min(clip.in, out - MIN_SPAN)), pending: false };
			// Suggestions were for the old take.
			const { [clip.id]: _stale, ...rest } = suggestions;
			suggestions = rest;
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
		if (voice) { releaseVoice(voice); voices.delete(gone.id); }
		startClip(Math.min(i, clips.length - 1));
		scheduleSave();
	}

	// --- Suggest trims (V1S-123): marks the operator accepts or dismisses; nothing changes a trim until then.
	let suggestions = $state<Record<string, TrimSuggestion[]>>({});
	let suggesting = $state<'' | 'running' | 'done'>('');
	let skipped = $state<string[]>([]);
	const suggestionCount = $derived(Object.values(suggestions).reduce((sum, list) => sum + list.length, 0));
	const marks = $derived(Object.fromEntries(Object.entries(suggestions).map(([id, list]) => [id, list.map((s) => ({ at: s.at_s, edge: s.edge }))])));
	const kindLabel: Record<TrimSuggestion['kind'], string> = { freeze: 'freeze', stutter: 'stutter', bad_start: 'bad start', stray_frame: 'stray frame' };

	async function suggestTrims() {
		suggesting = 'running'; error = ''; skipped = [];
		try {
			const response = await fetch(`/api/projects/${project.project_id}/cuts/suggest`, {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ entries: clips.map((clip) => ({ entry_id: clip.id, asset_id: clip.assetId, in_s: clip.in, out_s: clip.out })) })
			});
			const result = (await response.json()) as { ok: true; data: Array<{ entry_id: string; suggestions?: TrimSuggestion[]; skipped?: string }> } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			suggestions = Object.fromEntries(result.data.filter((row) => row.suggestions?.length).map((row) => [row.entry_id, row.suggestions!]));
			skipped = result.data.filter((row) => row.skipped).map((row) => `${clips.find((clip) => clip.id === row.entry_id)?.title ?? row.entry_id}: ${row.skipped}`);
			suggesting = 'done';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Suggest trims failed';
			suggesting = '';
		}
	}

	/** Drop suggestions that no longer fall inside a clip's trim (after any edit to it). */
	function pruneSuggestions(id: string) {
		const clip = clips.find((entry) => entry.id === id);
		const list = suggestions[id];
		if (!list) return;
		const kept = clip ? list.filter((s) => s.at_s > clip.in + 1e-6 && s.at_s < clip.out - 1e-6 && (s.edge === 'in' ? clip.out - s.at_s : s.at_s - clip.in) >= MIN_SPAN) : [];
		const { [id]: _gone, ...rest } = suggestions;
		suggestions = kept.length ? { ...rest, [id]: kept } : rest;
	}

	function dismissSuggestion(id: string, suggestion: TrimSuggestion) {
		const list = (suggestions[id] ?? []).filter((s) => s !== suggestion);
		const { [id]: _gone, ...rest } = suggestions;
		suggestions = list.length ? { ...rest, [id]: list } : rest;
	}

	function acceptSuggestion(i: number, suggestion: TrimSuggestion) {
		const clip = clips[i];
		const next = acceptAll({ in_s: clip.in, out_s: clip.out }, [suggestion]);
		clips[i] = { ...clip, in: next.in_s, out: next.out_s };
		dismissSuggestion(clip.id, suggestion);
		pruneSuggestions(clip.id);
		if (i === index) startClip(i);
		scheduleSave();
	}

	function acceptAllSuggestions() {
		clips = clips.map((clip) => {
			const list = suggestions[clip.id];
			if (!list?.length) return clip;
			const next = acceptAll({ in_s: clip.in, out_s: clip.out }, list);
			return { ...clip, in: next.in_s, out: next.out_s };
		});
		suggestions = {};
		suggesting = '';
		startClip(index);
		scheduleSave();
	}

	// --- Match to music (V1S-126): a preview of the proposed trims with the song underneath; saved only on keep.
	let matching = $state(false);
	let matchPreview = $state<{ before: Clip[]; report: MatchedEntry[] } | null>(null);
	let attaching = $state(false);
	const matchReport = $derived(matchPreview ? Object.fromEntries(matchPreview.report.map((r) => [r.entry_id, r])) : {});
	const matchCounts = $derived(matchPreview ? (['aligned', 'snapped', 'kept'] as const).map((mode) => `${matchPreview!.report.filter((r) => r.mode === mode).length} ${mode}`).join(' · ') : '');

	async function attachSong(file: File | undefined) {
		if (!file || source.kind !== 'cut') return;
		attaching = true; error = '';
		try {
			const query = new URLSearchParams({ cut_id: source.cutId, expected_version: String(project.version), name: file.name });
			const response = await fetch(`/api/projects/${project.project_id}/cuts/music?${query}`, { method: 'POST', headers: { 'content-type': file.type || 'audio/*' }, body: file });
			const result = (await response.json()) as { ok: true; data: Project } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			onUpdated(result.data);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Attaching the song failed'; }
		finally { attaching = false; }
	}

	async function removeSong() {
		if (source.kind !== 'cut') return;
		try { await post('cuts', { command: 'set_cut_music', expected_version: project.version, cut_id: source.cutId, music: null }); }
		catch (cause) { error = cause instanceof Error ? cause.message : 'Removing the song failed'; }
	}

	async function matchMusic() {
		if (source.kind !== 'cut' || matching) return;
		matching = true; error = '';
		try {
			await flushSave();
			const response = await fetch(`/api/projects/${project.project_id}/cuts/match`, {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ cut_id: source.cutId, entries: clips.map((clip) => ({ entry_id: clip.id, asset_id: clip.assetId, in_s: clip.in, out_s: clip.out, duration_s: clip.duration, ...(clip.speed ? { speed: clip.speed } : {}) })) })
			});
			const result = (await response.json()) as { ok: true; data: MatchedEntry[] } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			const byId = new Map(result.data.map((r) => [r.entry_id, r]));
			const before = clips.map((clip) => ({ ...clip }));
			clips = clips.map((clip) => {
				const r = byId.get(clip.id);
				if (!r) return clip;
				const out = Math.min(clip.duration, r.out_s);
				return { ...clip, in: Math.min(r.in_s, out - MIN_SPAN), out };
			});
			matchPreview = { before, report: result.data };
			suggestions = {};
			songOn = true;
			paused = false;
			startClip(0);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Match to music failed';
		} finally {
			matching = false;
		}
	}

	function keepMatch() {
		matchPreview = null;
		scheduleSave();
	}

	function undoMatch() {
		if (!matchPreview) return;
		clips = matchPreview.before;
		matchPreview = null;
		startClip(0);
	}

	function speed(i: number, points: SpeedPoint[]) {
		if (frozen) return;
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
			const clipFps = clip.fps || 24;
			const first = Math.ceil(clip.in * clipFps - 1e-6);
			const last = Math.ceil(clip.out * clipFps - 1e-6) - 1;
			if (target > last && i < clips.length - 1) { target = target - last - 1; i += 1; target += Math.ceil(clips[i].in * (clips[i].fps || 24) - 1e-6); continue; }
			if (target < first && i > 0) { const over = first - target; i -= 1; const prev = clips[i]; const prevFps = prev.fps || 24; target = Math.ceil(prev.out * prevFps - 1e-6) - over; continue; }
			index = i;
			// Land in the middle of the frame so the frame bank picks exactly that frame.
			playhead = (Math.min(last, Math.max(first, target)) + 0.5) / clipFps;
			return;
		}
	}

	const keyHints: [string, string][] = [['Space', 'play / pause'], ['← →', 'step a frame · shift 10'], ['↑ ↓', 'previous / next clip'], ['I  O', 'in / out at the playhead'], ['Esc', 'close']];

	function key(event: KeyboardEvent) {
		if (event.defaultPrevented || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
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
		if (readOnly || matchPreview) return;
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
		// Every clip's real length is in before anything is written.
		await allRead;
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
	function sources(): Array<{ id: string; cardId: string; assetId: string; title: string; src: string; in?: number; out?: number; length?: number; speed?: SpeedPoint[] }> {
		const assetOf = (id: string) => project.production.assets.find((entry) => entry.asset_id === id);
		if (source.kind === 'selection') {
			// Start from the take's saved trim and ramp; untouched takes keep their whole length at 1×.
			return reviewSequence.items.map((item) => {
				const asset = assetOf(item.assetId);
				return { id: item.id, cardId: item.id, assetId: item.assetId, title: item.title, src: item.src, in: asset?.in_s, out: asset?.out_s, length: asset?.duration_s, speed: asset?.speed };
			});
		}
		if (!cut) throw new Error('Cut not found');
		const entries = cutVersionEntries(cut, shownVersion);
		if (!entries) throw new Error(`Version ${shownVersion} of this cut is not recorded`);
		if (frozen) readOnly = true;
		const found = entries.flatMap((entry) => {
			const title = project.production.cards.find((card) => card.card_id === entry.card_id)?.title ?? entry.card_id;
			// A missing shot plays as its text card (V1S-495).
			const src = isSlateId(entry.asset_id) ? slateUrl(project.project_id, entry.card_id) : assetOf(entry.asset_id)?.url;
			return src ? [{ id: entry.entry_id, cardId: entry.card_id, assetId: entry.asset_id, title, src, in: entry.in_s, out: entry.out_s, length: assetOf(entry.asset_id)?.duration_s, speed: entry.speed }] : [];
		});
		if (found.length < entries.length) {
			readOnly = true;
			error = `${entries.length - found.length} of this cut's takes are missing; playing the rest, edits are not saved`;
		}
		return found;
	}

	onMount(() => {
		let disposed = false;
		let everyClipRead = () => {};
		allRead = new Promise<void>((resolve) => (everyClipRead = resolve));
		(async () => {
			try {
				draw = await attachCanvas(canvas!);
				const ratio = window.devicePixelRatio || 1;
				canvas!.width = Math.round(canvas!.clientWidth * ratio);
				canvas!.height = Math.round(canvas!.clientHeight * ratio);
				const items = sources();
				expected = items.length;
				const failed: string[] = [];
				// One clip that cannot be read must not stop the whole timeline from opening.
				const fail = (title: string) => {
					failed.push(title);
					readOnly = true;
					error = `${failed.length} of ${items.length} clips could not be read (${failed.slice(0, 2).join(', ')}${failed.length > 2 ? '…' : ''}); playing the rest, edits are not saved`;
				};
				// A clip whose length nothing records has to be read before the timeline can be laid out. A cut entry
				// always says where it ends, so a cut opens at once and its files are read while it plays.
				const mustRead = items.flatMap((item, at) => (canOpenUnread(item) ? [] : [at]));
				const read: Array<Clip | undefined> = new Array(items.length);
				loading = items.length - mustRead.length;
				let nextItem = 0;
				const readFirst = async () => {
					while (!disposed && nextItem < mustRead.length) {
						const at = mustRead[nextItem++];
						const item = items[at];
						const metadata = await loadClipMetadata(item.src).catch(() => null);
						if (disposed) return;
						if (metadata) {
							const out = Math.min(item.out ?? metadata.duration, metadata.duration);
							read[at] = { ...item, ...metadata, speed: item.speed, bank: null, in: Math.max(0, Math.min(item.in ?? 0, out - MIN_SPAN)), out };
						} else fail(item.title);
						loading++;
					}
				};
				await Promise.all(Array.from({ length: Math.min(6, mustRead.length) }, readFirst));
				if (disposed) return;
				const waiting: Clip[] = [];
				clips = items.flatMap((item, at): Clip[] => {
					if (read[at]) return [read[at]];
					if (!canOpenUnread(item)) return [];
					const clip: Clip = { ...item, ...unreadTimes(item, MIN_SPAN), fps: 24, hasAudio: false, speed: item.speed, bank: null, pending: true };
					waiting.push(clip);
					return [clip];
				});
				if (!clips.length) throw new Error('None of these clips could be read');
				unread = waiting.length;
				startClip(0);
				lastTick = performance.now();
				frame = requestAnimationFrame(tick);
				// The rest are read in play order, a few at a time, while the timeline already plays.
				let turn = 0;
				const readRest = async () => {
					while (!disposed && turn < waiting.length) {
						const clip = waiting[turn++];
						const metadata = await loadClipMetadata(clip.src).catch(() => null);
						if (disposed) return;
						settleClip(clip, metadata, fail);
						unread -= 1;
					}
				};
				await Promise.all(Array.from({ length: Math.min(4, waiting.length) }, readRest));
			} catch (cause) {
				error = cause instanceof Error ? cause.message : 'Sequence failed to load';
			} finally {
				everyClipRead();
			}
		})();
		return () => {
			disposed = true;
			cancelAnimationFrame(frame);
			for (const voice of voices.values()) releaseVoice(voice);
			voices.clear();
			clearSeekPreview();
			if (saveTimer) clearTimeout(saveTimer);
		};
	});
</script>

<svelte:window onkeydown={key} />

<div class="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-nr-deep/95 px-4 pb-6 pt-5 sm:px-6" role="dialog" aria-label={source.kind === 'cut' ? 'Cut player' : 'Sequence player'}>
	<div class="w-full max-w-[1320px]">
		<div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[11px] text-nr-muted">
			{#if source.kind === 'cut'}
				<span class="tracking-[.14em] text-nr-accent">CUT</span>
				<span class="text-nr-ink">{cut?.name ?? ''}</span>
				<span class={frozen ? 'text-nr-mark' : 'text-nr-muted'}>v{shownVersion}{frozen ? ' · locked' : ''}</span>
			{:else}
				<span class="tracking-[.14em] text-nr-accent">SEQUENCE</span>
			{/if}
			<span>{clips.length ? `${clips.length} ${clips.length === 1 ? "clip" : "clips"} · ${total.toFixed(2)}s` : `loading ${loading}/${expected}`}</span>
			{#if unread > 0}<span class="text-nr-faint" title="The timeline plays from what the cut already says while each file is read">reading {clips.length - unread}/{clips.length}</span>{/if}
			{#if buffering && !paused}<span role="status" class="text-nr-mark">Buffering…</span>{/if}
			<span class="text-nr-faint" title={source.kind === 'cut' ? 'Trims, ramps and order save to this cut; takes and shots are untouched' : 'Trims and ramps save to the takes'}>
				{source.kind === 'cut' ? (frozen ? 'picture locked · read-only' : readOnly ? 'read-only' : 'edits save to this cut') : 'trims save to the takes'}
			</span>
			<span class="grow"></span>
			{#if saveState}<span class="text-nr-dim">{saveState === 'saving' ? 'saving…' : 'saved'}</span>{/if}
			{#if source.kind === 'cut' && cut}
				{#if matchPreview}
					<span class="text-nr-mark" title="Previewing: nothing is saved until you keep it">matched: {matchCounts}</span>
					<button type="button" class="ctl suggest" onclick={keepMatch}>keep</button>
					<button type="button" class="ctl" onclick={undoMatch}>undo</button>
				{:else if mixUrl}
					<span class="text-nr-mark" title="The built sound mix of this locked version plays in place of the takes' own audio">♪ sound mix v{shownVersion}</span>
					<Toggle label="Play the mix" on="mix" off="mix" bind:checked={songOn} onchange={() => syncSong()} />
				{:else if cut.music}
					<span class="max-w-[220px] truncate text-nr-mark" title={`${cut.music.name} · ${cut.music.bpm} BPM · ${cut.music.duration_s.toFixed(1)}s, plays from the cut's start`}>♪ {cut.music.name} · {cut.music.bpm} BPM</span>
					<Toggle label="Play the song" on="song" off="song" bind:checked={songOn} onchange={() => syncSong()} />
					{#if !frozen && !readOnly}<button type="button" class="ctl suggest" onclick={() => void matchMusic()} disabled={matching || !clips.length} title="Slide each entry within its own footage to where its audio matches the song, keeping your order; entries that can't match confidently snap their cut to the nearest musical beat. You preview it before anything is saved.">{matching ? 'matching…' : 'match to music'}</button>{/if}
					<button type="button" class="ctl" onclick={() => void removeSong()} title="Detach the song from this cut (the file stays in the project)">remove song</button>
				{:else}
					<label class={['ctl suggest cursor-pointer', attaching && 'opacity-50']} title="Attach a song to this cut: it plays from the cut's start, and its musical-beat grid is computed for Match to music">{attaching ? 'attaching…' : 'attach song'}<input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.aif,.aiff" class="hidden" disabled={attaching} onchange={(event) => { void attachSong(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label>
				{/if}
			{/if}
			{#if source.kind === 'cut' && !readOnly && !matchPreview}
				{#if suggestionCount}
					<span class="text-nr-mark">{suggestionCount} suggested {suggestionCount === 1 ? 'trim' : 'trims'}</span>
					<button type="button" class="ctl suggest" onclick={acceptAllSuggestions}>accept all</button>
					<button type="button" class="ctl" onclick={() => { suggestions = {}; suggesting = ''; }}>dismiss all</button>
				{:else if suggesting === 'done'}
					<span class="text-nr-dim">no trims to suggest</span>
				{/if}
				<button type="button" class="ctl suggest" onclick={() => void suggestTrims()} disabled={suggesting === 'running' || !clips.length} title="Look for frozen frames, stutter, bad starts and stray frames in each entry's kept span (measured, not guessed). Nothing changes until you accept.">{suggesting === 'running' ? 'analysing…' : 'suggest trims'}</button>
			{/if}
			{#if source.kind === 'selection'}
				{#if pushName !== null}
					<!-- svelte-ignore a11y_autofocus -->
					<input class="name" bind:value={pushName} onkeydown={pushKey} aria-label="Cut name" autofocus />
					<button type="button" class="ctl push" onclick={() => void push()} disabled={pushing || !pushName.trim() || !clips.length}>{pushing ? 'pushing…' : 'push'}</button>
					<button type="button" class="ctl" onclick={() => (pushName = null)}>cancel</button>
				{:else}
					{#if pushed}<span class="text-nr-accent">pushed “{pushed}” · open it in Cuts</span>{/if}
					<button type="button" class="ctl push" onclick={() => (pushName = nextCutName(project.production))} disabled={!clips.length} title="Save this selection — order, takes, trims and ramps — as a new cut">push to cut</button>
				{/if}
			{/if}
			<button type="button" class="ctl" onclick={close} title="Close (Esc)">close</button>
		</div>

		<!-- The picture gives way to the timeline on short windows: height is capped, width follows 16:9. A cut has
		     a song lane and an entry row under the timeline, so its picture leaves room for them: the whole player
		     fits on one screen in both modes. -->
		<div class="relative mx-auto w-fit max-w-full">
			<canvas bind:this={canvas} class="block aspect-video max-w-full rounded-[3px] bg-black" style:height={`min(calc((100vw - 48px) * 0.5625), clamp(220px, calc(100dvh - ${source.kind === 'cut' ? 515 : 410}px), 670px))`} onclick={togglePause}></canvas>
			{#if standIn}<div class="pointer-events-none absolute inset-0 rounded-[3px] bg-black bg-no-repeat" style={standIn} aria-hidden="true"></div>{/if}
			<video bind:this={seekPreview} muted playsinline preload="auto" aria-hidden="true" class="pointer-events-none absolute inset-0 h-full w-full rounded-[3px] bg-black object-contain" style:visibility={previewVisible ? 'visible' : 'hidden'} onloadedmetadata={seekPreviewAfterMetadata} onseeked={showSeekPreview} onloadeddata={showSeekPreview}></video>
		</div>

		<div class="transport mt-3" role="group" aria-label="Transport">
			<button type="button" class="tkey" onclick={() => startClip(index - 1)} disabled={clips.length < 2} aria-label="Previous clip" title="Previous clip (↑)"><span class="ico skip back" aria-hidden="true"></span></button>
			<button type="button" class="tkey" onclick={() => step(-1)} disabled={!current} aria-label="Back one frame" title="Back one frame (←)"><span class="ico step back" aria-hidden="true"></span></button>
			<button type="button" class={['tkey play', !paused && 'on']} onclick={togglePause} disabled={!clips.length} aria-label={paused ? 'Play' : 'Pause'} title="Play / pause (Space)">{#if paused}<span class="ico tri" aria-hidden="true"></span>{:else}<span class="ico bars" aria-hidden="true"></span>{/if}</button>
			<button type="button" class="tkey" onclick={() => step(1)} disabled={!current} aria-label="Forward one frame" title="Forward one frame (→)"><span class="ico step" aria-hidden="true"></span></button>
			<button type="button" class="tkey" onclick={() => startClip(index + 1)} disabled={clips.length < 2} aria-label="Next clip" title="Next clip (↓)"><span class="ico skip" aria-hidden="true"></span></button>
			<span class="readout first" title="Program time / cut length"><b>{programTime.toFixed(2)}</b><i>/</i>{total.toFixed(2)}s</span>
			{#if current}
				<span class="pair"><span class="cap">clip</span><span class="readout"><b>{index + 1}</b><i>/</i>{clips.length}</span></span>
				<span class="pair" title="Frame within this clip (source frames)"><span class="cap">frame</span><span class="readout"><b>{frameNumber + 1}</b><i>/</i>{frameTotal}</span></span>
				<span class="ml-2 min-w-0 truncate text-nr-ink">{current.title}</span>
				<span class="shrink-0 text-nr-faint">in {current.in.toFixed(2)} · out {current.out.toFixed(2)}{rate > 1.001 ? ` · ${rate.toFixed(2)}×` : ''}</span>
			{/if}
		</div>

		<div class="mt-4 rounded-[3px] border border-nr-line-soft bg-nr-deep p-3">
			{#if clips.length}
				<Timeline clips={timelineClips} {index} {programTime} phase={fraction} onseek={seekProgram} onseekstart={beginSeek} onseekend={endSeek} ontrim={trim} ontrimend={trimEnd} onmove={move} onspeed={speed} {marks} locked={frozen} beats={cut?.music?.beats ?? []} song={cut?.music ? songPeaks : null} />
			{:else}
				<div class="h-[170px]"></div>
			{/if}
		</div>

		{#if source.kind === 'cut' && current}
			<!-- Editing an entry pauses playback, so the panel stays on the entry being edited. -->
			<section class="entry mt-2" aria-label="Selected entry" onpointerdown={() => { if (!paused) togglePause(); }}>
				<div class="flex flex-wrap items-center gap-2">
					<span class="tracking-[.14em] text-nr-accent">ENTRY {index + 1} / {clips.length}</span>
					<b class="text-nr-ink">{current.title}</b>
					<span class="grow"></span>
					<span title="The cut's running length, with every trim and ramp">cut length <b class="text-nr-ink">{total.toFixed(2)}s</b></span>
					<span class="flex items-center gap-1.5">take
						<Pick label="Take for this entry" value={current.assetId} options={takeChoices.map((take, i) => ({ value: take.asset_id, label: `${i + 1} · ${take.name}`, hint: take.rejected ? 'rejected' : undefined }))} onchange={(assetId) => void swapTake(index, assetId)} disabled={readOnly || swapping || takeChoices.length < 2} />
					</span>
					{#if swapping}<span class="text-nr-dim">loading…</span>{/if}
					<button type="button" class="ctl" onclick={() => dropEntry(index)} disabled={readOnly || clips.length < 2} title={clips.length < 2 ? 'A cut keeps at least one entry' : 'Remove this entry from the cut; the take stays on its beat'}>drop entry</button>
				</div>
				{#if matchReport[current.id]}
					{@const r = matchReport[current.id]}
					<p class="mt-1.5 text-nr-mark"><span class="uppercase">{r.mode}</span> <span class="text-nr-mark-dim">{r.note}</span></p>
				{/if}
				{#if suggestions[current.id]?.length}
					<ul class="mt-1.5 grid gap-1" aria-label="Suggested trims for this entry">
						{#each suggestions[current.id] as suggestion (suggestion.frames.join('-') + suggestion.edge)}
							<li class="flex flex-wrap items-center gap-2 text-nr-mark">
								<span class="uppercase">{kindLabel[suggestion.kind]}</span>
								<span class="text-nr-mark-dim">{suggestion.note}</span>
								<span>→ {suggestion.edge} {suggestion.at_s.toFixed(3)}s</span>
								<button type="button" class="ctl suggest" onclick={() => acceptSuggestion(index, suggestion)}>accept</button>
								<button type="button" class="ctl" onclick={() => dismissSuggestion(current.id, suggestion)}>dismiss</button>
							</li>
						{/each}
					</ul>
				{/if}
				<!-- Where the take came from folds away, so the player keeps the shape of the selection preview. -->
				<details class="source-details mt-1">
					<summary>{currentTake?.name ?? current.assetId} · {current.duration.toFixed(2)}s, kept {current.in.toFixed(2)}–{current.out.toFixed(2)}</summary>
					<dl class="source mt-1.5">
						<dt>full length</dt><dd>{current.duration.toFixed(2)}s{currentTake?.width ? ` · ${currentTake.width}×${currentTake.height}` : ''}</dd>
						<dt>generation</dt><dd>{#if currentTake?.job_id}{currentTake.generation?.model ?? 'job'} · {currentTake.job_id}{currentTake.generation?.resolution ? ` · ${currentTake.generation.resolution}` : ''}{currentTake.generation?.draft && !currentTake.generation.finalized_at ? ' draft' : ''}{:else}<span class="text-nr-faint">no generation job on record</span>{/if}</dd>
						<dt>prompt</dt><dd class="prompt">{#if currentTake?.generation?.prompt}{currentTake.generation.prompt}{:else if currentCard?.video_prompt}<span class="text-nr-faint">shot's video prompt:</span> {currentCard.video_prompt}{:else}<span class="text-nr-faint">none on record</span>{/if}</dd>
					</dl>
				</details>
			</section>
		{/if}

		<div class="hints mt-2" aria-label="Keys">
			{#each keyHints as [keys, what] (keys)}<span><kbd>{keys}</kbd>{what}</span>{/each}
			<span class="mouse">drag a clip edge to trim · drag a clip to move it · speed lane: click to add, double-click to remove</span>
		</div>
		{#if error}<p class="mt-1 font-mono text-[10px] text-nr-danger-text">{error}</p>{/if}
		{#if skipped.length}<p class="mt-1 font-mono text-[10px] text-nr-mark-dim">Not analysed: {skipped.join(' · ')}</p>{/if}
	</div>
</div>

<style>
	.ctl { border: 1px solid var(--color-nr-line); border-radius: 2px; background: transparent; padding: 0 8px; color: var(--color-nr-muted); font: 600 9px/20px var(--font-sans); letter-spacing: .12em; text-transform: uppercase; transition: border-color 140ms ease, color 140ms ease; }
	.ctl:hover:not(:disabled) { border-color: color-mix(in srgb, var(--color-nr-accent) 55%, transparent); color: var(--color-nr-ink); }
	.ctl:disabled { opacity: .45; }
	.transport { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: 8px; font: 11px var(--font-mono); color: var(--color-nr-muted); }
	.tkey { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 34px; height: 32px; border: 1px solid var(--color-nr-line); border-radius: 3px; background: transparent; color: var(--color-nr-muted); transition: border-color 140ms ease, color 140ms ease; }
	.tkey:hover:not(:disabled), .tkey.on { border-color: color-mix(in srgb, var(--color-nr-accent) 55%, transparent); color: var(--color-nr-accent); }
	.tkey:disabled { opacity: .35; }
	.tkey.play { width: 44px; }
	.readout { flex: none; border: 1px solid var(--color-nr-line-soft); border-radius: 3px; padding: 0 7px; color: var(--color-nr-muted); line-height: 22px; }
	.readout b { color: var(--color-nr-ink); font-weight: 500; }
	.readout i { margin: 0 3px; color: var(--color-nr-faint); font-style: normal; }
	.readout.first { margin-left: 8px; }
	.pair { display: inline-flex; flex: none; align-items: center; gap: 6px; margin-left: 6px; }
	.transport .cap { flex: none; color: var(--color-nr-faint); font: 600 9px var(--font-sans); letter-spacing: .14em; text-transform: uppercase; }
	.ico { display: block; }
	.ico.tri { width: 0; height: 0; margin-left: 2px; border-block: 5px solid transparent; border-left: 8px solid currentColor; }
	.ico.bars { width: 8px; height: 10px; border-inline: 3px solid currentColor; }
	.ico.step { width: 0; height: 0; border-block: 4px solid transparent; border-left: 6px solid currentColor; }
	.ico.step.back { border-left: 0; border-right: 6px solid currentColor; }
	.ico.skip { width: 0; height: 0; border-block: 4px solid transparent; border-left: 6px solid currentColor; box-shadow: 2px 0 0 0 currentColor; }
	.ico.skip.back { transform: scaleX(-1); }
	.hints { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; color: var(--color-nr-faint); font: 10px var(--font-sans); }
	.hints span { display: inline-flex; align-items: center; gap: 6px; }
	.hints kbd { border: 1px solid var(--color-nr-line); border-bottom-width: 2px; border-radius: 2px; padding: 0 4px; color: var(--color-nr-muted); font: 500 9px/14px var(--font-mono); white-space: pre; }
	.hints .mouse { opacity: .8; }
	.ctl.suggest { border-color: var(--color-nr-mark-line); color: var(--color-nr-mark); }
	.ctl.push { border-color: var(--color-nr-accent-deep); color: var(--color-nr-accent); }
	.source-details summary { cursor: pointer; color: var(--color-nr-faint); }
	.source-details summary:hover { color: var(--color-nr-muted); }
	.source-details .prompt { max-height: 96px; overflow: auto; }
	.entry { border: 1px solid var(--color-nr-line-soft); background: var(--color-nr-deep); padding: 6px 8px; border-radius: 3px; font: 10px var(--font-mono); color: var(--color-nr-muted); }
	.source { display: grid; grid-template-columns: 84px 1fr; gap: 2px 8px; }
	.source dt { color: var(--color-nr-faint); text-transform: uppercase; }
	.source dd { margin: 0; color: var(--color-nr-muted); overflow-wrap: anywhere; }
	.source .prompt { max-height: 3.6em; overflow-y: auto; }
	.name { width: 160px; border: 1px solid var(--color-nr-accent-deep); background: var(--color-nr-surface); padding: 2px 6px; color: var(--color-nr-ink); outline: none; border-radius: 2px; }
</style>
