<script lang="ts">
	/**
	 * References in the right-hand drawer (V1S-326): the series' reference images by kind. Characters show only the
	 * headshot, three across: the left panel of a ONE SHOT sheet (the straight-on face close-up, a third of the
	 * width), cropped to the same frame for every character. Places and props show their picture two across.
	 * Click a picture to see the whole sheet big. Drag one onto a shot to attach it (a chip appears on the
	 * shot), or attach it to the selected shot. "Upload" sends one vetted image to the series' Review Room
	 * `_References`; nothing is copied anywhere else.
	 */
	type Ref = { page_id: string; name: string; kind: string; handles: string[]; file_name: string; name_on_sheet: boolean };
	type RefFile = { width: number; height: number; file_name: string };
	let {
		seriesId, references, files, selectedTitle = null, onAttach, onUploaded
	}: {
		seriesId: string;
		references: Ref[];
		files: Record<string, RefFile>;
		/** The selected shot, if any: "Attach" adds the reference to it. */
		selectedTitle?: string | null;
		onAttach?: (pageId: string) => void;
		onUploaded?: () => void;
	} = $props();

	const REFERENCE_DRAG = 'application/x-csp-reference';
	const KINDS = ['Character', 'Location', 'Prop'] as const;
	const kindOf = (kind: string) => KINDS.find((entry) => entry.toLowerCase() === kind.trim().toLowerCase().replace(/s$/, '')) ?? 'Other';
	let groups = $derived([...KINDS, 'Other'].map((kind) => ({ kind, items: references.filter((ref) => kindOf(ref.kind) === kind) })).filter((group) => group.items.length));
	let uploading = $state<string | null>(null);
	/** The sheet shown big (click a card's picture; Esc or a click closes it). */
	let zoom = $state<{ src: string; alt: string } | null>(null);
	const src = (pageId: string) => `/api/series/${seriesId}/references?page_id=${pageId}`;
	let error = $state<string | null>(null);

	async function upload(ref: Ref, file: File) {
		uploading = ref.page_id; error = null;
		try {
			const form = new FormData();
			form.set('page_id', ref.page_id);
			form.set('file', file);
			const body = (await (await fetch(`/api/series/${seriesId}/references`, { method: 'POST', body: form })).json()) as { ok: boolean; error?: { message: string } };
			if (!body.ok) throw new Error(body.error?.message ?? 'Upload failed');
			onUploaded?.();
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Upload failed'; }
		finally { uploading = null; }
	}
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape') zoom = null; }} />
{#if zoom}
	<button type="button" class="zoom" onclick={() => (zoom = null)} aria-label="Close the big picture">
		<img src={zoom.src} alt={zoom.alt} />
		<span class="zoom-cap">{zoom.alt} · click or Esc to close</span>
	</button>
{/if}
<section class="refs" aria-label="References">
	<div class="meta-label">References</div>
	{#if references.length === 0}
		<p class="hint">No references in this series yet. Add them to the References database in Notion, then re-check the series.</p>
	{/if}
	{#each groups as group (group.kind)}
		<div class="kind">{group.kind === 'Other' ? 'No kind' : `${group.kind}s`}</div>
		<ul class={group.kind === 'Character' ? 'faces' : 'places'}>
			{#each group.items as ref (ref.page_id)}
				{@const file = files[ref.page_id]}
				<li
					draggable="true"
					ondragstart={(event) => { event.dataTransfer?.setData(REFERENCE_DRAG, ref.page_id); event.dataTransfer!.effectAllowed = 'copy'; }}
					title={`${ref.name}${ref.handles.length ? ` · ${ref.handles.join(' ')}` : ''} — drag onto a shot`}
				>
					{#if file}
						<button type="button" class={['thumb', group.kind === 'Character' ? 'head' : 'wide']} onclick={() => (zoom = { src: src(ref.page_id), alt: ref.name })} aria-label={`Show ${ref.name}'s sheet big`}>
							<img src={src(ref.page_id)} alt={ref.name} loading="lazy" draggable="false" />
						</button>
					{:else}
						<span class="thumb empty">no image</span>
					{/if}
					<span class="info">
						<b>{ref.name}</b>
						<span class="sub">{ref.handles.join(' ') || 'no handle'}</span>
						{#if !ref.name_on_sheet}<span class="warn" title="The send gate refuses it until the name is printed on the sheet and ticked in Notion">name not on sheet</span>{/if}
					</span>
					<span class="actions">
						{#if selectedTitle && onAttach}
							<button type="button" class="mini" onclick={() => onAttach?.(ref.page_id)} title={`Attach to ${selectedTitle}`}>Attach</button>
						{/if}
						<label class="mini" title="Upload the vetted image to Review Room _References (file name must contain the exact name; at least 2K)">
							{uploading === ref.page_id ? '…' : file ? 'Replace' : 'Upload'}
							<input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" disabled={uploading !== null} onchange={(event) => { const input = event.currentTarget as HTMLInputElement; const chosen = input.files?.[0]; input.value = ''; if (chosen) void upload(ref, chosen); }} />
						</label>
					</span>
				</li>
			{/each}
		</ul>
	{/each}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
	.refs { display: grid; gap: 6px; margin-bottom: 14px; }
	.hint { color: var(--color-text-dim); font-size: 11px; line-height: 1.5; }
	.kind { margin-top: 4px; color: var(--color-text-dim); font: 600 9px var(--font-mono); text-transform: uppercase; letter-spacing: 0.1em; }
	ul { display: grid; gap: 6px; }
	ul.faces { grid-template-columns: repeat(3, minmax(0, 1fr)); }
	ul.places { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	/* A card per reference: its picture, then its name and actions under it. */
	li { display: grid; gap: 4px; align-content: start; min-width: 0; border: 1px solid var(--color-border-subtle); padding: 4px; cursor: grab; }
	li:hover { border-color: var(--color-border-default); }
	.thumb { display: block; width: 100%; overflow: hidden; border: 0; padding: 0; background: var(--color-surface-base); cursor: zoom-in; }
	/* The headshot: the whole left panel of the sheet (its left third, top to bottom), same frame for everyone. */
	.thumb.head { aspect-ratio: 9 / 16; }
	.thumb.head img { display: block; width: 300%; max-width: none; height: auto; }
	.thumb.wide { aspect-ratio: 16 / 9; }
	.thumb.wide img { display: block; width: 100%; height: 100%; object-fit: cover; }
	.thumb.empty { aspect-ratio: 9 / 16; display: grid; place-items: center; color: var(--color-text-dim); font: 600 8px var(--font-mono); text-transform: uppercase; text-align: center; cursor: grab; }
	.info { display: grid; min-width: 0; }
	.info b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--color-text-primary); }
	.zoom { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; gap: 8px; border: 0; background: rgb(5 7 10 / 0.92); padding: 24px; cursor: zoom-out; }
	.zoom img { max-width: 100%; max-height: calc(100vh - 80px); object-fit: contain; }
	.zoom-cap { color: var(--color-text-dim); font: 11px var(--font-mono); }
	.sub { color: var(--color-text-dim); font: 10px var(--font-mono); }
	.warn { color: var(--color-gate-pending); font: 600 9px var(--font-mono); text-transform: uppercase; }
	.actions { display: flex; flex-wrap: wrap; gap: 2px; }
	.mini { border: 1px solid var(--color-border-default); background: transparent; padding: 1px 5px; color: var(--color-text-dim); font: 600 9px var(--font-mono); text-transform: uppercase; cursor: pointer; }
	.mini:hover { color: var(--color-text-primary); }
	.error { color: var(--color-gate-failed); font-size: 11px; }
</style>
