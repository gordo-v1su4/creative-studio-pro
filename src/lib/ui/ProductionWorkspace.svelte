<script lang="ts">
	import ClipHoverPlayer from '$lib/ui/ClipHoverPlayer.svelte';
	import type { Project, ProductionAsset, ProductionState, StoryCard } from '$lib/domain/schemas';
	import { pickFor } from '$lib/domain/takes';
	import { liveSpine } from '$lib/domain/spine';
	import { cutLength, cutsOf } from '$lib/domain/cuts';
	import SequencePlayer from '$lib/ui/SequencePlayer.svelte';
	import FinalizePanel from '$lib/ui/FinalizePanel.svelte';
	import SoundStage from '$lib/ui/SoundStage.svelte';
	import ExportStage from '$lib/ui/ExportStage.svelte';
	import BriefPanel from '$lib/ui/BriefPanel.svelte';
	import TrailerHousePanel from '$lib/ui/TrailerHousePanel.svelte';
	import StageGatePanel from '$lib/ui/StageGatePanel.svelte';
	import { finalizable, finalizingIds, oneTakePerDraft } from '$lib/domain/finalize';
	import { clock } from '$lib/ui/clock.svelte';

	export type ProductionTab = 'story' | 'beats' | 'cuts' | 'sound' | 'export';
	let { project, onUpdated, tab = $bindable('story') }: {
		project: Project; onUpdated: (project: Project) => void; tab?: ProductionTab
	} = $props();

	let busy = $state(false);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let draft = $state<ProductionState>({ status: 'empty', title: '', logline: '', premise: '', theme: '', cards: [], assets: [], updated_at: null });
	let loadedVersion = $state(-1);
	let previewCardId = $state('');
	type CardFace = 'text' | 'image' | 'video';
	let cardFaces = $state<Record<string, CardFace>>({});
	const faces: CardFace[] = ['text', 'image', 'video'];
	const cloneProduction = (value: ProductionState): ProductionState => JSON.parse(JSON.stringify(value)) as ProductionState;

	$effect(() => {
		if (project.version !== loadedVersion || (draft.cards.length === 0 && project.production.cards.length > 0)) {
			loadedVersion = project.version;
			draft = cloneProduction(project.production);
		}
	});

	async function request(body: Record<string, unknown>) {
		const response = await fetch(`/api/projects/${project.project_id}/production`, {
			method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
		});
		const result = await response.json() as { ok: true; data: Project } | { ok: false; error: { message: string } };
		if (!result.ok) throw new Error(result.error.message);
		onUpdated(result.data);
		loadedVersion = result.data.version;
		draft = cloneProduction(result.data.production);
		return result.data;
	}

	async function generate() {
		busy = true; error = null;
		try { const next = await request({ mode: 'generate', expected_version: project.version }); if (next.production.cards.length) tab = 'beats'; }
		catch (cause) { error = cause instanceof Error ? cause.message : 'Story build failed'; }
		finally { busy = false; }
	}

	async function save() {
		saving = true; error = null;
		try { await request({ mode: 'save', expected_version: project.version, production: draft }); }
		catch (cause) { error = cause instanceof Error ? cause.message : 'Production save failed'; }
		finally { saving = false; }
	}

	function updateCard(cardId: string, patch: Partial<StoryCard>) {
		draft.cards = draft.cards.map((card) => card.card_id === cardId ? { ...card, ...patch } : card);
	}

	/** The pick when it is of this kind, else the newest live take of the kind. */
	function assetFor(cardId: string, kind: ProductionAsset['kind']) {
		const card = draft.cards.find((entry) => entry.card_id === cardId);
		const pick = card ? pickFor(draft, card) : null;
		if (pick?.kind === kind) return pick;
		return draft.assets.findLast((asset) => asset.card_id === cardId && asset.kind === kind && !asset.rejected) ?? null;
	}

	function faceFor(cardId: string): CardFace {
		if (cardFaces[cardId]) return cardFaces[cardId];
		return assetFor(cardId, 'video') ? 'video' : assetFor(cardId, 'image') ? 'image' : 'text';
	}

	function setFace(cardId: string, face: CardFace) {
		cardFaces = { ...cardFaces, [cardId]: face };
	}

	function moveFace(cardId: string, direction: -1 | 1) {
		const current = faceFor(cardId);
		setFace(cardId, faces[(faces.indexOf(current) + direction + faces.length) % faces.length]);
	}

	function downloadManifest() {
		const payload = { schema: 'csp-production-manifest.v1', exported_at: new Date().toISOString(), project_id: project.project_id, project_version: project.version, production: draft };
		const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
		const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-production.json`; anchor.click();
		URL.revokeObjectURL(url);
	}

	const totalDuration = $derived(draft.cards.reduce((sum, card) => sum + card.duration_ms, 0));
	// The preview plays the spine: story order, benched beats skipped.
	let spine = $derived(liveSpine(draft));
	let previewCard = $derived(spine.find((card) => card.card_id === previewCardId) ?? spine[0] ?? null);

	// Cuts are stored state, read from the project (not the draft) and changed only by cut commands.
	const cuts = $derived(cutsOf(project.production));
	/** The cut open in the player, and which version (null = the current one). */
	let openCut = $state<{ cutId: string; version: number | null; mixUrl?: string } | null>(null);
	let versionsOpen = $state<string | null>(null);
	let locking = $state<string | null>(null);

	/** Lock freezes the current version's picture; unlock opens the next version from it. */
	async function setLocked(cutId: string, lock: boolean) {
		locking = cutId; error = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/cuts`, {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ command: lock ? 'lock_cut' : 'unlock_cut', expected_version: project.version, cut_id: cutId })
			});
			const result = await response.json() as { ok: true; data: Project } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			onUpdated(result.data);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Lock failed'; }
		finally { locking = null; }
	}
	let renaming = $state<{ cutId: string; name: string } | null>(null);
	let finalizing = $state<{ takeIds: string[]; title: string } | null>(null);
	let notice = $state<string | null>(null);

	/** The cut's takes that are drafts still inside their finalize window (and not already finalizing). */
	function cutDrafts(cut: (typeof cuts)[number]): string[] {
		const sent = finalizingIds(project.production);
		const takes = [...new Set(cut.entries.map((entry) => entry.asset_id))]
			.flatMap((id) => project.production.assets.filter((asset) => asset.asset_id === id && !sent.has(id)));
		return oneTakePerDraft(finalizable(takes, clock.now)).map((take) => take.asset_id);
	}

	async function rename() {
		const target = renaming;
		if (!target?.name.trim()) return;
		error = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/cuts`, {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ command: 'rename_cut', expected_version: project.version, cut_id: target.cutId, name: target.name.trim() })
			});
			const result = await response.json() as { ok: true; data: Project } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			onUpdated(result.data);
			renaming = null;
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Rename failed'; }
	}
</script>

<section class="h-full overflow-y-auto bg-[#0b0d11]" aria-label="Production workspace">
	<div class="sticky top-0 z-10 flex min-w-max items-center justify-end gap-3 border-b border-[#26333a] bg-[#10141a]/95 px-4 py-2 backdrop-blur">
		<span class="meta-label text-[#63838c]">{draft.cards.length} beats · {(totalDuration / 1000).toFixed(0)}s</span>
		<button type="button" class="btn btn-accent" onclick={() => void save()} disabled={saving || busy}>{saving ? 'Saving…' : 'Save workspace'}</button>
	</div>

	{#if error}<div class="mx-4 mt-3 border border-gate-failed/50 bg-gate-failed/5 px-3 py-2 text-gate-failed" role="alert">{error}</div>{/if}

	{#if tab === 'story'}
		<div class="mx-auto max-w-4xl p-5">
			<div class="mb-12">
				<TrailerHousePanel {project} {onUpdated} onBuildStory={() => void generate()} building={busy} />
			</div>
			<div class="mb-12">
				<BriefPanel {project} {onUpdated} />
				<details class="mt-4">
					<summary class="cursor-pointer font-mono text-[10px] uppercase tracking-[.14em] text-[#5b6b70]">Stage gate · {project.stage.id} (optional)</summary>
					<div class="mt-2 max-w-md"><StageGatePanel {project} {onUpdated} showBrief={false} /></div>
				</details>
			</div>
			<div class="flex items-start gap-4">
				<div class="grow">
					<div class="meta-label text-[#59d9cf]">DRAFT STORY SPINE</div>
					<h2 class="mt-2 text-xl font-semibold text-[#c7eef0]">{draft.title || project.title}</h2>
					<p class="mt-2 max-w-3xl text-[13px] leading-6 text-[#80aeb9]">{draft.logline || 'Generate the first story draft from the seed, interview evidence, and selected creative voice.'}</p>
				</div>
				<button type="button" class="btn btn-accent" onclick={() => void generate()} disabled={busy}>{busy ? 'The Agent is building…' : draft.cards.length ? 'Rebuild story' : 'Build story draft'}</button>
			</div>
			<div class="mt-5 grid gap-4 md:grid-cols-2">
				<label class="workspace-field"><span>Premise</span><textarea bind:value={draft.premise} rows="9" placeholder="The complete dramatic premise…"></textarea></label>
				<label class="workspace-field"><span>Theme / dramatic question</span><textarea bind:value={draft.theme} rows="9" placeholder="What the story is really testing…"></textarea></label>
			</div>
		</div>
	{:else if tab === 'beats'}
		<div class="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 p-4">
			{#each draft.cards as card (card.card_id)}
				{@const image = assetFor(card.card_id, 'image')}
				{@const video = assetFor(card.card_id, 'video')}
				{@const face = faceFor(card.card_id)}
				<article class="story-card">
					<div class="flex items-center gap-2"><span class="card-index">{String(card.order + 1).padStart(2, '0')}</span><input value={card.title} oninput={(event) => updateCard(card.card_id, { title: event.currentTarget.value })} aria-label={`Card ${card.order + 1} title`} /><span class="meta-label text-[#63838c]">{card.duration_ms / 1000}s</span></div>
					<nav class="card-face-nav" aria-label={`Card ${card.order + 1} face`}>
						{#each faces as item}<button type="button" class:active={face === item} onclick={() => setFace(card.card_id, item)} aria-pressed={face === item}>{item}</button>{/each}
					</nav>
					<div class="card-face-stage" aria-live="polite">
						{#key face}
							<div class="card-face-panel">
								{#if face === 'text'}
									<textarea value={card.beat} oninput={(event) => updateCard(card.card_id, { beat: event.currentTarget.value })} rows="5" aria-label={`Card ${card.order + 1} beat`}></textarea>
									<p class="mt-2 text-[11px] text-[#668d98]"><b class="text-[#5bd9d0]">PURPOSE</b> · {card.purpose}</p>
								{:else if face === 'image'}
									<div class="card-result">{#if image}<img src={image.url} alt={`${card.title} image result`} />{:else}<div><b>IMAGE PROMPT</b><p>{card.image_prompt}</p></div>{/if}</div>
								{:else}
									<div class="card-result">{#if video}<ClipHoverPlayer src={video.url} label={card.title} maxHeight={270} inS={video.in_s} outS={video.out_s} speed={video.speed} />{:else}<div><b>VIDEO PROMPT</b><p>{card.video_prompt}</p></div>{/if}</div>
								{/if}
							</div>
						{/key}
					</div>
					<div class="mt-3 flex items-center gap-2">
						<button type="button" class="face-arrow" onclick={() => moveFace(card.card_id, -1)} aria-label={`Previous face for ${card.title}`}>←</button>
						<button type="button" class="agent-mini" onclick={() => updateCard(card.card_id, { status: card.status === 'approved' ? 'draft' : 'approved' })}>{card.status}</button>
						<span class="grow"></span><span class="meta-label text-[#55747c]">{face}</span>
						<button type="button" class="face-arrow" onclick={() => moveFace(card.card_id, 1)} aria-label={`Next face for ${card.title}`}>→</button>
					</div>
				</article>
			{/each}
			{#if draft.cards.length === 0}<button type="button" class="empty-action" onclick={() => void generate()} disabled={busy}>Build the story draft to create ordered cards</button>{/if}
		</div>
	{:else if tab === 'cuts'}
		<div class="mx-auto max-w-5xl p-5">
			<div class="mb-4 border-b border-[#223039] pb-4">
				<div class="meta-label text-[#59d9cf]">CUTS</div>
				<p class="mt-2 text-[12px] leading-5 text-[#789da7]">Shift-click beats on the board, play the selection, and push it into a named cut. A cut keeps its own order, trims and ramps: board edits never change it, and editing it never changes the takes.</p>
			</div>
			{#if cuts.length === 0}
				<p class="mb-6 border border-dashed border-[#29434a] p-4 text-[12px] text-[#668d98]">No cuts yet.</p>
			{:else}
				<ul class="mb-6 grid gap-2" aria-label="Cuts">
					{#each cuts as cut (cut.cut_id)}
						<li class="cut-row">
							{#if renaming?.cutId === cut.cut_id}
								<!-- svelte-ignore a11y_autofocus -->
								<input class="cut-name" bind:value={renaming.name} onkeydown={(event) => { if (event.key === 'Enter') void rename(); else if (event.key === 'Escape') renaming = null; }} aria-label="Cut name" autofocus />
								<button type="button" class="agent-mini" onclick={() => void rename()} disabled={!renaming.name.trim()}>save</button>
								<button type="button" class="agent-mini" onclick={() => (renaming = null)}>cancel</button>
							{:else}
								<b>{cut.name}</b>
								<button type="button" class="agent-mini" onclick={() => (renaming = { cutId: cut.cut_id, name: cut.name })}>rename</button>
							{/if}
							<span class="grow"></span>
							<span class="meta-label text-[#63838c]">{cut.entries.length} {cut.entries.length === 1 ? 'take' : 'takes'} · {cutLength(cut).toFixed(1)}s</span>
							{#if cutDrafts(cut).length}
								<button type="button" class="btn shrink-0 whitespace-nowrap" onclick={() => (finalizing = { takeIds: cutDrafts(cut), title: `${cut.name}: all picks` })} title="Re-render this cut's 480p drafts at 1080p from the same generations (you see the price first)">Finalize all picks ({cutDrafts(cut).length})…</button>
							{/if}
							<span class={['version-tag', cut.locked && 'locked']} title={cut.locked ? `Picture locked ${new Date(cut.locked_at ?? cut.updated_at).toLocaleString()}` : 'The version being edited'}>v{cut.version}{cut.locked ? ' · locked' : ''}</span>
							{#if (cut.versions ?? []).some((v) => v.version !== cut.version)}
								<button type="button" class="agent-mini" onclick={() => (versionsOpen = versionsOpen === cut.cut_id ? null : cut.cut_id)} aria-expanded={versionsOpen === cut.cut_id}>versions</button>
							{/if}
							<button type="button" class="btn" onclick={() => void setLocked(cut.cut_id, !cut.locked)} disabled={locking === cut.cut_id} title={cut.locked ? `Unlock: start v${cut.version + 1} as a copy of v${cut.version}; v${cut.version} stays as it is` : `Lock v${cut.version}: freeze its picture (no trims, ramps, reorders, swaps or drops) so sound can be laid against it`}>{cut.locked ? `Unlock to v${cut.version + 1}` : 'Lock'}</button>
							<button type="button" class="btn btn-accent" onclick={() => (openCut = { cutId: cut.cut_id, version: null })}>Open</button>
						</li>
					{/each}
				</ul>
			{/if}
			{#if notice}<p class="mb-4 border border-[#29434a] bg-[#0d1418] px-3 py-2 text-[12px] text-[#9fc9cf]" role="status">{notice}</p>{/if}
			{#if finalizing}<FinalizePanel {project} takeIds={finalizing.takeIds} title={finalizing.title} {onUpdated} onclose={() => (finalizing = null)} onsent={(message) => (notice = message)} />{/if}
			{#if versionsOpen}
				{@const vcut = cuts.find((c) => c.cut_id === versionsOpen)}
				{#if vcut}
					<ul class="mb-6 -mt-4 grid gap-1 border-l border-[#29434a] pl-3" aria-label={`Versions of ${vcut.name}`}>
						{#each [...(vcut.versions ?? [])].reverse().filter((v) => v.version !== vcut.version) as v (v.version)}
							<li class="flex items-center gap-2 text-[12px] text-[#9fc9cf]">
								<span class="version-tag locked">v{v.version} · locked</span>
								<span class="text-[#668d98]">{new Date(v.locked_at).toLocaleString()} · {v.entries.length} {v.entries.length === 1 ? 'take' : 'takes'} · {cutLength(v).toFixed(1)}s</span>
								<button type="button" class="agent-mini" onclick={() => (openCut = { cutId: vcut.cut_id, version: v.version })}>open (read-only)</button>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
			{#if openCut}
				{#key `${openCut.cutId}:${openCut.version}`}
					<SequencePlayer {project} {onUpdated} source={{ kind: 'cut', cutId: openCut.cutId, version: openCut.version ?? undefined }} onclose={() => (openCut = null)} />
				{/key}
			{/if}
			<div class="meta-label mb-2 text-[#59d9cf]">SPINE</div>
			<div class="preview-stage">
				{#if draft.cards.length === 0}<span>No cards to preview.</span>{:else}
					{@const leadVideo = previewCard ? assetFor(previewCard.card_id, 'video') : null}
					{@const leadImage = previewCard ? assetFor(previewCard.card_id, 'image') : null}
					{#if leadVideo}<!-- svelte-ignore a11y_media_has_caption --><video src={leadVideo.url} controls class="h-full w-full object-contain"></video>{:else if leadImage && previewCard}<img src={leadImage.url} alt={previewCard.title} class="h-full w-full object-contain" />{:else if previewCard}<div><b>{previewCard.title}</b><p>{previewCard.beat}</p></div>{/if}
				{/if}
			</div>
			<div class="mt-4 flex gap-2 overflow-x-auto pb-2">
				{#each spine as card (card.card_id)}<button type="button" class="timeline-card" class:selected={previewCard?.card_id === card.card_id} onclick={() => (previewCardId = card.card_id)}><span>{String(card.order + 1).padStart(2, '0')}</span><b>{card.title}</b><small>{card.duration_ms / 1000}s</small></button>{/each}
			</div>
		</div>
	{:else if tab === 'sound'}
		<SoundStage {project} {onUpdated} onplay={(cutId, version, mixUrl) => (openCut = { cutId, version, mixUrl })} />
		{#if openCut}
			{#key `${openCut.cutId}:${openCut.version}:${openCut.mixUrl ?? ''}`}
				<SequencePlayer {project} {onUpdated} source={{ kind: 'cut', cutId: openCut.cutId, version: openCut.version ?? undefined, mixUrl: openCut.mixUrl }} onclose={() => (openCut = null)} />
			{/key}
		{/if}
	{:else}
		<div class="mx-auto max-w-3xl p-6">
			<ExportStage {project} {onUpdated} />
			<div class="border border-[#29434a] bg-[#11171d] p-5">
				<div class="meta-label text-[#59d9cf]">PORTABLE PROJECT PACKAGE</div>
				<h2 class="mt-2 text-lg text-[#c7eef0]">Production manifest v1</h2>
				<p class="mt-2 text-[12px] leading-5 text-[#789da7]">Exports the story spine, ordered cards, image/video prompts, returned asset URLs, durations, approval states, project ID, and canonical version as readable JSON.</p>
				<button type="button" class="btn btn-accent mt-5" onclick={downloadManifest} disabled={draft.cards.length === 0}>Download manifest</button>
			</div>
		</div>
	{/if}
</section>

<style>
	.workspace-field { display: grid; gap: 7px; color: #63d9d0; font: 600 10px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
	.workspace-field textarea, .story-card input, .story-card textarea { width: 100%; border: 1px solid #26383f; background: #0d1116; color: #a8cbd2; padding: 10px; outline: none; font: 12px/1.6 var(--font-mono); }
	.workspace-field textarea:focus, .story-card input:focus, .story-card textarea:focus { border-color: #4ee8d2; }
	.story-card { border: 1px solid #26383f; background: #11161c; padding: 10px; box-shadow: inset 2px 0 #3b7f89; }
	.story-card input { border: 0; padding: 4px 6px; font-weight: 700; color: #bee7e9; }
	.story-card textarea { margin-top: 10px; }
	.card-face-nav { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 9px; padding: 3px; background: #0b0f13; }
	.card-face-nav button { border: 0; background: transparent; padding: 6px; color: #55747c; font: 600 9px var(--font-mono); text-transform: uppercase; }
	.card-face-nav button:hover { background: #14232a; color: #84cbd0; }
	.card-face-nav button.active { background: linear-gradient(120deg, rgba(77,224,208,.16), rgba(78,174,244,.1), rgba(118,104,220,.08)); color: #7de5dc; }
	.card-face-stage { aspect-ratio: 16/9; overflow: hidden; }
	.card-face-panel { height: 100%; overflow: auto; }
	.card-face-panel { animation: card-face-in 140ms ease-out; }
	.card-result { display: flex; height: 100%; align-items: end; overflow: hidden; background: #05070a; }
	.card-result img { width: 100%; height: 100%; object-fit: contain; }
	.card-result > div { max-height: 100%; overflow: auto; padding: 12px; color: #6f949c; font: 10px/1.55 var(--font-mono); }
	.card-result b { color: #55d8d0; font-size: 9px; }
	.card-result p { margin-top: 7px; }
	.face-arrow { border: 0; background: transparent; padding: 5px 9px; color: #668d95; }
	.face-arrow:hover { background: #15242a; color: #7de5dc; }
	.card-index { color: #4ee8d2; font: 700 10px var(--font-mono); }
	.agent-mini { border: 1px solid #31565d; background: #101b20; color: #71c9cf; padding: 5px 8px; font: 600 9px var(--font-mono); text-transform: uppercase; }
	.cut-row { display: flex; align-items: center; gap: 8px; border: 1px solid #26383f; background: #11161c; padding: 8px 10px; color: #bce6e8; }
	.cut-row b { font-size: 12px; font-weight: 600; }
	.cut-name { border: 1px solid #4ee8d2; background: #0d1116; padding: 4px 6px; color: #bce6e8; font: 12px var(--font-mono); outline: none; }
	.empty-action { min-height: 240px; border: 1px dashed #31565d; color: #6ca1a8; }
	.preview-stage { display: flex; aspect-ratio: 16/9; align-items: center; justify-content: center; border: 1px solid #31565d; background: #07090c; color: #88b6bf; text-align: center; }
	.preview-stage div { max-width: 520px; padding: 30px; }
	.preview-stage b { color: #bcebee; }
	.timeline-card { display: grid; min-width: 150px; gap: 4px; border: 1px solid #26383f; background: #11161c; padding: 9px; }
	.timeline-card:hover { border-color: transparent; background: #16242a; }
	.timeline-card.selected { border-color: transparent; background: linear-gradient(120deg, rgba(78,232,210,.16), rgba(72,189,245,.1), rgba(119,112,247,.08)); }
	.timeline-card span, .timeline-card small { color: #62848c; font: 9px var(--font-mono); }
	.timeline-card b { overflow: hidden; color: #9ec9cf; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
	@keyframes card-face-in { from { opacity: .35; transform: translateX(4px); } }
	@media (prefers-reduced-motion: reduce) { .card-face-panel { animation: none; } }
	.version-tag { border: 1px solid #29434a; padding: 0 5px; color: #84cbd0; font: 600 10px var(--font-mono); text-transform: uppercase; white-space: nowrap; }
	.version-tag.locked { border-color: #6a5a26; color: #f2c14e; }
</style>
