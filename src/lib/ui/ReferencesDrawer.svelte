<script lang="ts">
	/**
	 * References in the right-hand drawer (V1S-326): the series' reference images by kind (characters show a
	 * headshot cropped from the top of the sheet). Drag one onto a shot to attach it (a chip appears on the
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

<section class="refs" aria-label="References">
	<div class="meta-label">References</div>
	{#if references.length === 0}
		<p class="hint">No references in this series yet. Add them to the References database in Notion, then re-check the series.</p>
	{/if}
	{#each groups as group (group.kind)}
		<div class="kind">{group.kind === 'Other' ? 'No kind' : `${group.kind}s`}</div>
		<ul>
			{#each group.items as ref (ref.page_id)}
				{@const file = files[ref.page_id]}
				<li
					draggable="true"
					ondragstart={(event) => { event.dataTransfer?.setData(REFERENCE_DRAG, ref.page_id); event.dataTransfer!.effectAllowed = 'copy'; }}
					title={`${ref.name}${ref.handles.length ? ` · ${ref.handles.join(' ')}` : ''} — drag onto a shot`}
				>
					{#if file}
						<img src={`/api/series/${seriesId}/references?page_id=${ref.page_id}`} alt={ref.name} class={['thumb', group.kind === 'Character' && 'headshot']} loading="lazy" />
					{:else}
						<span class="thumb empty">no image</span>
					{/if}
					<span class="info">
						<b>{ref.name}</b>
						<span class="sub">{ref.handles.join(' ') || 'no handle'}{file ? ` · ${file.width}×${file.height}` : ''}</span>
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
	ul { display: grid; gap: 4px; }
	li { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 8px; align-items: center; border: 1px solid var(--color-border-subtle); padding: 3px; cursor: grab; }
	li:hover { border-color: var(--color-border-default); }
	.thumb { width: 40px; height: 40px; object-fit: cover; background: var(--color-surface-base); }
	.thumb.headshot { object-position: 50% 8%; }
	.thumb.empty { display: grid; place-items: center; color: var(--color-text-dim); font: 600 7px var(--font-mono); text-transform: uppercase; text-align: center; }
	.info { display: grid; min-width: 0; }
	.info b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; color: var(--color-text-primary); }
	.sub { color: var(--color-text-dim); font: 10px var(--font-mono); }
	.warn { color: var(--color-gate-pending); font: 600 9px var(--font-mono); text-transform: uppercase; }
	.actions { display: flex; gap: 2px; }
	.mini { border: 1px solid var(--color-border-default); background: transparent; padding: 1px 5px; color: var(--color-text-dim); font: 600 9px var(--font-mono); text-transform: uppercase; cursor: pointer; }
	.mini:hover { color: var(--color-text-primary); }
	.error { color: var(--color-gate-failed); font-size: 11px; }
</style>
