<script lang="ts">
	/**
	 * The viewer (CONTEXT.md: Viewer): the full-size player that opens over the work from any shot or take.
	 * One take plays straight from its 480p proxy in a plain video element, so nothing has to be decoded
	 * into GPU memory before the first frame. Its review controls are drawn into the dock.
	 */
	import type { ProductionAsset, ProductionState, StoryCard } from '$lib/domain/schemas';
	import { pickFor, takesFor, type Take } from '$lib/domain/takes';
	import { shotCardFacts } from '$lib/domain/shot-card';
	import { REVIEW_STATUSES, step, timecode, viewerAction, type ReviewStatus } from '$lib/domain/viewer-keys';
	import { posterUrl, proxyUrl, stripUrl } from '$lib/media/gpu/clipBanks';
	import { laneFrames, stripFrameStyle, stripIndex } from '$lib/media/strips';
	import { loadPeaks, waveColumns, wavePath } from '$lib/media/waveform';
	import { noteMarks, orderedNotes, type ReviewNote } from '$lib/domain/review-notes';
	import { referenceImageUrl } from '$lib/media/reference-images';

	let { production, cards, shotId = $bindable(), busy = false, reviewHost = null, roomHref = null, notesFor = null, notesStamp = 0, rerender = null, onclose, onpick, onreview }: {
		production: ProductionState;
		/** The shots in the order the grid shows them; arrow keys walk this list. */
		cards: StoryCard[];
		shotId: string;
		busy?: boolean;
		/** Where the review controls are drawn: the dock. */
		reviewHost?: HTMLElement | null;
		/** The address of a shot's take in Review Room, when it has one there. */
		roomHref?: ((cardId: string, take: Take | null) => string | null) | null;
		/** Reads the notes reviewers left on a take's shot in Review Room. */
		notesFor?: ((take: Take) => Promise<ReviewNote[]>) | null;
		/** Changes when Review Room reports a change, so the notes on screen are read again. */
		notesStamp?: number;
		onclose: () => void;
		onpick: (cardId: string, takeId: string) => void;
		onreview: (take: ProductionAsset, change: { status?: ReviewStatus; excluded?: boolean }) => void;
		/** "Queue re-render" for a take marked Needs changes (slice 8): drawn under the review decisions. */
		rerender?: import('svelte').Snippet<[ProductionAsset]> | null;
	} = $props();

	const index = $derived(Math.max(0, cards.findIndex((card) => card.card_id === shotId)));
	const card = $derived(cards[index] ?? null);
	const takes = $derived(card ? takesFor(production, card.card_id, true) : []);
	const pick = $derived(card ? pickFor(production, card) : null);
	const facts = $derived(card ? shotCardFacts(card, production.assets, pick?.asset_id ?? null) : null);

	/** The take on screen; it follows the pick until another take is chosen for this shot. */
	let chosen = $state<{ shot: string; take: string } | null>(null);
	const shown = $derived<Take | null>((chosen?.shot === shotId ? takes.find((take) => take.asset_id === chosen!.take) : null) ?? pick ?? takes[0] ?? null);
	const shownMark = $derived(facts?.takes.find((mark) => mark.id === shown?.asset_id) ?? null);
	const reviewStatus = $derived<ReviewStatus>(facts?.status === 'approved' ? 'approved' : facts?.status === 'changes' ? 'needs_changes' : facts?.status === 'progress' ? 'in_progress' : 'awaiting_review');

	let video = $state<HTMLVideoElement | null>(null);
	let playing = $state(true);
	let rate = $state(1);
	let time = $state(0);
	let length = $state(0);
	let hover = $state<number | null>(null);
	let track = $state<HTMLElement | null>(null);
	let laneWidth = $state(0);
	/** The picture's shape (width over height), so strip frames are drawn undistorted. */
	let aspect = $state(16 / 9);

	// Lanes: the take's frame strip above the scrub bar and its own sound below, all under one playhead.
	const FRAME_LANE = 30;
	const strip = $derived(shown?.kind === 'video' ? stripUrl(shown.url) : null);
	const tiles = $derived(laneFrames(laneWidth / (FRAME_LANE * aspect)));
	const played = $derived(length ? Math.min(100, (time / length) * 100) : 0);
	// Notes from Review Room for the shot on screen: listed in the dock and marked on the scrub bar at their timecodes.
	let notes = $state<{ asset: string; list: ReviewNote[] }>({ asset: '', list: [] });
	const noteAsset = $derived(shown?.review_room?.asset_id ?? '');
	$effect(() => {
		void notesStamp;
		const take = shown, asset = noteAsset;
		if (!take || !asset || !notesFor) { if (notes.asset !== asset) notes = { asset, list: [] }; return; }
		if (notes.asset !== asset) notes = { asset, list: [] };
		void notesFor(take).then((list) => { if (noteAsset === asset) notes = { asset, list }; }).catch(() => null);
	});
	const noteList = $derived(orderedNotes(notes.list));
	const marks = $derived(noteMarks(notes.list, length));
	let sound = $state<{ take: string; path: string; columns: number } | 'none' | null>(null);
	$effect(() => {
		const take = shown?.kind === 'video' ? shown : null;
		sound = null;
		if (!take) return;
		void loadPeaks(proxyUrl(take.url)).then((peaks) => {
			if (shown?.asset_id !== take.asset_id) return;
			const columns = peaks ? waveColumns(peaks, 320) : [];
			sound = columns.length ? { take: take.asset_id, path: wavePath(columns), columns: columns.length } : 'none';
		});
	});

	const still = (take: Take) => (take.kind === 'video' ? (posterUrl(take.url, take.in_s ?? 0) ?? '') : referenceImageUrl(take.url, 'small'));

	// A new take starts from the top and plays; the next shots' proxies are fetched ahead so stepping does not wait.
	$effect(() => {
		void shown?.asset_id;
		time = 0; length = shown?.kind === 'video' ? (shown.duration_s ?? 0) : 0; rate = 1; playing = true;
	});
	$effect(() => {
		for (const neighbour of [cards[index + 1], cards[index - 1]]) {
			const take = neighbour ? pickFor(production, neighbour) : null;
			if (take?.kind === 'video') void fetch(proxyUrl(take.url)).catch(() => null);
		}
	});
	// While playing, the playhead follows the picture every frame (timeupdate alone fires a few times a second).
	$effect(() => {
		if (!video || !playing) return;
		const element = video;
		let frame = requestAnimationFrame(function tick() { time = element.currentTime; frame = requestAnimationFrame(tick); });
		return () => cancelAnimationFrame(frame);
	});
	$effect(() => {
		if (!video) return;
		video.playbackRate = rate;
		if (playing) void video.play().catch(() => { if (video && !video.muted) { video.muted = true; void video.play().catch(() => (playing = false)); } });
		else video.pause();
	});

	function showTake(by: -1 | 1) {
		if (!shown) return;
		const next = takes[step(takes.length, takes.findIndex((take) => take.asset_id === shown.asset_id), by)];
		if (next) chosen = { shot: shotId, take: next.asset_id };
	}

	function showShot(by: -1 | 1) {
		const next = cards[step(cards.length, index, by)];
		if (next) shotId = next.card_id;
	}

	function seek(to: number) {
		if (!video || !length) return;
		video.currentTime = Math.min(length, Math.max(0, to));
		time = video.currentTime;
	}

	function scrub(event: PointerEvent) {
		if (!track || !length) return;
		const box = track.getBoundingClientRect();
		const at = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * length;
		hover = at;
		if (event.buttons & 1) seek(at);
	}

	function key(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
		const action = viewerAction(event);
		if (!action) return;
		event.preventDefault();
		event.stopPropagation();
		switch (action.type) {
			case 'toggle-play': playing = !playing; break;
			case 'pause': playing = false; rate = 1; break;
			case 'forward': if (playing) rate = rate >= 2 ? 1 : 2; else playing = true; break;
			case 'back': seek(time - 1); break;
			case 'shot': showShot(action.by); break;
			case 'take': showTake(action.by); break;
			case 'pick': if (card && shown && !busy && !shown.rejected && shown.asset_id !== pick?.asset_id) onpick(card.card_id, shown.asset_id); break;
			case 'exclude': if (shown && !busy) onreview(shown, { excluded: !shown.rejected }); break;
			case 'status': if (shown && !busy && shown.review_room) onreview(shown, { status: action.status }); break;
			case 'close': onclose(); break;
		}
	}

	/** Draws the review controls at the top of the dock while the viewer is open. */
	function intoDock(node: HTMLElement, target: HTMLElement | null) {
		const place = (host: HTMLElement | null) => { if (host && node.parentNode !== host) host.prepend(node); };
		place(target);
		return { update: place, destroy: () => node.remove() };
	}
