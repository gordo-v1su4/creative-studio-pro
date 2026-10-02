<script lang="ts">
	import type { Project } from '$lib/domain/schemas';
	import { DEFAULT_TARGET, SEEDANCE_TARGETS, SEEDANCE_TARGET_IDS, checkTarget, type SeedanceTarget, type TeaserTarget } from '$lib/domain/trailer-house';
	import Pick from '$lib/ui/controls/Pick.svelte';
	import Toggle from '$lib/ui/controls/Toggle.svelte';
	import ClipHoverPlayer from '$lib/ui/ClipHoverPlayer.svelte';
	import { lintPrompt } from '$lib/domain/prompt-lint';

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

	// The Agent writes the teaser, the prompt linter checks it and the Agent fixes every finding, streamed
	// so the panel shows each round live: the draft with its problems highlighted, then the fix.
	type LiveIssue = { rule: string; severity: 'error' | 'warning'; index: number; length: number; match: string; message: string };
	let live = $state<{ status: string; title: string | null; prompt: string | null; issues: LiveIssue[]; round: number } | null>(null);

	async function streamAction(body: Record<string, unknown>, label: string) {
		busy = label; error = null;
		live = { status: 'Starting…', title: null, prompt: null, issues: [], round: 0 };
		try {
			const response = await fetch(`/api/projects/${project.project_id}/trailer-house`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, expected_version: project.version }) });
			if (!response.body || !response.headers.get('content-type')?.includes('ndjson')) {
				const result = (await response.json()) as { ok: false; error: { message: string } };
				throw new Error(result.error?.message ?? 'The Agent call failed');
			}
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
					const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
					if (line.trim()) handle(JSON.parse(line));
				}
			}
		} catch (cause) { error = cause instanceof Error ? cause.message : 'The Agent call failed'; }
		finally { busy = null; live = null; }
	}

	function handle(event: { type: string; [key: string]: unknown }) {
		if (!live) return;
		if (event.type === 'status') live.status = String(event.text);
		else if (event.type === 'teaser') { const bp = event.blueprint as { title: string; seedance_prompt: string }; live.title = bp.title; live.prompt = bp.seedance_prompt; }
		else if (event.type === 'lint') { live.prompt = String(event.prompt); live.issues = event.issues as LiveIssue[]; live.round = Number(event.round); }
		else if (event.type === 'done') onUpdated(event.data as Project);
		else if (event.type === 'error') error = String(event.message);
	}

	/** The prompt split into plain runs and highlighted findings (overlaps keep the first). */
	function segments(text: string, issues: LiveIssue[]) {
		const out: { text: string; issue?: LiveIssue }[] = [];
		let at = 0;
		for (const issue of [...issues].filter((i) => i.length > 0).sort((a, b) => a.index - b.index)) {
			if (issue.index < at) continue;
			if (issue.index > at) out.push({ text: text.slice(at, issue.index) });
			out.push({ text: text.slice(issue.index, issue.index + issue.length), issue });
			at = issue.index + issue.length;
		}
		if (at < text.length) out.push({ text: text.slice(at) });
		return out;
	}

	// The saved teaser, linted here too so anything left is highlighted (the project's own bans are checked on the server).
	const savedIssues = $derived(house?.blueprint ? (lintPrompt(house.blueprint.seedance_prompt, 'seedance').issues.map((i) => ({ rule: i.rule, severity: i.severity, index: i.index, length: i.match === '(whole prompt)' ? 0 : i.match.length, match: i.match, message: i.message })) as LiveIssue[]) : []);
	const savedErrors = $derived(savedIssues.filter((i) => i.severity === 'error').length + (house?.blueprint?.lint?.remaining.filter((r) => r.severity === 'error' && (r.rule === 'project-rule' || r.rule === 'banned-word')).length ?? 0));

	const pitch = () => void send({ action: 'pitch', seeds, character, target }, 'pitch');
	const develop = (round: number, index: number) => void streamAction({ action: 'develop', round, index, character, target }, `develop:${round}:${index}`);
	const relint = () => void streamAction({ action: 'relint' }, 'relint');

	// Render: Trailer House teaser → Seedance → back. Priced first; sent only for the confirmed price.
	let resolution = $state<'480p' | '720p' | '1080p'>('480p');
	let withAudio = $state(true);
	let quote = $state<{ credits: number; balance: number | null; draft: boolean } | null>(null);
	$effect(() => { resolution; withAudio; house?.blueprint?.seedance_prompt; quote = null; });

	async function renderRequest(body: Record<string, unknown>, label: string): Promise<unknown> {
		busy = label; error = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/trailer-house/render`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			const result = (await response.json()) as { ok: true; data?: Project; credits?: number; balance?: number | null; draft?: boolean } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			if (result.data) onUpdated(result.data);
			return result;
		} catch (cause) { error = cause instanceof Error ? cause.message : 'The render request failed'; return null; }
		finally { busy = null; }
	}
	async function priceIt() {
		const result = (await renderRequest({ action: 'quote', settings: { resolution, generate_audio: withAudio } }, 'quote')) as { credits: number; balance: number | null; draft: boolean } | null;
		quote = result ? { credits: result.credits, balance: result.balance, draft: result.draft } : null;
	}
	async function sendRender() {
		if (!quote) return;
		const sent = await renderRequest({ action: 'send', expected_version: project.version, settings: { resolution, generate_audio: withAudio }, confirmed_credits: quote.credits }, 'send');
		if (sent) quote = null;
	}
	const toBoard = (requestId: string) => void renderRequest({ action: 'board', expected_version: project.version, request_id: requestId }, `board:${requestId}`);

	// While a render is queued or running, check on it every 10 seconds; a finished clip comes back into the project.
	const pendingRenders = $derived((house?.renders ?? []).filter((r) => r.status === 'queued' || r.status === 'in_progress').length);
	$effect(() => {
		if (!pendingRenders) return;
		const id = project.project_id;
		const timer = setInterval(async () => {
			try {
				const response = await fetch(`/api/projects/${id}/trailer-house/render`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'poll' }) });
				const result = (await response.json()) as { ok: true; data: Project } | { ok: false };
				if (result.ok && result.data.version !== project.version) onUpdated(result.data);
			} catch { /* try again next tick */ }
		}, 10_000);
		return () => clearInterval(timer);
	});
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

	<!-- Live: the Agent writing the teaser, the linter's findings highlighted, the Agent fixing them -->
	{#if live}
		<div class="step mt-4" aria-live="polite">
			<div class="grid min-w-0 gap-2">
				<p class="cap"><span class="num">3</span>Teaser <small>{live.title ?? ''}</small></p>
				<p class="live-status"><span class="pulse" aria-hidden="true"></span>{live.status}{live.round ? ` · round ${live.round}` : ''}</p>
				{#if live.prompt}
					<pre class={['prompt', busy && 'fixing']}>{#each segments(live.prompt, live.issues) as part, i (i)}{#if part.issue}<mark class={['lint', part.issue.severity]} title={`${part.issue.rule}: ${part.issue.message}`}>{part.text}</mark>{:else}{part.text}{/if}{/each}</pre>
					{#if live.issues.length}<p class="text-[11px] text-nr-mark-dim">{live.issues.filter((i) => i.severity === 'error').length} errors, {live.issues.filter((i) => i.severity === 'warning').length} warnings found by the prompt linter; the Agent is fixing them.</p>{/if}
				{/if}
			</div>
		</div>
	{/if}

	<!-- 3 · The teaser for the picked pitch -->
	{#if house?.blueprint && !live}
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
					<div class="flex flex-wrap items-center gap-2">
						<p class="cap">Seedance prompt</p>
						{#if savedErrors === 0}
							<span class="chip ok" title="The prompt linter passes: declared names only, no pronouns or stand-ins, no banned words, @Image_1">Lint clean{bp.lint?.rounds ? ` · the Agent fixed ${bp.lint.fixed} in ${bp.lint.rounds} round${bp.lint.rounds === 1 ? '' : 's'}` : ''}</span>
						{:else}
							<span class="chip bad">{savedErrors} lint error{savedErrors === 1 ? '' : 's'} left</span>
							<button type="button" class="key accent" onclick={relint} disabled={!!busy}>Fix again</button>
						{/if}
						<span class="grow"></span>
						<button type="button" class="key" onclick={() => void copyPrompt()}>{copied ? 'Copied' : 'Copy'}</button>
					</div>
					<pre class="prompt">{#each segments(bp.seedance_prompt, savedIssues) as part, i (i)}{#if part.issue}<mark class={['lint', part.issue.severity]} title={`${part.issue.rule}: ${part.issue.message}`}>{part.text}</mark>{:else}{part.text}{/if}{/each}</pre>
				</div>

				<!-- Render it on Seedance and bring the clip back -->
				<div class="render">
					<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
						<span class="cap">Render</span>
						<span class="flex items-center gap-2"><span class="cap">Size</span>
							<Pick label="Render resolution" value={resolution} options={[
								{ value: '480p', label: house.target.model === 'seedance-2.5' ? '480p draft' : '480p', hint: house.target.model === 'seedance-2.5' ? 'finalize later' : undefined },
								{ value: '720p', label: '720p' },
								{ value: '1080p', label: '1080p' }
							]} onchange={(value) => (resolution = value)} />
						</span>
						<span class="flex items-center gap-2"><Toggle label="Generate audio" bind:checked={withAudio} /><span class="cap">Audio</span></span>
						<span class="grow"></span>
						{#if quote}
							<span class="text-[12px] text-nr-text">{quote.credits} credits{quote.draft ? ' (draft)' : ''}{quote.balance !== null ? ` · ${quote.balance} left` : ''}</span>
							<button type="button" class="key accent" onclick={() => void sendRender()} disabled={!!busy || (quote.balance !== null && quote.balance < quote.credits)}>{busy === 'send' ? 'Sending…' : `Send for ${quote.credits} credits`}</button>
							<button type="button" class="key" onclick={() => (quote = null)} disabled={!!busy}>Cancel</button>
						{:else}
							<button type="button" class="key accent" onclick={() => void priceIt()} disabled={!!busy || savedErrors > 0} title={savedErrors > 0 ? 'Fix the lint errors first' : `Price a ${house.target.seconds}s ${SEEDANCE_TARGETS[house.target.model].label} render (free; nothing is sent)`}>{busy === 'quote' ? 'Pricing…' : 'Price it'}</button>
						{/if}
					</div>
					{#if quote && quote.balance !== null && quote.balance < quote.credits}<p class="text-[11px] text-nr-danger-text">Not enough credits: {quote.balance} left, {quote.credits} needed.</p>{/if}
					{#if house.renders?.length}
						<div class="renders">
							{#each [...house.renders].reverse() as render (render.request_id)}
								<div class="render-card">
									{#if render.video}
										<div class="clip"><ClipHoverPlayer src={render.video.url} label={`${bp.title} render`} maxHeight={216} /></div>
									{:else}
										<div class={['clip waiting', (render.status === 'failed' || render.status === 'nsfw') && 'failed']}>{render.status === 'failed' || render.status === 'nsfw' ? (render.error ?? 'Failed') : render.status === 'in_progress' ? 'Rendering…' : 'Queued…'}</div>
									{/if}
									<div class="flex items-center gap-2 px-1.5 py-1 text-[10px] text-nr-dim">
										<span>{render.job_type === 'seedance_2_0' ? '2.0' : '2.5'} · {render.resolution}{render.draft ? ' draft' : ''} · {render.duration_s}s · {render.estimate_credits} cr</span>
										<span class="grow"></span>
										{#if render.video}
											{#if render.card_id}<span class="text-nr-accent">On the board</span>{:else}<button type="button" class="key" onclick={() => toBoard(render.request_id)} disabled={!!busy}>{busy === `board:${render.request_id}` ? 'Adding…' : 'Add to board'}</button>{/if}
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
				<p class="text-[11px] text-nr-faint">Render it to see if the idea holds up. If it does, keep going below.</p>
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
	.field { display: grid; gap: 4px; align-content: start; }
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
	.live-status { display: flex; align-items: center; gap: 8px; color: var(--color-nr-accent); font-size: 12px; }
	.pulse { width: 6px; height: 6px; border-radius: 999px; background: var(--color-nr-accent); box-shadow: 0 0 8px var(--color-nr-accent); animation: th-pulse 1.1s ease-in-out infinite; }
	mark.lint { border-radius: 1px; padding: 0 1px; color: inherit; transition: background 300ms ease; }
	mark.lint.error { background: color-mix(in srgb, var(--color-nr-danger) 28%, transparent); box-shadow: inset 0 -1px 0 var(--color-nr-danger); }
	mark.lint.warning { background: color-mix(in srgb, var(--color-nr-mark) 20%, transparent); box-shadow: inset 0 -1px 0 var(--color-nr-mark); }
	.prompt.fixing mark.lint { animation: th-pulse 1.1s ease-in-out infinite; }
	.chip { border: 1px solid var(--color-nr-line); border-radius: 2px; padding: 0 6px; font: 600 9px/16px var(--font-sans); letter-spacing: 0.1em; text-transform: uppercase; }
	.chip.ok { border-color: color-mix(in srgb, var(--color-nr-accent) 40%, transparent); color: var(--color-nr-accent); }
	.chip.bad { border-color: var(--color-nr-danger-line); color: var(--color-nr-danger-text); }
	.render { display: grid; gap: 8px; }
	.renders { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }
	.render-card { border: 1px solid var(--color-nr-line-soft); border-radius: 2px; overflow: hidden; background: var(--color-nr-deep); }
	.clip { aspect-ratio: 16 / 9; }
	.clip.waiting { display: flex; align-items: center; justify-content: center; color: var(--color-nr-dim); font-size: 11px; background: repeating-linear-gradient(135deg, transparent 0 6px, rgb(255 255 255 / 0.02) 6px 12px); }
	.clip.failed { color: var(--color-nr-danger-text); }
	@keyframes th-pulse { 50% { opacity: 0.45; } }
	.link { border: 0; background: transparent; padding: 0; color: var(--color-nr-accent); font: inherit; font-size: 11px; text-decoration: underline; text-underline-offset: 2px; }
	.link:disabled { opacity: 0.4; }
</style>
