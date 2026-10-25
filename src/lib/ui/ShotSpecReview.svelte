<script lang="ts">
	import type { Project, StoryCard } from '$lib/domain/schemas';
	import { SHOT_SIZES, SPEC_MAX_S, SPEC_MIN_S, type ShotSpec } from '$lib/domain/shot-spec';

	/**
	 * One scene's shots from Ghost (V1S-375): the proposed shot specs to review in one go (edit a field, reject a
	 * shot), then Approve, which has Ghost write each shot's prompt; written shots show their Ghost QC.
	 */
	let { project, groupId, pageId, targetMin, onUpdated }: { project: Project; groupId: string; pageId: string; targetMin: number; onUpdated: (project: Project) => void } = $props();

	const shots = $derived(project.production.cards.filter((card) => card.group_id === groupId && card.fit?.spec).toSorted((a, b) => a.order - b.order));
	const waiting = $derived(shots.filter((card) => !card.fit!.approved_at));
	const written = $derived(shots.filter((card) => card.fit!.approved_at));
	let edits = $state<Record<string, ShotSpec>>({});
	let busy = $state<string | null>(null);
	let status = $state<string | null>(null);
	let error = $state<string | null>(null);
	let openPrompt = $state<string | null>(null);

	const edit = (card: StoryCard) => (edits[card.card_id] ??= structuredClone($state.snapshot(card.fit!.spec!)));
	const changed = (card: StoryCard) => !!edits[card.card_id] && JSON.stringify(edits[card.card_id]) !== JSON.stringify(card.fit!.spec);

	async function post(payload: Record<string, unknown>) {
		const response = await fetch(`/api/projects/${project.project_id}/fit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expected_version: project.version, ...payload }) });
		return response;
	}
	async function simple(label: string, payload: Record<string, unknown>) {
		busy = label; error = null;
		try {
			const body = await (await post(payload)).json();
			if (!body.ok) throw new Error(body.error?.message ?? 'That did not work');
			onUpdated(body.data as Project);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'That did not work'; }
		finally { busy = null; }
	}
	async function approve() {
		busy = 'approve'; error = null; status = 'Starting…';
		try {
			const response = await post({ action: 'approve', target_min: targetMin, scene_ids: [pageId] });
			if (!response.body || !response.headers.get('content-type')?.includes('ndjson')) throw new Error(((await response.json()) as { error?: { message: string } }).error?.message ?? 'Approve failed');
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
					const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
					if (!line.trim()) continue;
					const event = JSON.parse(line) as { type: string; [key: string]: unknown };
					if (event.type === 'status') status = String(event.text);
					else if (event.type === 'shot_done') onUpdated(event.data as Project);
					else if (event.type === 'shot_failed') error = `A shot failed: ${String(event.message)}`;
					else if (event.type === 'error') throw new Error(String(event.message));
				}
			}
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Approve failed'; }
		finally { busy = null; status = null; }
	}
</script>

{#if shots.length}
	<div class="review" aria-label="Shots from Ghost">
		{#if waiting.length}
			<div class="cap">Proposed by Ghost · review, then approve</div>
			{#each waiting as card (card.card_id)}
				{@const spec = edits[card.card_id] ?? card.fit!.spec!}
				<div class="shot">
					<div class="shot-head">
						<b>{card.title}</b>
						<select value={spec.size} onchange={(event) => (edit(card).size = event.currentTarget.value as ShotSpec['size'])} aria-label="Size">
							{#each SHOT_SIZES as size (size)}<option value={size}>{size}</option>{/each}
						</select>
						<input class="small" value={spec.angle} oninput={(event) => (edit(card).angle = event.currentTarget.value)} aria-label="Angle" />
						<input class="secs" type="number" min={SPEC_MIN_S} max={SPEC_MAX_S} value={spec.duration_s} oninput={(event) => (edit(card).duration_s = Number(event.currentTarget.value))} aria-label="Seconds" /><span class="mono">s</span>
					</div>
					<textarea rows="2" value={spec.action} oninput={(event) => (edit(card).action = event.currentTarget.value)} aria-label="Action"></textarea>
					{#if spec.dialogue}<p class="dialogue">{spec.dialogue}</p>{/if}
					<p class="mono">{spec.location || '—'} · {spec.light} · {spec.camera_move || 'locked off'}</p>
					<div class="row">
						{#if changed(card)}<button type="button" class="key" disabled={!!busy} onclick={() => void simple('edit', { action: 'edit_spec', card_id: card.card_id, spec: edits[card.card_id] }).then(() => delete edits[card.card_id])}>Save change</button>{/if}
						<button type="button" class="key" disabled={!!busy} onclick={() => void simple('reject', { action: 'reject', card_id: card.card_id })}>Reject</button>
					</div>
				</div>
			{/each}
			<div class="row">
				<button type="button" class="key on" disabled={!!busy || waiting.some(changed)} onclick={() => void approve()}>{busy === 'approve' ? 'Ghost is writing…' : `Approve ${waiting.length} shot${waiting.length === 1 ? '' : 's'}`}</button>
				{#if waiting.some(changed)}<span class="mono">Save your changes first</span>{/if}
			</div>
		{/if}
		{#if status}<p class="mono">{status}</p>{/if}
		{#if error}<p class="reason">{error}</p>{/if}
		{#if written.length}
			<div class="cap">Written by Ghost</div>
			{#each written as card (card.card_id)}
				<div class="written">
					<button type="button" class="link" aria-expanded={openPrompt === card.card_id} onclick={() => (openPrompt = openPrompt === card.card_id ? null : card.card_id)}>{card.title} · {card.beat}</button>
					<span class={['chip', card.fit!.qc?.length ? 'bad' : 'ok']}>{card.fit!.qc?.length ? `QC ${card.fit!.qc.length}` : 'QC clean'}</span>
					{#each card.fit!.qc ?? [] as issue, i (i)}<p class="reason">{issue}</p>{/each}
					{#if openPrompt === card.card_id}<pre class="prompt">{card.video_prompt}</pre>{/if}
				</div>
			{/each}
		{/if}
	</div>
{/if}

<style>
	.review { display: grid; gap: 6px; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; padding: 8px 10px; }
	.cap { color: var(--color-nr-dim); font: 600 9px var(--font-sans); letter-spacing: 0.14em; text-transform: uppercase; }
	.shot { display: grid; gap: 4px; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; background: var(--color-nr-deep); padding: 6px 8px; }
	.shot-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
	.shot-head b { color: var(--color-nr-ink); font-size: 12px; font-weight: 600; }
	select, input, textarea { border: 1px solid var(--color-nr-line); border-radius: 2px; background: #0b0d11; padding: 2px 6px; color: var(--color-nr-ink); font: 12px var(--font-sans); outline: none; appearance: none; }
	select { padding-right: 8px; cursor: pointer; }
	select:focus, input:focus, textarea:focus { border-color: color-mix(in srgb, var(--color-nr-accent) 50%, transparent); }
	.small { width: 160px; }
	.secs { width: 52px; font-family: var(--font-mono); }
	textarea { width: 100%; resize: vertical; line-height: 1.5; }
	.dialogue { color: #a99ff2; font-size: 11.5px; white-space: pre-wrap; }
	.mono { color: var(--color-nr-muted); font: 11px var(--font-mono); }
	.row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
	.written { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
	.link { border: 0; background: transparent; padding: 0; color: var(--color-nr-text); font-size: 11.5px; text-align: left; }
	.link:hover { color: var(--color-nr-ink); }
	.chip { border: 1px solid var(--color-nr-line); border-radius: 2px; padding: 0 6px; font: 10px/16px var(--font-mono); }
	.chip.ok { border-color: color-mix(in srgb, var(--color-nr-accent) 40%, transparent); color: var(--color-nr-accent); }
	.chip.bad { border-color: var(--color-nr-danger-line); color: var(--color-nr-danger-text); }
	.reason { width: 100%; color: var(--color-nr-danger-text); font-size: 11px; }
	.prompt { width: 100%; max-height: 260px; overflow: auto; margin: 0; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; background: #0b0d11; padding: 8px; color: var(--color-nr-text); font: 11px/1.55 var(--font-mono); white-space: pre-wrap; }
	.key { display: inline-flex; align-items: center; border: 1px solid var(--color-nr-line); border-radius: 2px; background: transparent; padding: 0 10px; color: var(--color-nr-muted); font: 600 9px/24px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; transition: border-color 140ms ease, color 140ms ease; }
	.key:hover:not(:disabled) { border-color: color-mix(in srgb, var(--color-nr-accent) 55%, transparent); color: var(--color-nr-ink); }
	.key.on { border-color: color-mix(in srgb, var(--color-nr-accent) 45%, transparent); color: var(--color-nr-accent); }
	.key:disabled { opacity: 0.5; }
</style>