</script>

<svelte:window onkeydowncapture={key} />

<div class="viewer" role="dialog" aria-label="Viewer">
	<header>
		<button type="button" class="tg" onclick={onclose} aria-label="Close the viewer" title="Back to the shots (Esc)">←</button>
		{#if card && facts}
			<span class="code teal">{facts.number}</span>
			<h2>{card.title}</h2>
			<span class="code">{shown?.review_room?.code ? `${shown.review_room.code}_${shownMark?.label ?? ''}` : (shownMark?.label ?? '')}</span>
		{/if}
		<span class="grow"></span>
		<button type="button" class="tg" onclick={() => showShot(-1)} disabled={index === 0} aria-label="Previous shot">←</button>
		<span class="code">{index + 1} / {cards.length}</span>
		<button type="button" class="tg" onclick={() => showShot(1)} disabled={index >= cards.length - 1} aria-label="Next shot">→</button>
	</header>

	<div class="stage">
		{#if shown?.kind === 'video'}
			{#key shown.asset_id}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video bind:this={video} src={proxyUrl(shown.url)} poster={still(shown) || undefined} loop playsinline preload="auto"
					ontimeupdate={(event) => (time = event.currentTarget.currentTime)}
					onloadedmetadata={(event) => { length = event.currentTarget.duration; if (event.currentTarget.videoHeight) aspect = event.currentTarget.videoWidth / event.currentTarget.videoHeight; }}
					onclick={() => (playing = !playing)}></video>
			{/key}
		{:else if shown}
			<img src={referenceImageUrl(shown.url, 'large')} alt={card?.title ?? ''} />
		{:else}
			<p class="cp">No take yet{facts ? ` · planned ${facts.length}` : ''}</p>
		{/if}
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="scrub" bind:this={track} bind:clientWidth={laneWidth} onpointermove={scrub} onpointerdown={scrub} onpointerleave={() => (hover = null)}>
		<div class="frames" style:height={`${FRAME_LANE}px`}>
			{#if strip}{#each tiles as frame, i (i)}<i style={stripFrameStyle(strip, frame)}></i>{/each}{/if}
		</div>
		<div class="track"><i style:width={`${played}%`}></i>{#each marks as mark (mark.id)}<button type="button" class="note" class:done={mark.done} style:left={`${mark.left}%`} title={mark.title} aria-label={`Note at ${timecode(mark.at)}`} onpointerdown={(event) => event.stopPropagation()} onclick={() => seek(mark.at)}></button>{/each}</div>
		<div class="wave">
			{#if sound && sound !== 'none'}
				<svg viewBox={`0 0 ${sound.columns} 2`} preserveAspectRatio="none" aria-hidden="true"><path d={sound.path} /></svg>
				<svg class="played" viewBox={`0 0 ${sound.columns} 2`} preserveAspectRatio="none" aria-hidden="true" style:clip-path={`inset(0 ${100 - played}% 0 0)`}><path d={sound.path} /></svg>
			{:else if sound === 'none'}
				<span class="cp">No sound</span>
			{/if}
		</div>
		<b class="head" style:left={`${played}%`}></b>
		{#if hover !== null && length}
			<span class="at" style:left={`${Math.min(Math.max(hover / length * laneWidth, strip ? 80 : 30), laneWidth - (strip ? 80 : 30))}px`}>
				{#if strip}<i class="peek" style={`${stripFrameStyle(strip, stripIndex(hover, length))} aspect-ratio: ${aspect};`}></i>{/if}
				<span class="code">{timecode(hover)}</span>
			</span>
		{/if}
	</div>

	<div class="transport">
		<button type="button" class="tg" onclick={() => (playing = !playing)} disabled={shown?.kind !== 'video'}>{playing ? 'Pause' : 'Play'}</button>
		<button type="button" class="tg" aria-pressed={rate > 1} onclick={() => (rate = rate >= 2 ? 1 : 2)} disabled={shown?.kind !== 'video'}>{rate}×</button>
		<span class="tc code"><b>{timecode(time)}</b><span>/ {timecode(length)}</span></span>
		<span class="cp">{shown?.kind === 'video' ? '480p proxy' : shown ? 'Still' : ''}</span>
	</div>

	<p class="cp lab">Takes <span class="code">↑↓</span></p>
	<div class="takes">
		{#each takes as take (take.asset_id)}
			{@const mark = facts?.takes.find((item) => item.id === take.asset_id)}
			<button type="button" class="take" class:shown={take.asset_id === shown?.asset_id} class:excluded={take.rejected} onclick={() => (chosen = { shot: shotId, take: take.asset_id })} title={take.name}>
				{#if still(take)}<img src={still(take)} alt="" loading="lazy" decoding="async" />{/if}
				<span class="b"><span class="code v">{mark?.label ?? ''}</span><span class="code name">{take.name}</span><span class="cp state">{take.rejected ? 'Excluded' : mark?.pick ? 'Pick' : take.generation?.resolution === '480p' ? 'Draft' : take.kind === 'image' ? 'Still' : 'Take'}</span></span>
			</button>
		{/each}
	</div>

	<p class="cp keys"><span><b>Space</b> play</span><span><b>←→</b> shot</span><span><b>↑↓</b> take</span><span><b>J K L</b> shuttle</span><span><b>P</b> pick</span><span><b>X</b> exclude</span><span><b>1–4</b> status</span><span><b>Esc</b> close</span></p>
</div>

{#if reviewHost && card && facts}
	<div class="review" use:intoDock={reviewHost}>
		<p class="cp head"><b>Review</b><span>{facts.number}</span></p>
		<div class="statuses">
			{#each REVIEW_STATUSES as item (item.status)}
				<button type="button" class="st cp" data-status={item.status} aria-pressed={!!shown?.review_room && reviewStatus === item.status} disabled={busy || !shown?.review_room} onclick={() => shown && onreview(shown, { status: item.status })}>{item.label}<span class="code">{item.key}</span></button>
			{/each}
		</div>
		{#if shown && !shown.review_room}<p class="hint">This take is not stored in Review Room yet, so it has no review status.</p>{/if}
		<div class="row">
			<button type="button" class="key go" disabled={busy || !shown || !!shown.rejected || shown.asset_id === pick?.asset_id} onclick={() => card && shown && onpick(card.card_id, shown.asset_id)}>{shown && shown.asset_id === pick?.asset_id ? 'This is the pick' : 'Make pick'}</button>
			<button type="button" class="key" disabled={busy || !shown} onclick={() => shown && onreview(shown, { excluded: !shown.rejected })}>{shown?.rejected ? 'Restore' : 'Exclude'}</button>
		</div>
		{#if shown && rerender}{@render rerender(shown)}{/if}
		{#if shown?.review_room}
			<p class="cp">Review Room</p>
			<p class="code stored">{shown.review_room.code}_{shownMark?.label}</p>
		{/if}
		{#if noteList.length}
			<p class="cp">Notes <span class="code">{noteList.length}</span></p>
			<div class="notes">
				{#each noteList as note (note.id)}
					<button type="button" class="nt" class:done={note.completedAt !== null} title={`${note.authorName}: ${note.body}`} disabled={note.timecodeSec === null || note.timecodeSec > length + 0.05} onclick={() => note.timecodeSec !== null && seek(note.timecodeSec)}>
						<span class="code tc">{note.timecodeSec === null ? '—' : timecode(note.timecodeSec)}</span><span class="who">{note.authorName}</span><span class="body">{note.body}</span>
					</button>
				{/each}
			</div>
		{/if}
		{#if roomHref?.(card.card_id, shown)}
			<div class="row"><a class="key" href={roomHref(card.card_id, shown)} target="_blank" rel="noopener" title="Open this in Review Room, where clients review">Open in Review Room</a></div>
		{/if}
	</div>
{/if}

<style>
	.viewer { position: absolute; inset: 0; z-index: 20; display: flex; flex-direction: column; background: var(--color-panel); }
	header { display: flex; flex: none; align-items: center; gap: 8px; overflow: hidden; padding: 8px 10px 6px; white-space: nowrap; }
	h2 { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--color-ink); font-size: 13px; font-weight: 400; }
	.grow { flex: 1; }
	.code { color: var(--color-ink-3); font: 10.5px var(--font-mono); letter-spacing: 0.01em; white-space: nowrap; }
	.code.teal { color: var(--color-teal); }
	.stage { display: flex; min-height: 120px; flex: 1; align-items: center; justify-content: center; overflow: hidden; padding: 2px 14px 6px; }
	.stage video, .stage img { max-width: 100%; max-height: 100%; border-radius: 6px; background: #000; object-fit: contain; }
	.stage video { height: 100%; cursor: pointer; }
	.stage p { color: var(--color-ink-3); }
	.scrub { position: relative; display: flex; flex: none; flex-direction: column; gap: 4px; margin: 0 14px; padding: 4px 0 6px; cursor: ew-resize; touch-action: none; }
	.frames { display: flex; flex: none; overflow: hidden; border-radius: 3px; background: var(--color-raised); }
	.frames i { min-width: 0; flex: 1; background-repeat: no-repeat; opacity: 0.8; }
	.scrub:hover .frames i { opacity: 1; }
	.track { position: relative; height: 3px; flex: none; background: #1f1f23; transition: height 110ms ease-out, margin 110ms ease-out; }
	.scrub:hover .track { height: 8px; margin: -2.5px 0; }
	.track i { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, #123a35, #8be0c6); }
	/* A note from Review Room: an amber rectangle on the bar at its timecode. */
	.track .note { position: absolute; top: 50%; width: 4px; height: 12px; margin: -6px 0 0 -2px; border: 0; background: var(--color-amber); padding: 0; cursor: pointer; }
	.track .note.done { opacity: 0.4; }
	.wave { position: relative; display: flex; height: 22px; flex: none; align-items: center; }
	.wave svg { position: absolute; inset: 0; width: 100%; height: 100%; fill: #34343b; }
	.wave svg.played { fill: var(--color-teal); opacity: 0.85; }
	.wave .cp { color: var(--color-ink-3); }
	.head { position: absolute; top: 2px; bottom: 4px; width: 3px; margin-left: -1px; background: #d9f7ef; pointer-events: none; }
	.at { position: absolute; bottom: calc(100% + 2px); z-index: 2; display: flex; flex-direction: column; align-items: center; gap: 3px; transform: translateX(-50%); pointer-events: none; }
	.at .peek { display: block; width: 160px; border-radius: 4px; background-color: #000; background-repeat: no-repeat; }
	.at .code { border-radius: 3px; background: #1f1f24; padding: 1px 5px; color: var(--color-amber); }
	.transport { display: flex; flex: none; align-items: center; gap: 2px; padding: 0 10px 2px; }
	.tc { display: flex; gap: 6px; margin: 0 auto; }
	.tc b { font-weight: 400; color: var(--color-amber); }
	.transport .cp { color: var(--color-ink-3); padding: 0 6px; }
	.lab { margin: 0; flex: none; padding: 8px 14px 4px; color: var(--color-ink-3); }
	.takes { display: flex; flex: none; gap: 2px; overflow-x: auto; padding: 0 10px; scrollbar-width: none; }
	.take { display: flex; flex: none; align-items: center; gap: 8px; border: 0; border-radius: 7px; background: none; padding: 4px 10px 4px 4px; text-align: left; cursor: pointer; }
	.take.shown { background: var(--color-selected); }
	.take img { width: 92px; flex: none; aspect-ratio: 16 / 9; border-radius: 4px; object-fit: cover; }
	.take.excluded img { opacity: 0.25; }
	.take .b { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
	.take .v { color: var(--color-ink); }
	.take.shown .v { color: var(--color-teal-ink); }
	.take.excluded .v { color: var(--color-ink-3); text-decoration: line-through; }
	.take .name { max-width: 170px; overflow: hidden; text-overflow: ellipsis; }
	.take .state { color: var(--color-ink-3); }
	.take:focus-visible { outline: 2px solid var(--color-teal); outline-offset: -2px; }
	.keys { display: flex; flex: none; gap: 16px; margin: 0; overflow: hidden; padding: 10px 14px 8px; color: var(--color-ink-3); }
	.keys b { font-weight: 400; color: var(--color-ink-2); }
	.review { display: flex; flex-direction: column; gap: 6px; padding: 12px 12px 4px; color: var(--color-ink-2); font-size: 12.5px; }
	.review .cp { margin: 6px 0 0; color: var(--color-ink-3); }
	.review .head { display: flex; gap: 10px; margin: 0; }
	.review .head b { font-weight: 400; color: var(--color-teal); }
	.statuses { display: flex; flex-direction: column; }
	.st { display: flex; height: 22px; align-items: center; border: 0; border-radius: 5px; background: none; padding: 0 6px; margin: 0 !important; text-align: left; cursor: pointer; }
	.st[data-status='awaiting_review'] { color: var(--color-amber); }
	.st[data-status='in_progress'] { color: #7fb2ff; }
	.st[data-status='needs_changes'] { color: #ff7a6b; }
	.st[data-status='approved'] { color: var(--color-teal); }
	.st[aria-pressed='true'] { background: var(--color-selected); }
	.st:disabled { opacity: 0.45; cursor: default; }
	.st .code { margin-left: auto; }
	.hint { margin: 0; color: var(--color-ink-3); font-size: 12px; line-height: 1.5; }
	.row { display: flex; gap: 4px; margin-top: 4px; }
	.notes { display: flex; max-height: 132px; flex-direction: column; overflow-y: auto; }
	.nt { display: flex; height: 22px; min-width: 0; flex: none; align-items: center; gap: 8px; overflow: hidden; border: 0; border-radius: 5px; background: none; padding: 0 6px; text-align: left; white-space: nowrap; cursor: pointer; }
	.nt:hover:not(:disabled) { background: var(--color-control); }
	.nt:disabled { cursor: default; }
	.nt .tc { width: 54px; flex: none; color: var(--color-amber); }
	.nt .who { flex: none; color: var(--color-ink-3); font-size: 11.5px; }
	.nt .body { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; color: var(--color-ink-2); font-size: 12px; }
	.nt.done .body, .nt.done .tc { opacity: 0.45; }
	.stored { margin: 0; color: var(--color-ink); }
</style>
