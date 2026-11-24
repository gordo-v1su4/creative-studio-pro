<script lang="ts">
	/**
	 * The front door (decision 3, stories 1 to 6): one question, one input, and anything the operator has can be
	 * dropped on it: a Notion series, a show folder, pictures and clips, a song. With nothing at all, the Agent
	 * pitches. The two groups of example phrases open under the input once it has the operator's attention.
	 * What a start means is decided by `doorStart`; this screen only gathers and shows.
	 */
	import { DOOR_EXAMPLES, doorHeld, doorStart, sortDrop, type DoorStart } from '$lib/domain/front-door';
	import { droppedFiles, pickedFiles } from '$lib/ui/dropped-files';

	export type DoorFiles = { media: File[]; song: File | null };
	let { series = [], notionReady = false, templateUrl = null, busy = false, error = null, canClose = false, onStart, onClose }: {
		/** Series already connected, offered under "Notion series". */
		series?: Array<{ series_id: string; title: string }>;
		/** A Notion key is set, so a series can be read. */
		notionReady?: boolean;
		/** The public Notion template, when its address has been entered in Settings. */
		templateUrl?: string | null;
		busy?: boolean; error?: string | null;
		/** A project is open behind the door, so there is something to go back to. */
		canClose?: boolean;
		onStart: (start: DoorStart, files: DoorFiles) => void;
		onClose?: () => void;
	} = $props();

	let text = $state('');
	/** The example the text came from, while the text is still that example. */
	let example = $state<{ phrase: string; pitch: boolean } | null>(null);
	let media = $state<File[]>([]);
	let song = $state<File | null>(null);
	let texts = $state<File[]>([]);
	let link = $state('');
	let seriesId = $state('');
	let notionOpen = $state(false);
	let over = $state(false);
	let attended = $state(false);
	let said = $state('');
	let folderInput = $state<HTMLInputElement | null>(null), mediaInput = $state<HTMLInputElement | null>(null), songInput = $state<HTMLInputElement | null>(null);

	const pitchChosen = $derived(!!example?.pitch && example.phrase === text);
	const input = $derived({ text, pitch: pitchChosen, notion: link, seriesId: seriesId || undefined, seriesTitle: series.find((show) => show.series_id === seriesId)?.title, media: media.length, song: song?.name ?? null });
	// The story text is only read at the start, so until then its presence stands in for it.
	const start = $derived(doorStart({ ...input, story: texts.length ? 'held' : undefined }));
	const held = $derived(doorHeld({ media: media.length, song: song?.name ?? null, texts: texts.length, notion: !!(link.trim() || seriesId) }));
	// The examples open once the input has the operator's attention, and stay open.
	const opened = $derived(attended || !!text || media.length > 0 || !!song || texts.length > 0 || notionOpen);

	function take(files: File[]) {
		const byName = new Map(files.map((file) => [file.name, file]));
		const sorted = sortDrop(files.map((file) => file.name));
		const pick = (names: string[]) => names.map((name) => byName.get(name)!).filter(Boolean);
		media = [...media, ...pick(sorted.media)];
		if (sorted.songs.length) song = byName.get(sorted.songs[0]) ?? song;
		texts = [...texts, ...pick(sorted.texts)];
		const parts = [sorted.media.length && `${sorted.media.length} picture${sorted.media.length === 1 ? '' : 's'} or clip${sorted.media.length === 1 ? '' : 's'}`, sorted.songs.length && 'a song', sorted.texts.length && `${sorted.texts.length} text file${sorted.texts.length === 1 ? '' : 's'}`].filter(Boolean);
		said = parts.length ? `Holding ${parts.join(', ')}${sorted.other.length ? `; ${sorted.other.length} left out` : ''}` : sorted.other.length ? 'Nothing in that drop can be used here' : '';
		attended = true;
	}
	function drop(event: DragEvent) {
		over = false;
		const data = event.dataTransfer;
		if (!data) return;
		event.preventDefault();
		// A dragged link (a Notion page from the browser's address bar) is a Notion series.
		const url = data.getData('text/uri-list') || data.getData('text/plain');
		if (!data.types.includes('Files') && /^https:\/\/(www\.)?notion\.(so|site)\//i.test(url.trim())) { link = url.trim(); seriesId = ''; notionOpen = true; attended = true; return; }
		void droppedFiles(data).then(take);
	}
	function clear(kind: 'media' | 'song' | 'folder' | 'notion') {
		if (kind === 'media') media = []; else if (kind === 'song') song = null; else if (kind === 'folder') texts = []; else { link = ''; seriesId = ''; }
		said = '';
	}
	function choose(phrase: string, pitch: boolean) { text = phrase; example = { phrase, pitch }; attended = true; }

	async function go() {
		if (busy) return;
		// Text files are the story: read them in order, up to what a story source may hold.
		const story = texts.length ? (await Promise.all(texts.map(async (file) => `## ${file.name}\n\n${await file.text()}`))).join('\n\n').slice(0, 100_000) : undefined;
		onStart(doorStart({ ...input, story }), { media, song });
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="door" ondragover={(event) => { if (event.dataTransfer?.types.some((type) => type === 'Files' || type === 'text/uri-list')) { event.preventDefault(); over = true; } }} ondragleave={(event) => { if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) over = false; }} ondrop={drop}>
	<span class="cp kicker">New project</span>
	<h1>What are we making?</h1>

	<div class={['ask', over && 'over']}>
		<label class="sr" for="door-idea">Your idea, or what you have</label>
		<textarea id="door-idea" bind:value={text} rows="2" placeholder={over ? 'Drop it here' : 'Say it in a sentence, or drop in whatever you have'} disabled={busy} onfocus={() => (attended = true)} onkeydown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void go(); } }}></textarea>
		{#if notionOpen}
			<div class="notion">
				{#if series.length}<select aria-label="A series already connected" bind:value={seriesId} onchange={() => (link = '')} disabled={busy}><option value="">A connected series…</option>{#each series as show (show.series_id)}<option value={show.series_id}>{show.title}</option>{/each}</select>{/if}
				<input aria-label="Notion series link" bind:value={link} oninput={() => (seriesId = '')} placeholder="Paste the series page link" disabled={busy} />
				{#if !notionReady}<span class="cp warn" title="A series is read with your Notion key. Enter it once in Settings.">No Notion key yet</span>{/if}
			</div>
		{/if}
		<div class="r">
			<button type="button" class="tg" aria-pressed={notionOpen || !!held.notion} onclick={() => { notionOpen = !notionOpen; if (!notionOpen) clear('notion'); }} disabled={busy} title="Start from a Notion series: its story and named references are read; nothing in Notion changes">Notion series{#if held.notion}<b>{held.notion}</b>{/if}</button>
			<button type="button" class="tg" aria-pressed={!!held.folder} onclick={() => (held.folder ? clear('folder') : folderInput?.click())} disabled={busy} title={held.folder ? 'Let go of the folder’s text' : 'Pick a show folder: its text is the story, its pictures and clips become shots'}>Show folder{#if held.folder}<b>{held.folder}</b>{/if}</button>
			<button type="button" class="tg" aria-pressed={!!held.media} onclick={() => (held.media ? clear('media') : mediaInput?.click())} disabled={busy} title={held.media ? 'Let go of these files' : 'Pick pictures or clips: each becomes a shot'}>Images or video{#if held.media}<b>{held.media}</b>{/if}</button>
			<button type="button" class="tg" aria-pressed={!!held.song} onclick={() => (held.song ? clear('song') : songInput?.click())} disabled={busy} title={held.song ? 'Let go of the song' : 'Pick a song: it becomes the score cuts are made to'}>Song{#if held.song}<b>{held.song}</b>{/if}</button>
			<button type="button" class="key go sp" onclick={() => void go()} disabled={busy} title={start.way === 'pitch' ? 'The Agent pitches three loglines to react to' : start.way === 'story' ? 'The story is read, then the Agent drafts the brief' : 'The Agent drafts the brief from this'}>{busy ? 'Starting…' : start.way === 'pitch' ? 'Pitch three' : 'Start'}</button>
		</div>
		<input bind:this={folderInput} class="sr" type="file" tabindex="-1" aria-hidden="true" webkitdirectory multiple onchange={(event) => { take(pickedFiles(event.currentTarget.files)); event.currentTarget.value = ''; }} />
		<input bind:this={mediaInput} class="sr" type="file" tabindex="-1" aria-hidden="true" accept="image/*,video/*" multiple onchange={(event) => { take(pickedFiles(event.currentTarget.files)); event.currentTarget.value = ''; }} />
		<input bind:this={songInput} class="sr" type="file" tabindex="-1" aria-hidden="true" accept="audio/*" onchange={(event) => { take(pickedFiles(event.currentTarget.files)); event.currentTarget.value = ''; }} />
	</div>
	<p class={['said', error && 'bad']} aria-live="polite">{error ?? said}</p>

	<div class="ways" data-open={opened ? '' : undefined} aria-hidden={!opened} inert={!opened}>
		<div class="ways-in">
			{#each DOOR_EXAMPLES as group (group.title)}
				<div class="way">
					<span class="cp">{group.title}</span>
					{#each group.phrases as phrase (phrase)}
						<button type="button" class="ex" data-on={text === phrase ? '' : undefined} onclick={() => choose(phrase, group.pitch)} disabled={busy}>{phrase}</button>
					{/each}
					{#if group.pitch}<div class="flow cp"><b>3 loglines</b><span>→ pick one</span><span>→ teaser</span><span>→ characters</span></div>{/if}
				</div>
			{/each}
		</div>
	</div>

	<div class="foot cp">
		{#if templateUrl}<a href={templateUrl} target="_blank" rel="noopener">Notion template · view or duplicate</a>{:else}<span title="The series template has no public address yet. Enter it in Settings once it is published.">Notion template · not published yet</span>{/if}
		<a href="/settings">Notion key · Settings</a>
		{#if canClose}<button type="button" class="back" onclick={() => onClose?.()}>Back to the open project</button>{/if}
	</div>
</div>

<style>
	.door { display: flex; min-height: 100%; box-sizing: border-box; flex-direction: column; align-items: center; gap: 14px; padding: 84px 24px 20px; color: var(--color-ink-2); font: 12.5px/1.35 var(--font-sans); }
	.kicker { color: var(--color-teal); }
	h1 { margin: 0; color: var(--color-ink); font: 400 18px/1.2 var(--font-mono); letter-spacing: 0.22em; text-align: center; text-transform: uppercase; }
	.ask { display: flex; width: 100%; max-width: 600px; box-sizing: border-box; flex-direction: column; gap: 8px; margin-top: 8px; border-radius: 12px; background: var(--color-raised); padding: 12px 12px 8px; transition: background-color 150ms ease-out; }
	.ask.over { background: var(--color-selected); }
	.ask textarea { width: 100%; min-height: 54px; box-sizing: border-box; resize: none; border: 0; background: none; padding: 0; color: var(--color-ink); font: 14px/1.5 var(--font-sans); outline: none; }
	.ask textarea::placeholder { color: var(--color-ink-3); }
	.r { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
	.r .tg b { margin-left: 6px; max-width: 120px; overflow: hidden; text-overflow: ellipsis; color: var(--color-teal); font-weight: 400; text-transform: none; letter-spacing: 0.02em; }
	.sp { margin-left: auto; }
	.notion { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
	.notion select, .notion input { height: 24px; min-width: 0; flex: 1 1 180px; box-sizing: border-box; border: 0; border-radius: 5px; background: var(--color-control); padding: 0 8px; color: var(--color-ink); font: 12px var(--font-sans); outline: none; }
	.warn { color: var(--color-amber); }
	.said { min-height: 16px; max-width: 600px; margin: -6px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-ink-3); font-size: 11.5px; line-height: 16px; }
	.said.bad { color: #ff7a6b; white-space: normal; }

	/* The expand motion: the two groups open under the input, which itself does not move. */
	.ways { display: grid; width: 100%; max-width: 600px; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 180ms ease-out, opacity 180ms ease-out; }
	.ways[data-open] { grid-template-rows: 1fr; opacity: 1; }
	.ways-in { display: flex; min-height: 0; flex-wrap: wrap; gap: 3px; overflow: hidden; }
	.way { min-width: 0; flex: 1 1 260px; border-radius: 10px; background: #101012; padding: 10px 6px 8px; }
	.way > .cp { display: block; padding: 0 8px 6px; color: var(--color-ink-3); }
	.ex { display: block; width: 100%; height: 26px; overflow: hidden; border: 0; border-radius: 5px; background: none; padding: 0 8px; color: var(--color-ink-2); font: 12.5px/26px var(--font-sans); text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; transition: color 110ms ease-out; }
	.ex:hover { color: var(--color-ink); }
	.ex[data-on] { background: var(--color-selected); color: var(--color-teal-ink); }
	.ex:focus-visible, .back:focus-visible { outline: 2px solid var(--color-teal); outline-offset: -2px; }
	.flow { display: flex; gap: 10px; overflow: hidden; padding: 8px 8px 0; color: var(--color-ink-3); letter-spacing: 0.07em; }
	.flow b { color: var(--color-teal); font-weight: 400; }
	.foot { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 18px; margin-top: auto; padding-top: 16px; color: var(--color-ink-3); }
	.foot a { color: var(--color-ink-3); text-decoration: none; }
	.foot a:hover, .back:hover { color: var(--color-teal); }
	.back { border: 0; background: none; padding: 0; color: var(--color-ink-3); font: inherit; letter-spacing: inherit; text-transform: inherit; cursor: pointer; }
	.sr { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }

	@media (max-width: 640px) { .door { padding-top: 32px; } h1 { font-size: 15px; letter-spacing: 0.16em; } }
	@media (pointer: coarse) { .ex { height: 36px; line-height: 36px; } }
	@media (prefers-reduced-motion: reduce) { .ways, .ask, .ex { transition: none; } }
</style>
