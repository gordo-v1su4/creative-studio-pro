<script lang="ts">
	import type { Project } from '$lib/domain/schemas';
	import { DEFAULT_TARGET, SEEDANCE_TARGETS, SEEDANCE_TARGET_IDS, checkTarget, type SeedanceTarget, type TeaserTarget } from '$lib/domain/trailer-house';
	import Pick from '$lib/ui/controls/Pick.svelte';

	/**
	 * Trailer House, the start of a project, in sections:
	 * 1 seeds (and, optionally, a main character) → 2 three pitches (logline + short
	 * description; pick one or ask for three more) → 3 its teaser right away (title,
	 * logline, hook, time-coded Seedance prompt) → 4 continue: main character and
	 * relationships, plot outline, then the full story arc (Build story).
	 * The Agent's master prompt is `prompts/trailer-house.md`.
	 */
	let { project, onUpdated, onBuildStory, building = false }: { project: Project; onUpdated: (project: Project) => void; onBuildStory?: () => void; building?: boolean } = $props();

	const house = $derived(project.trailer_house);
	let seeds = $state('');
	let character = $state('');
	let showCharacter = $state(false);
	let target = $state<TeaserTarget>({ ...DEFAULT_TARGET });
	let busy = $state<string | null>(null);
	let error = $state<string | null>(null);
	let copied = $state(false);

	// Load the saved seeds, character and target when the project changes (not on every save).
	let loadedFor = '';
	$effect(() => {
		if (loadedFor === project.project_id) return;
		loadedFor = project.project_id;
		seeds = project.trailer_house?.seeds ?? '';
		character = project.trailer_house?.character ?? '';
		showCharacter = !!character || !!project.trailer_house?.character_image;
		target = { ...(project.trailer_house?.target ?? DEFAULT_TARGET) };
	});

	const spec = $derived(SEEDANCE_TARGETS[target.model]);
	const fits = $derived(checkTarget(target));
	const sameSeeds = $derived((house?.rounds ?? []).some((round) => round.seeds.trim() === seeds.trim()));

	function setModel(model: SeedanceTarget) {
		const next = SEEDANCE_TARGETS[model];
		target = { model, seconds: Math.min(next.max_s, Math.max(next.min_s, target.seconds)), aspect: (next.aspects as readonly string[]).includes(target.aspect) ? target.aspect : '16:9' };
	}

	async function send(body: Record<string, unknown>, label: string) {
		busy = label; error = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/trailer-house`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, expected_version: project.version }) });
			const result = (await response.json()) as { ok: true; data: Project } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			onUpdated(result.data);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'The Agent call failed'; }
		finally { busy = null; }
	}

	const pitch = () => void send({ action: 'pitch', seeds, character, target }, 'pitch');
	const develop = (round: number, index: number) => void send({ action: 'develop', round, index, character, target }, `develop:${round}:${index}`);
	const proceed = (step: 'characters' | 'outline') => void send({ action: 'continue', step }, step);
	const startOver = () => void send({ action: 'clear' }, 'clear');

	/** The main character's reference image: at least 2K on the long edge, shown to the Agent in every step. */
	async function imageRequest(method: 'POST' | 'DELETE', file?: File) {
		busy = 'image'; error = null;
		try {
			const query = new URLSearchParams({ expected_version: String(project.version), ...(file ? { name: file.name } : {}) });
			const response = await fetch(`/api/projects/${project.project_id}/trailer-house/character-image?${query}`, { method, headers: file ? { 'content-type': file.type || 'image/png' } : {}, body: file });
			const result = (await response.json()) as { ok: true; data: Project } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			onUpdated(result.data);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'The image upload failed'; }
		finally { busy = null; }
	}

	async function copyPrompt() {
		if (!house?.blueprint) return;
		try { await navigator.clipboard.writeText(house.blueprint.seedance_prompt); copied = true; setTimeout(() => (copied = false), 1500); } catch { /* clipboard blocked */ }
	}
</script>

<section aria-labelledby="th-heading">
	<div class="flex flex-wrap items-center gap-3">
		<h3 id="th-heading" class="cap accent">Trailer House</h3>
		<span class="text-[11px] text-nr-faint">Seeds → three pitches → a teaser → keep going if it's good</span>
		<span class="grow"></span>
		{#if house?.rounds.length}<button type="button" class="key" onclick={startOver} disabled={!!busy} title="Forget the pitches, the teaser and what came after; the seeds stay">Start over</button>{/if}
	</div>

	<!-- 1 · Seeds, an optional main character, and the video target -->
	<div class="step mt-3">
		<div class="grid min-w-0 gap-2">
			<label class="field"><span class="cap"><span class="num">1</span>Seeds</span>
				<textarea bind:value={seeds} rows="3" aria-label="Seeds" placeholder="A few words, images or ideas: a flooded hospital, twin sisters, a stolen boat…"></textarea>
			</label>
			{#if showCharacter}
				<div class="field">
					<span class="cap">Main character <small>optional</small></span>
					<div class="flex items-stretch gap-2">
						<textarea class="min-w-0 grow" bind:value={character} rows="3" aria-label="Main character" placeholder="Name, age, who they are. Used exactly as written in every step."></textarea>
						{#if house?.character_image}
							{@const ref = house.character_image}
							<figure class="ref" title={`${ref.name} · ${ref.width}×${ref.height}: the Agent sees this as the main character`}>
								<img src={ref.url} alt={`Main character reference: ${ref.name}`} />
								<figcaption><span>{ref.width}×{ref.height}</span><button type="button" onclick={() => void imageRequest('DELETE')} disabled={!!busy} aria-label="Remove the character image">×</button></figcaption>
							</figure>
						{:else}
							<label class={['ref-add', busy === 'image' && 'opacity-50']} title="Attach a photo or character sheet (at least 2K on the long edge). The Agent sees it in every step and won't re-describe the look.">
								{busy === 'image' ? 'Uploading…' : '+ Image'}
								<input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" disabled={!!busy} onchange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void imageRequest('POST', file); }} />
							</label>
						{/if}
					</div>
				</div>
			{/if}
			<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
				{#if !showCharacter}<button type="button" class="link" onclick={() => (showCharacter = true)}>+ main character (optional)</button>{/if}
				<span class="flex items-center gap-2"><span class="cap">Video model</span>
					<Pick label="Video model" value={target.model} options={SEEDANCE_TARGET_IDS.map((id) => ({ value: id, label: SEEDANCE_TARGETS[id].label, hint: `${SEEDANCE_TARGETS[id].min_s}–${SEEDANCE_TARGETS[id].max_s}s` }))} onchange={setModel} />
				</span>
				<label class="flex items-center gap-2"><span class="cap">Teaser</span>
					<input class="num-in" type="number" min={spec.min_s} max={spec.max_s} step="1" bind:value={target.seconds} aria-label="Teaser length in seconds" /><span class="text-[11px] text-nr-dim">s</span>
				</label>
				<span class="flex items-center gap-2"><span class="cap">Aspect</span>
					<Pick label="Aspect ratio" value={target.aspect} options={spec.aspects.map((aspect) => ({ value: aspect, label: aspect }))} onchange={(aspect) => (target = { ...target, aspect })} />
				</span>
				<span class="grow"></span>
				<button type="button" class="key accent" onclick={pitch} disabled={!!busy || !fits.ok} title={fits.ok ? (sameSeeds ? 'Three new pitches, different from the ones already offered for these seeds' : 'The Agent pitches three loglines, each with a short description') : fits.message}>
					{busy === 'pitch' ? 'The Agent is pitching…' : sameSeeds ? 'Three more' : 'Pitch three loglines'}
				</button>
			</div>
			{#if !fits.ok}<p class="text-[11px] text-nr-danger-text">{fits.message}</p>{/if}
		</div>
	</div>

	<!-- 2 · Pitches: pick one for its teaser, or ask for three more -->
	{#if house?.rounds.length}
		<div class="step mt-4">
			<div class="grid min-w-0 gap-3">
				<p class="cap"><span class="num">2</span>Pitches <small>pick one for its teaser</small></p>
				{#each house.rounds as round, r (round.created_at + r)}
					<div>
						<p class="cap">Round {r + 1}{round.seeds.trim() !== seeds.trim() ? ` · from “${round.seeds.trim().slice(0, 60) || 'the project idea'}”` : ''}</p>
						<ol class="mt-1.5 grid gap-1.5">
							{#each round.pitches as pitch, i (i)}
								{@const picked = house.picked?.round === r && house.picked.index === i}
								<li class={['pitch', picked && 'picked']}>
									<span class="lnum">{i + 1}</span>
									<div class="min-w-0 grow">
										<p class="logline">{pitch.logline}</p>
										<p class="desc">{pitch.description}</p>
									</div>
									<button type="button" class={['key shrink-0', !picked && 'accent']} onclick={() => develop(r, i)} disabled={!!busy} title={picked ? 'Write its teaser again (a fresh take)' : 'Write the teaser for this pitch, to render and judge the idea'}>
										{busy === `develop:${r}:${i}` ? 'Writing…' : picked ? 'Again' : 'Teaser'}
									</button>
								</li>
							{/each}
						</ol>
					</div>
				{/each}
				<p class="text-[11px] text-nr-faint">Not feeling these? Change the seeds, or ask for <button type="button" class="link" onclick={pitch} disabled={!!busy || !fits.ok}>three more</button>.</p>
			</div>
		</div>
	{/if}

	<!-- 3 · The teaser for the picked pitch -->
	{#if house?.blueprint}
		{@const bp = house.blueprint}
		<div class="step mt-4">
			<div class="grid min-w-0 gap-2.5">
				<p class="cap"><span class="num">3</span>Teaser</p>
				<div class="flex flex-wrap items-baseline gap-3">
					<h4 class="text-[17px] font-semibold text-nr-ink">{bp.title}</h4>
					<span class="text-[11px] text-nr-faint">{SEEDANCE_TARGETS[house.target.model].label} · {house.target.seconds}s · {house.target.aspect} · {bp.model}</span>
				</div>
				<div><p class="cap">Logline</p><p class="body">{bp.logline}</p></div>
				<div><p class="cap">Hook</p><p class="body">{bp.hook}</p></div>
				<div>
					<div class="flex items-center gap-2"><p class="cap">Seedance prompt</p><span class="grow"></span><button type="button" class="key" onclick={() => void copyPrompt()}>{copied ? 'Copied' : 'Copy'}</button></div>
					<pre class="prompt">{bp.seedance_prompt}</pre>
				</div>
				<p class="text-[11px] text-nr-faint">Render it in {SEEDANCE_TARGETS[house.target.model].label} to see if the idea holds up. If it does, keep going below.</p>
			</div>
		</div>

		<!-- 4 · Keep going: cast, outline, then the full story arc -->
		<div class="step mt-4">
			<div class="grid min-w-0 gap-3">
				<div class="flex flex-wrap items-center gap-2">
					<span class="cap"><span class="num">4</span>Keep going</span>
					<span class="grow"></span>
					<button type="button" class={['key', !house.characters && 'accent']} onclick={() => proceed('characters')} disabled={!!busy}>{busy === 'characters' ? 'Writing…' : house.characters ? 'Redo characters' : 'Main character & relationships'}</button>
					<button type="button" class={['key', house.characters && !house.outline && 'accent']} onclick={() => proceed('outline')} disabled={!!busy}>{busy === 'outline' ? 'Writing…' : house.outline ? 'Redo outline' : 'Plot outline'}</button>
					{#if onBuildStory}<button type="button" class={['key', house.outline && 'accent']} onclick={onBuildStory} disabled={!!busy || building} title="Grow the full story arc and its beats from the teaser, the characters and the outline">{building ? 'Building…' : 'Full story arc →'}</button>{/if}
				</div>
				{#if house.characters}<div><p class="cap">Characters</p><pre class="text">{house.characters.text}</pre></div>{/if}
				{#if house.outline}<div><p class="cap">Plot outline</p><pre class="text">{house.outline.text}</pre></div>{/if}
			</div>
		</div>
	{/if}

	{#if error}<p class="mt-2 text-[12px] text-nr-danger-text" role="alert">{error}</p>{/if}
</section>

<style>
	.cap { color: var(--color-nr-dim); font: 600 10px var(--font-sans); letter-spacing: 0.16em; text-transform: uppercase; }
	.cap.accent { color: var(--color-nr-accent); }
	.cap small { color: var(--color-nr-faint); letter-spacing: 0.06em; text-transform: none; font-weight: 500; }
	.step { display: block; }
	.num { display: inline-block; width: 15px; height: 15px; margin-right: 7px; border: 1px solid var(--color-nr-line); border-radius: 50%; color: var(--color-nr-dim); font: 600 8px/13px var(--font-mono); letter-spacing: 0; text-align: center; vertical-align: 1px; }
	.field { display: grid; gap: 4px; }
	.field textarea, .num-in { width: 100%; border: 1px solid var(--color-nr-line); border-radius: 2px; background: var(--color-nr-deep); padding: 5px 8px; color: var(--color-nr-ink); font: 12px/1.5 var(--font-sans); outline: none; resize: vertical; }
	.field textarea:focus, .num-in:focus { border-color: color-mix(in srgb, var(--color-nr-accent) 50%, transparent); }
	.field textarea::placeholder { color: var(--color-nr-faint); }
	.num-in { width: 52px; padding: 1px 6px; font-family: var(--font-mono); }
	.key { border: 1px solid var(--color-nr-line); border-radius: 2px; background: transparent; padding: 0 9px; color: var(--color-nr-muted); font: 600 9px/20px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; transition: border-color 140ms ease, color 140ms ease; }
	.key:hover:not(:disabled) { border-color: color-mix(in srgb, var(--color-nr-accent) 55%, transparent); color: var(--color-nr-ink); }
	.key.accent { border-color: color-mix(in srgb, var(--color-nr-accent) 45%, transparent); color: var(--color-nr-accent); }
	.key:disabled { opacity: 0.4; }
	.pitch { display: flex; align-items: flex-start; gap: 10px; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; padding: 8px 10px; }
	.pitch.picked { border-color: color-mix(in srgb, var(--color-nr-accent) 45%, transparent); }
	.lnum { flex: none; color: var(--color-nr-accent); font: 500 10px/20px var(--font-mono); }
	.logline { color: var(--color-nr-ink); font-size: 12.5px; line-height: 1.55; }
	.desc { margin-top: 4px; color: var(--color-nr-muted); font-size: 12px; line-height: 1.55; }
	.body { margin-top: 3px; color: var(--color-nr-text); font-size: 12.5px; line-height: 1.6; }
	.prompt, .text { margin-top: 4px; max-height: 360px; overflow: auto; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; background: var(--color-nr-deep); padding: 8px 10px; color: var(--color-nr-text); white-space: pre-wrap; }
	.prompt { font: 11px/1.6 var(--font-mono); }
	.text { font: 12px/1.6 var(--font-sans); }
	.ref { display: flex; width: 92px; flex: none; flex-direction: column; margin: 0; border: 1px solid var(--color-nr-line); border-radius: 2px; overflow: hidden; background: var(--color-nr-deep); }
	.ref img { width: 100%; height: 0; flex: 1; min-height: 44px; object-fit: cover; }
	.ref figcaption { display: flex; align-items: center; justify-content: space-between; padding: 0 4px; color: var(--color-nr-dim); font: 9px/16px var(--font-mono); }
	.ref figcaption button { border: 0; background: transparent; color: var(--color-nr-dim); font-size: 12px; line-height: 1; }
	.ref figcaption button:hover { color: var(--color-nr-danger-text); }
	.ref-add { display: flex; width: 92px; flex: none; align-items: center; justify-content: center; border: 1px dashed var(--color-nr-line); border-radius: 2px; color: var(--color-nr-dim); font: 600 9px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer; }
	.ref-add:hover { border-color: color-mix(in srgb, var(--color-nr-accent) 50%, transparent); color: var(--color-nr-accent); }
	.link { border: 0; background: transparent; padding: 0; color: var(--color-nr-accent); font: inherit; font-size: 11px; text-decoration: underline; text-underline-offset: 2px; }
	.link:disabled { opacity: 0.4; }
</style>
