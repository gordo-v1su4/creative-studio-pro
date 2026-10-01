<script lang="ts">
	import ClipHoverPlayer from '$lib/ui/ClipHoverPlayer.svelte';
	import type { Project, ProductionAsset, ProductionState, StoryCard } from '$lib/domain/schemas';

	export type ProductionTab = 'story' | 'cards' | 'media' | 'preview' | 'export';
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
		try { const next = await request({ mode: 'generate', expected_version: project.version }); if (next.production.cards.length) tab = 'cards'; }
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

	function addAsset(card: StoryCard, kind: ProductionAsset['kind'], url: string) {
		const clean = url.trim();
		if (!clean) return;
		draft.assets = [...draft.assets.filter((asset) => !(asset.card_id === card.card_id && asset.kind === kind)), {
			asset_id: crypto.randomUUID(), card_id: card.card_id, kind,
			name: `${card.title} ${kind}`, mime_type: kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : 'audio/*',
			url: clean, created_at: new Date().toISOString()
		}];
	}

	function assetFor(cardId: string, kind: ProductionAsset['kind']) {
		return draft.assets.findLast((asset) => asset.card_id === cardId && asset.kind === kind) ?? null;
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
	let previewCard = $derived(draft.cards.find((card) => card.card_id === previewCardId) ?? draft.cards[0] ?? null);
</script>

<section class="h-full overflow-y-auto bg-[#0b0d11]" aria-label="Production workspace">
	<div class="sticky top-0 z-10 flex min-w-max items-center justify-end gap-3 border-b border-[#26333a] bg-[#10141a]/95 px-4 py-2 backdrop-blur">
		<span class="meta-label text-[#63838c]">{draft.cards.length} cards · {(totalDuration / 1000).toFixed(0)}s</span>
		<button type="button" class="btn btn-accent" onclick={() => void save()} disabled={saving || busy}>{saving ? 'Saving…' : 'Save workspace'}</button>
	</div>

	{#if error}<div class="mx-4 mt-3 border border-gate-failed/50 bg-gate-failed/5 px-3 py-2 text-gate-failed" role="alert">{error}</div>{/if}

	{#if tab === 'story'}
		<div class="mx-auto max-w-4xl p-5">
			<div class="flex items-start gap-4 border-b border-[#223039] pb-5">
				<div class="grow">
					<div class="meta-label text-[#59d9cf]">DRAFT STORY SPINE</div>
					<h2 class="mt-2 text-xl font-semibold text-[#c7eef0]">{draft.title || project.title}</h2>
					<p class="mt-2 max-w-3xl text-[13px] leading-6 text-[#80aeb9]">{draft.logline || 'Generate the first story draft from the seed, interview evidence, and selected creative voice.'}</p>
				</div>
				<button type="button" class="btn btn-accent" onclick={() => void generate()} disabled={busy}>{busy ? 'NERATE is building…' : draft.cards.length ? 'Rebuild story' : 'Build story draft'}</button>
			</div>
			<div class="mt-5 grid gap-4 md:grid-cols-2">
				<label class="workspace-field"><span>Premise</span><textarea bind:value={draft.premise} rows="9" placeholder="The complete dramatic premise…"></textarea></label>
				<label class="workspace-field"><span>Theme / dramatic question</span><textarea bind:value={draft.theme} rows="9" placeholder="What the story is really testing…"></textarea></label>
			</div>
		</div>
	{:else if tab === 'cards'}
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
						<button type="button" class="agent-mini" onclick={() => (tab = 'media')}>manage media</button>
						<span class="grow"></span><span class="meta-label text-[#55747c]">{face}</span>
						<button type="button" class="face-arrow" onclick={() => moveFace(card.card_id, 1)} aria-label={`Next face for ${card.title}`}>→</button>
					</div>
				</article>
			{/each}
			{#if draft.cards.length === 0}<button type="button" class="empty-action" onclick={() => void generate()} disabled={busy}>Build the story draft to create ordered cards</button>{/if}
		</div>
	{:else if tab === 'media'}
		<div class="grid gap-4 p-4 xl:grid-cols-2">
			{#each draft.cards as card (card.card_id)}
				{@const image = assetFor(card.card_id, 'image')}
				{@const video = assetFor(card.card_id, 'video')}
				<article class="media-card">
					<div class="flex items-center gap-2"><span class="card-index">{String(card.order + 1).padStart(2, '0')}</span><strong>{card.title}</strong></div>
					<div class="mt-3 grid grid-cols-2 gap-2">
						<div class="media-slot">{#if image}<img src={image.url} alt={`${card.title} image result`} />{:else}<span>IMAGE RESULT</span>{/if}</div>
						<div class="media-slot">{#if video}<!-- svelte-ignore a11y_media_has_caption --><video src={video.url} controls preload="metadata" aria-label={`${card.title} video result`}></video>{:else}<span>VIDEO RESULT</span>{/if}</div>
					</div>
					<details class="mt-3"><summary>Prompts</summary><div class="prompt-block"><b>IMAGE</b><p>{card.image_prompt}</p><b>VIDEO</b><p>{card.video_prompt}</p></div></details>
					<div class="mt-3 grid gap-2 sm:grid-cols-2">
						<label class="url-field">Image URL<input value={image?.url ?? ''} onchange={(event) => addAsset(card, 'image', event.currentTarget.value)} placeholder="Paste returned image URL" /></label>
						<label class="url-field">Video URL<input value={video?.url ?? ''} onchange={(event) => addAsset(card, 'video', event.currentTarget.value)} placeholder="Paste returned video URL" /></label>
					</div>
				</article>
			{/each}
		</div>
	{:else if tab === 'preview'}
		<div class="mx-auto max-w-5xl p-5">
			<div class="preview-stage">
				{#if draft.cards.length === 0}<span>No cards to preview.</span>{:else}
					{@const leadVideo = previewCard ? assetFor(previewCard.card_id, 'video') : null}
					{@const leadImage = previewCard ? assetFor(previewCard.card_id, 'image') : null}
					{#if leadVideo}<!-- svelte-ignore a11y_media_has_caption --><video src={leadVideo.url} controls class="h-full w-full object-contain"></video>{:else if leadImage && previewCard}<img src={leadImage.url} alt={previewCard.title} class="h-full w-full object-contain" />{:else if previewCard}<div><b>{previewCard.title}</b><p>{previewCard.beat}</p></div>{/if}
				{/if}
			</div>
			<div class="mt-4 flex gap-2 overflow-x-auto pb-2">
				{#each draft.cards as card (card.card_id)}<button type="button" class="timeline-card" class:selected={previewCard?.card_id === card.card_id} onclick={() => (previewCardId = card.card_id)}><span>{String(card.order + 1).padStart(2, '0')}</span><b>{card.title}</b><small>{card.duration_ms / 1000}s</small></button>{/each}
			</div>
		</div>
	{:else}
		<div class="mx-auto max-w-3xl p-6">
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
	.workspace-field textarea, .story-card input, .story-card textarea, .url-field input { width: 100%; border: 1px solid #26383f; background: #0d1116; color: #a8cbd2; padding: 10px; outline: none; font: 12px/1.6 var(--font-mono); }
	.workspace-field textarea:focus, .story-card input:focus, .story-card textarea:focus, .url-field input:focus { border-color: #4ee8d2; }
	.story-card, .media-card { border: 1px solid #26383f; background: #11161c; padding: 10px; box-shadow: inset 2px 0 #3b7f89; }
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
	.empty-action { min-height: 240px; border: 1px dashed #31565d; color: #6ca1a8; }
	.media-slot { display: flex; aspect-ratio: 16/9; align-items: center; justify-content: center; overflow: hidden; border: 1px dashed #31565d; background: #090c10; color: #4d6c73; font: 600 9px var(--font-mono); letter-spacing: .08em; }
	.media-slot img, .media-slot video { width: 100%; height: 100%; object-fit: contain; }
	details summary { color: #65b7c0; cursor: pointer; font: 600 10px var(--font-mono); }
	.prompt-block { margin-top: 8px; max-height: 180px; overflow: auto; border-left: 1px solid #31565d; padding-left: 10px; color: #718f98; font: 10px/1.55 var(--font-mono); }
	.prompt-block b { color: #4ee8d2; }
	.url-field { display: grid; gap: 5px; color: #62848c; font: 600 9px var(--font-mono); text-transform: uppercase; }
	.url-field input { padding: 7px; font-size: 10px; }
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
</style>
