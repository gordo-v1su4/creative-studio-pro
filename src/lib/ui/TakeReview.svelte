<script lang="ts">
	import type { Project, ProductionAsset } from '$lib/domain/schemas';
	let { project, cardId, onUpdated, disabled = false }: { project: Project; cardId: string; onUpdated: (project: Project) => void; disabled?: boolean } = $props();
	const takes = $derived(project.production.assets.filter((take) => take.card_id === cardId && take.kind !== 'audio'));
	let busy = $state(false);
	let error = $state<string | null>(null);
	async function review(take: ProductionAsset, change: { status?: ProductionAsset['review_status']; excluded?: boolean }) {
		busy = true; error = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/review-room`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'review', take_id: take.asset_id, expected_version: project.version, ...change }) });
			const body = await response.json();
			if (!body.ok) throw new Error(body.error?.message ?? 'Review could not be saved');
			onUpdated(body.data);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Review could not be saved'; }
		finally { busy = false; }
	}
</script>

{#if takes.length}
	<details class="take-review">
		<summary>{takes.length} take{takes.length === 1 ? '' : 's'} · review &amp; exclude</summary>
		<p>Review status is shared by this shot. Exclude keeps one take out of picks and new cuts; Restore brings it back.</p>
		{#if disabled}<p>Save shot edits before reviewing takes.</p>{/if}
		{#each takes as take, i (take.asset_id)}
			<div class:excluded={take.rejected}>
				<span title={take.name}>{take.review_room ? `v${String(take.review_room.version).padStart(3, '0')}` : `Take ${i + 1}`} · {take.name}</span>
				<label>Shot review
					<select aria-label={`Review status for ${take.name}`} title={take.review_room ? 'Synced with Review Room' : 'Store this take in Review Room first'} value={take.review_status ?? 'awaiting_review'} disabled={busy || disabled || !take.review_room} onchange={(event) => void review(take, { status: event.currentTarget.value as ProductionAsset['review_status'] })}>
						<option value="awaiting_review">Awaiting review</option><option value="in_progress">In progress</option><option value="needs_changes">Needs revision</option><option value="approved">Approved</option>
					</select>
				</label>
				<button type="button" disabled={busy || disabled} onclick={() => void review(take, { excluded: !take.rejected })} aria-label={`${take.rejected ? 'Restore' : 'Exclude'} ${take.name}`}>{take.rejected ? 'Restore' : 'Exclude'}</button>
			</div>
		{/each}
		{#if error}<p role="alert">{error}</p>{/if}
	</details>
{/if}

<style>
	.take-review { border-top: 1px solid #223039; margin-top: 8px; padding-top: 8px; color: #9fc9cf; font-size: 11px; }
	summary { cursor: pointer; }
	p { color: #789da7; line-height: 1.5; margin: 8px 0; }
	.take-review div { border-top: 1px solid #1b262c; padding: 8px 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
	span { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	label { display: flex; align-items: center; gap: 5px; flex: 1; }
	select, button { background: #101b21; border: 1px solid #29434c; border-radius: 4px; color: #b3d5db; padding: 4px; font: inherit; }
	.excluded span { color: #f2c14e; text-decoration: line-through; }
</style>
