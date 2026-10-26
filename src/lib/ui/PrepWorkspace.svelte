<script lang="ts">
	import type { Project } from '$lib/domain/schemas';
	import type { PrepEntry, PrepState, ReferenceSpec } from '$lib/domain/prep';
	import { factsGaps, handOffLine, identityGaps, notesOf, prepStage } from '$lib/domain/prep';
	import type { StillApproval } from '$lib/domain/stills';
	import StillApprovalCard from './StillApprovalCard.svelte';

	/**
	 * Prep (V1S-374): the references an episode needs, as a dependency graph per entry — source images →
	 * facts → prompt (one pass from the skill and the images) → price card → reference → the scenes that use it. Characters first, then
	 * locations, then props added by name. Every sheet goes through the approval card; a finished one lands in
	 * the series' References drawer.
	 */
	let { project, onUpdated }: { project: Project; onUpdated: (project: Project) => void } = $props();

	type View = { entry: PrepEntry; state: PrepState; template: string; current: { url: string } | null };
	let items = $state<View[]>([]);
	let spent = $state(0);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let busy = $state<Record<string, string>>({});
	let approvals = $state<Record<string, StillApproval>>({});
	type Identity = NonNullable<ReferenceSpec['identity']>;
	type Draft = { from: string; notes: string; identity: Identity; owned_element: string; colour_name: string; colour_hex: string; powers: string; ownership_lock: string };
	let drafts = $state<Record<string, Draft>>({});
	const emptyIdentity = (): Identity => ({ sex: '', age: null, height_cm: null, build: '', face: '', eyes: '', hair: '', marks: '' });
	let promptDrafts = $state<Record<string, string>>({});
	let newProp = $state('');
	/** The picture shown big (click any picture; Esc or a click closes it). */
	let zoom = $state<{ src: string; alt: string } | null>(null);

	const base = $derived(`/api/projects/${project.project_id}/prep`);
	const sections = $derived([
		{ kind: 'character', label: 'Characters', list: items.filter((item) => item.entry.kind === 'character') },
		{ kind: 'location', label: 'Locations', list: items.filter((item) => item.entry.kind === 'location') },
		{ kind: 'prop', label: 'Props', list: items.filter((item) => item.entry.kind === 'prop') }
	]);

	function take(body: { data?: { items: View[]; episode_spent: number } | null; project?: Project }) {
		if (body.data) { items = body.data.items; spent = body.data.episode_spent; }
		if (body.project) onUpdated(body.project);
		for (const item of items) {
			const s = item.state.spec;
			// A spec that changed on the server (drafted, filled, saved) replaces the local draft.
			if (s && drafts[item.entry.key]?.from !== JSON.stringify(s)) drafts[item.entry.key] = { from: JSON.stringify(s), notes: notesOf(s), identity: { ...emptyIdentity(), ...(s.identity ?? {}) }, owned_element: s.owned_element ?? '', colour_name: s.owned_colour?.name ?? '', colour_hex: s.owned_colour?.hex ?? '', powers: (s.powers ?? []).join(', '), ownership_lock: s.ownership_lock ?? '' };
			if (!item.state.spec) delete drafts[item.entry.key];
			if (item.state.prompt !== null && promptDrafts[item.entry.key] === undefined) promptDrafts[item.entry.key] = item.state.prompt;
			if (item.state.prompt === null) delete promptDrafts[item.entry.key];
		}
	}

	async function load() {
		loading = true; error = null;
		try {
			const body = await (await fetch(base)).json();
			if (!body.ok) throw new Error(body.error?.message ?? 'Prep could not load');
			take(body);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Prep could not load'; }
		finally { loading = false; }
	}
	$effect(() => { void project.project_id; void load().then(() => { for (const item of items) if (item.state.job && !item.state.result) void watch(item.entry.key); }); });

	async function call(key: string, label: string, payload: Record<string, unknown> | FormData) {
		busy[key] = label; error = null;
		try {
			const init: RequestInit = payload instanceof FormData ? { method: 'POST', body: payload } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) };
			const body = await (await fetch(base, init)).json();
			if (!body.ok) throw new Error([body.error?.message, ...(body.error?.reasons ?? [])].filter(Boolean).join(' — '));
			take(body);
			return body;
		} catch (cause) { error = cause instanceof Error ? cause.message : 'That did not work'; return null; }
		finally { delete busy[key]; }
	}

	const upload = (key: string, action: 'source' | 'attach', files: FileList | null) => {
		const file = files?.[0];
		if (!file) return;
		const form = new FormData();
		form.set('action', action); form.set('key', key); form.set('file', file);
		void call(key, action === 'source' ? 'Adding…' : 'Attaching…', form);
	};
	const specOf = (item: View): ReferenceSpec => {
		const d = drafts[item.entry.key];
		const base = { name: item.entry.name, kind: item.entry.kind, template: item.template as ReferenceSpec['template'], notes: d.notes, description: '', must_hold: [], from_sources: '', owned_element: d.owned_element, powers: d.powers.split(',').map((p) => p.trim()).filter(Boolean), ownership_lock: d.ownership_lock };
		return item.entry.kind === 'character' ? { ...base, identity: d.identity, owned_colour: { name: d.colour_name, hex: d.colour_hex } } : base;
	};
	/** Write the prompt: the facts as typed are saved first, so the writer reads what is on screen. */
	async function writePrompt(item: View) {
		const key = item.entry.key;
		if (drafts[key] && drafts[key].from !== JSON.stringify(specOf(item)) && !(await call(key, 'Saving…', { action: 'save_spec', key, spec: specOf(item), approve: false }))) return;
		await call(key, 'The Agent is looking at the images and writing…', { action: 'write_prompt', key });
	}
	async function quote(key: string) {
		delete approvals[key];
		const body = await call(key, 'Pricing…', { action: 'quote', key });
		if (body?.approval) approvals[key] = body.approval as StillApproval;
	}
	/** One sheet's trip to Higgsfield, shown until it comes back (the busy label only covers a single request). */
	type JobStatus = { phase: 'sending' | 'making' | 'returned' | 'failed'; job_id?: string; since: number; checked?: number; message?: string };
	let jobs = $state<Record<string, JobStatus>>({});
	let now = $state(Date.now());
	$effect(() => { const tick = setInterval(() => (now = Date.now()), 1000); return () => clearInterval(tick); });
	const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

	async function make(key: string, approval: StillApproval) {
		// The card goes away at once so a second press can never send twice; a failed send asks for a fresh price.
		delete approvals[key];
		jobs[key] = { phase: 'sending', since: Date.now() };
		const sent = await call(key, 'Sending to Higgsfield…', { action: 'send', key, approval_key: approval.approval_key, confirmed_credits: approval.credits ?? 0 });
		if (!sent) { jobs[key] = { phase: 'failed', since: Date.now(), message: error ?? 'The send did not go through' }; return; }
		jobs[key] = { phase: 'making', job_id: sent.job_id, since: Date.now() };
		await watch(key);
	}
	/** Check a sent sheet every 10 s until it lands (also picks up a job still making after a reload). */
	const watching = new Set<string>();
	async function watch(key: string) {
		if (watching.has(key)) return;
		watching.add(key);
		try { await poll(key); } finally { watching.delete(key); }
	}
	async function poll(key: string) {
		const item = items.find((entry) => entry.entry.key === key);
		if (!jobs[key] || jobs[key].phase !== 'making') jobs[key] = { phase: 'making', job_id: item?.state.job?.job_id, since: item?.state.job ? Date.parse(item.state.job.sent_at) : Date.now() };
		for (let tries = 0; tries < 90; tries++) {
			await new Promise((done) => setTimeout(done, 10_000));
			const settled = await call(key, 'Checking Higgsfield…', { action: 'settle', key });
			if (!settled) { jobs[key] = { ...jobs[key], phase: 'failed', message: error ?? 'Higgsfield did not return the sheet' }; return; }
			if (!settled.pending) { jobs[key] = { ...jobs[key], phase: 'returned', since: Date.now() }; return; }
			jobs[key] = { ...jobs[key], checked: Date.now() };
		}
		jobs[key] = { ...jobs[key], phase: 'failed', message: 'Still not back after 15 minutes; reload the page to keep checking' };
	}
	const stageLabel: Record<ReturnType<typeof prepStage>, string> = { sources: 'Needs facts', spec: 'Write the prompt', prompt: 'Ready to price', sent: 'Making', made: 'Made' };
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape') zoom = null; }} />
{#if zoom}
	<button type="button" class="zoom" onclick={() => (zoom = null)} aria-label="Close the big picture">
		<img src={zoom.src} alt={zoom.alt} />
		<span class="zoom-cap">{zoom.alt} · click or Esc to close</span>
	</button>
{/if}
<section class="prep" aria-label="Prep">
	<header class="top">
		<div>
			<div class="cap accent">PREP · REFERENCES</div>
			<h2 class="title">What {project.series?.episode_title ?? 'this episode'} needs</h2>
			<p class="lede">Each reference is made to the ONE SHOT standard in one pass from the skill, your images and the facts; you approve it on the price card, then it lands in the References drawer. Characters first, then locations.</p>
		</div>
		<span class="mono">episode spend {spent} cr</span>
	</header>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if loading}<p class="muted">Reading the episode…</p>{/if}

	{#each sections as section (section.kind)}
		<div class="section-head"><span class="cap">{section.label}</span><span class="line"></span><span class="mono">{section.list.length}</span></div>
		{#if section.kind === 'prop'}
			<form class="add" onsubmit={(event) => { event.preventDefault(); if (newProp.trim()) { void call('prop', 'Adding…', { action: 'add_prop', name: newProp }); newProp = ''; } }}>
				<input bind:value={newProp} placeholder="A prop a scene needs, e.g. Red vial" aria-label="New prop name" />
				<button type="submit" class="key" disabled={!newProp.trim()}>Add prop</button>
			</form>
		{/if}
		{#each section.list as item (item.entry.key)}
			{@const key = item.entry.key}
			{@const stage = prepStage(item.state)}
			<article class={['entry', stage === 'made' && 'made']} aria-label={item.entry.name}>
				<div class="entry-head">
					<b class="name">{item.entry.name}</b>
					{#if item.entry.role}<span class="role">{item.entry.role}</span>{/if}
					<span class={['chip', stage]}>{stageLabel[stage]}</span>
					<span class="mono">{item.template}</span>
					{#if busy[key]}<span class="pulse" aria-hidden="true"></span><span class="mono">{busy[key]}</span>{/if}
				</div>
				<div class="graph">
					<!-- 1. source images -->
					<div class="node">
						<div class="node-cap">Source images · what you feed in</div>
						<div class="thumbs">
							{#each item.state.sources as source, i (source.url)}
								<figure><button type="button" class="remove" disabled={!!busy[key]} onclick={() => void call(key, 'Removing…', { action: 'remove_source', key, url: source.url })} title={`Remove ${source.name} (the prompt is rewritten without it)`} aria-label={`Remove ${source.name}`}>×</button><button type="button" class="pic" onclick={() => (zoom = { src: source.url, alt: source.name })} aria-label={`Show ${source.name} big`}><img src={source.url} alt={source.name} loading="lazy" /></button><figcaption>image {i + 1}</figcaption></figure>
							{:else}
								<p class="muted">None yet: {item.template === 'T1' || item.template === 'W3' ? 'made from the facts alone' : ''}</p>
							{/each}
						</div>
						<div class="row">
							<label class="key">Add image<input type="file" accept="image/png,image/jpeg,image/webp" class="hidden-input" onchange={(event) => upload(key, 'source', event.currentTarget.files)} /></label>
							{#if item.current}<button type="button" class="key" disabled={!!busy[key]} onclick={() => void call(key, 'Adding…', { action: 'use_current', key })}>Use current sheet</button>{/if}
						</div>
						{#if item.entry.kind === 'character'}
							<label class="field"><span>Body reference</span><select class="key" aria-label={`Body reference for ${item.entry.name}`} value={item.state.body_source_url ?? ''} disabled={!!busy[key] || !!item.state.job} onchange={(event) => void call(key, 'Saving body reference…', { action: 'set_body_source', key, url: event.currentTarget.value || null })}>
								<option value="">No body reference · create from facts</option>
								{#each item.state.sources as source, i (source.url)}<option value={source.url}>Image {i + 1} · {source.name}</option>{/each}
							</select></label>
							<p class="muted">{item.state.body_source_url ? 'Match this original body exactly. Height and build are omitted from the prompt.' : 'Only a face or partial reference? Describe the body in the facts below.'}</p>
						{/if}
					</div>
					<span class="edge" aria-hidden="true"></span>
					<!-- 2. the facts, then the prompt (one pass: the skill, the images, the facts), then the price card -->
					<div class="node wide">
						<div class="node-cap">Facts · what the pictures can't say</div>
						{#if jobs[key]}
							{@const job = jobs[key]}
							<div class={['job', job.phase]} role="status">
								{#if job.phase === 'sending'}<span class="pulse" aria-hidden="true"></span>Sending to Higgsfield…
								{:else if job.phase === 'making'}<span class="pulse" aria-hidden="true"></span>Making on Higgsfield · sent {clock(job.since)}
								{:else if job.phase === 'returned'}Returned at {clock(job.since)}: the new sheet replaced the one in the References drawer (every render is kept under prep/made).
									<button type="button" class="key" onclick={() => delete jobs[key]}>OK</button>
								{:else}Not made: {job.message} <button type="button" class="key" onclick={() => delete jobs[key]}>OK</button>{/if}
								{#if job.phase !== 'failed'}
									<!-- A sheet usually takes 1–2 minutes: the bar creeps to 95% while making and fills when it is back. -->
									<span class="bar" aria-hidden="true"><span style:width={job.phase === 'returned' ? '100%' : job.phase === 'sending' ? '4%' : `${Math.min(95, 5 + ((now - job.since) / 120_000) * 90)}%`}></span></span>
								{/if}
							</div>
						{/if}
						{#if busy[key] && !(jobs[key] && (jobs[key].phase === 'making' || jobs[key].phase === 'sending'))}<p class="working"><span class="pulse" aria-hidden="true"></span>{busy[key]}{busy[key].startsWith('The Agent') ? ' This takes about a minute.' : ''}</p>{/if}
						{#if drafts[key]}
							{#if item.entry.kind === 'character'}
								{@const id = drafts[key].identity}
								<div class="identity" aria-label="Identity">
									<label><span>Sex</span><input bind:value={id.sex} placeholder="female" /></label>
									<label><span>Age</span><input type="number" min="1" max="120" bind:value={id.age} placeholder="19" /></label>
									{#if !item.state.body_source_url}
										<label><span>Height (cm)</span><input type="number" min="50" max="250" bind:value={id.height_cm} placeholder="168" /></label>
										<label class="wide"><span>Build</span><input bind:value={id.build} placeholder="slim, lightly athletic" /></label>
									{/if}
									<label class="wide"><span>Face</span><input bind:value={id.face} placeholder="pale, watchful, straight dark brows" /></label>
									<label><span>Eyes</span><input bind:value={id.eyes} placeholder="amber-gold eyes" /></label>
									<label class="wide"><span>Hair</span><input bind:value={id.hair} placeholder="dark chin-length bob, centre part" /></label>
									<label class="wide"><span>Marks</span><input bind:value={id.marks} placeholder="cross choker" /></label>
									<label class="wide"><span>Owned element</span><input bind:value={drafts[key].owned_element} placeholder="night-blood vampirism" /></label>
									<label><span>Owned colour</span><input bind:value={drafts[key].colour_name} placeholder="amber" /></label>
									<label><span>Hex</span><input bind:value={drafts[key].colour_hex} placeholder="#D98A2B" /></label>
									<label class="wide"><span>Powers (comma)</span><input bind:value={drafts[key].powers} placeholder="wall-run, blur-step" /></label>
									<label class="full"><span>Ownership lock</span><input bind:value={drafts[key].ownership_lock} placeholder="How it shows physically, never as…" /></label>
								</div>
								<p class="handoff" title="The CHARACTER hand-off line (ONE SHOT): every sheet ends with it and every Ghost shot uses it">{handOffLine(specOf(item), !!item.state.body_source_url)}</p>
								{#if identityGaps(specOf(item), !!item.state.body_source_url).length}<p class="note">Still needs: {identityGaps(specOf(item), !!item.state.body_source_url).join(', ')}. <button type="button" class="key" disabled={!!busy[key]} onclick={() => void call(key, 'The Agent is filling the identity…', { action: 'fill_identity', key })}>Fill identity</button></p>{/if}
							{/if}
							<label class="field"><span>{item.entry.kind === 'character' ? 'Notes · only changes from the pictures (e.g. dry hair, teal plaid instead of the hoodie)' : 'Notes · what it is, its era, sizes in metres'}</span><textarea rows="3" bind:value={drafts[key].notes}></textarea></label>
							<div class="row">
								<button type="button" class="key" disabled={!!busy[key]} onclick={() => void call(key, 'Saving…', { action: 'save_spec', key, spec: specOf(item), approve: false })}>Save facts</button>
								<button type="button" class="key" disabled={!!busy[key]} onclick={() => void call(key, 'The Agent is drafting the facts…', { action: 'draft_spec', key })}>Redraft facts</button>
							</div>
						{:else}
							<button type="button" class="key on" disabled={!!busy[key]} onclick={() => void call(key, 'The Agent is drafting the facts…', { action: 'draft_spec', key })}>Draft facts</button>
						{/if}
						{#if drafts[key]}
							<div class="node-cap sub">Prompt · written from the skill, the images and the facts{item.state.prompt_edited ? ' · edited by hand' : ''}</div>
							{#if promptDrafts[key] !== undefined}
								<textarea class="prompt" rows="6" bind:value={promptDrafts[key]} aria-label="Prompt"></textarea>
								<div class="row">
									{#if promptDrafts[key] !== item.state.prompt}<button type="button" class="key" disabled={!!busy[key]} onclick={() => void call(key, 'Saving…', { action: 'edit_prompt', key, prompt: promptDrafts[key] })}>Keep my edit</button>{/if}
									<button type="button" class="key" disabled={!!busy[key]} onclick={() => { delete promptDrafts[key]; void writePrompt(item); }}>Rewrite</button>
									<button type="button" class="key on" disabled={!!busy[key] || promptDrafts[key] !== item.state.prompt} onclick={() => void quote(key)}>Check and price</button>
								</div>
							{:else}
								{@const gaps = factsGaps(specOf(item), item.entry.kind, !!item.state.body_source_url)}
								<button type="button" class="key on" disabled={!!busy[key] || gaps.length > 0} title={gaps.length ? `Fill in ${gaps.join(', ')} first` : 'The Agent looks at the images, gives each one its job and writes the prompt'} onclick={() => void writePrompt(item)}>Write prompt</button>
							{/if}
							{#if approvals[key]}
								<StillApprovalCard title={`${item.entry.name} · ${item.template}`} approval={approvals[key]} busy={!!busy[key]} busyLabel={busy[key] ?? ''} onapprove={(approval) => void make(key, approval)} />
							{/if}
						{/if}
					</div>
					<span class="edge" aria-hidden="true"></span>
					<!-- 3. the reference -->
					<div class="node">
						<div class="node-cap">Reference · what comes back</div>
						{#if item.state.result}
							<button type="button" class="pic" onclick={() => (zoom = { src: item.state.result!.url, alt: `${item.entry.name} reference` })} aria-label={`Show ${item.entry.name}'s reference big`}><img class="sheet" src={item.state.result.url} alt={`${item.entry.name} reference`} loading="lazy" /></button>
							{@const madeAt = Date.parse(item.state.result.made_at)}
							<p class="muted">{#if now - madeAt < 15 * 60_000}<span class="new">New</span> {/if}Made {clock(madeAt)}{item.state.result.uploaded ? ' · in the References drawer' : ''}{item.state.result.outside ? ' · made outside' : ''}</p>
							{#if item.state.result.note}<p class="note">{item.state.result.note}</p>{/if}
							{#if item.entry.kind === 'character'}
								{@const scale = item.state.result.scale}
								<div class="node-cap sub">Proportions · original vs generated front</div>
								{#if scale?.method === 'original-front-v1'}
									<button type="button" class="pic" onclick={() => (zoom = { src: scale.overlay_url, alt: `${item.entry.name}: original cutout, generated front, and original at 50% over generated. Same body width; feet aligned; uniform scaling only.` })} aria-label={`Show ${item.entry.name}'s original comparison big`}><img class="overlay" src={scale.overlay_url} alt={`${item.entry.name}: original and generated front comparison`} loading="lazy" /></button>
									<p class="muted">{scale.verdict}</p>
								{:else}
									<p class="muted">Choose the original front full-body source below. Bigger is expected: compare proportions after uniform scaling. Old rear-panel verdicts are retired.</p>
								{/if}
								<div class="row">
									{#each item.state.sources as source, i (source.url)}
										<button type="button" class="key" disabled={!!busy[key]} onclick={() => void call(key, 'Preparing original comparison…', { action: 'scale_check', key, source_url: source.url })} title={`Compare the front full-body view in ${source.name} with the generated front. Uniform scaling; matched body width and aligned feet.`}>Compare original image {i + 1}</button>
									{/each}
									{#if !item.state.sources.length}<p class="muted">Add an original full-body source to compare.</p>{/if}
								</div>
							{/if}
						{:else if item.current}
							<button type="button" class="pic" onclick={() => (zoom = { src: item.current!.url, alt: `${item.entry.name}, current sheet` })} aria-label={`Show ${item.entry.name}'s current sheet big`}><img class="sheet old" src={item.current.url} alt={`${item.entry.name}, current sheet`} loading="lazy" /></button>
							<p class="muted">Current sheet (not yet ONE SHOT)</p>
						{:else}
							<p class="muted">Not made yet</p>
						{/if}
						<label class="key">Attach a sheet made outside<input type="file" accept="image/png,image/jpeg,image/webp" class="hidden-input" onchange={(event) => upload(key, 'attach', event.currentTarget.files)} /></label>
					</div>
					<span class="edge" aria-hidden="true"></span>
					<!-- 4. scenes -->
					<div class="node narrow">
						<div class="node-cap">Used in</div>
						<div class="scenes">
							{#each item.entry.scenes as scene (scene.page_id)}<span class="scene-chip">{scene.title}</span>{:else}<span class="muted">No scene yet</span>{/each}
						</div>
					</div>
				</div>
			</article>
		{:else}
			{#if section.kind !== 'prop'}<p class="muted">Nothing listed.</p>{/if}
		{/each}
	{/each}
</section>

<style>
	.prep { margin: 0 auto; max-width: 1280px; padding: 20px; display: grid; gap: 12px; }
	.top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
	.cap { color: var(--color-nr-dim); font: 600 10px var(--font-sans); letter-spacing: 0.16em; text-transform: uppercase; }
	.cap.accent { color: var(--color-nr-accent); }
	.title { margin-top: 4px; color: var(--color-nr-mark); font-size: 18px; font-weight: 600; }
	.lede { margin-top: 4px; max-width: 720px; color: var(--color-nr-muted); font-size: 12.5px; line-height: 1.6; }
	.mono { color: var(--color-nr-muted); font: 11px var(--font-mono); white-space: nowrap; }
	.muted { color: var(--color-nr-muted); font-size: 11.5px; }
	.error { border: 1px solid var(--color-nr-danger-line); border-radius: 2px; padding: 8px 10px; color: var(--color-nr-danger-text); font-size: 12px; }
	.section-head { margin-top: 10px; display: flex; align-items: center; gap: 10px; }
	.section-head .line { flex: 1; height: 1px; background: var(--color-nr-line-soft); }
	.add { display: flex; gap: 8px; }
	.add input { width: 280px; border: 1px solid var(--color-nr-line); border-radius: 2px; background: var(--color-nr-deep); padding: 4px 8px; color: var(--color-nr-ink); font-size: 12px; outline: none; }
	.add input:focus { border-color: color-mix(in srgb, var(--color-nr-accent) 50%, transparent); }
	.entry { display: grid; gap: 8px; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; padding: 10px; }
	.entry.made { background: color-mix(in srgb, var(--color-nr-accent) 4%, transparent); }
	.entry-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
	.name { color: var(--color-nr-ink); font-size: 13.5px; font-weight: 600; }
	.role { color: var(--color-nr-muted); font-size: 12px; }
	.chip { border: 1px solid var(--color-nr-line); border-radius: 2px; padding: 0 6px; color: var(--color-nr-dim); font: 10px/16px var(--font-mono); }
	.chip.spec, .chip.approved, .chip.prompt { border-color: color-mix(in srgb, #4ab8ff 45%, transparent); color: #4ab8ff; }
	.chip.sent { border-color: color-mix(in srgb, #8174e8 50%, transparent); color: #a99ff2; }
	.chip.made { border-color: color-mix(in srgb, var(--color-nr-accent) 40%, transparent); color: var(--color-nr-accent); }
	.graph { display: grid; grid-template-columns: minmax(180px, 1fr) 18px minmax(280px, 2fr) 18px minmax(180px, 1fr) 18px minmax(120px, 0.7fr); align-items: start; }
	.edge { align-self: center; height: 2px; background: linear-gradient(90deg, #4ee8d2, #4ab8ff 60%, #8174e8); opacity: 0.6; }
	.node { display: grid; gap: 6px; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; background: var(--color-nr-deep); padding: 8px; min-width: 0; }
	.node-cap { color: var(--color-nr-dim); font: 600 9px var(--font-sans); letter-spacing: 0.14em; text-transform: uppercase; }
	.node-cap.sub { margin-top: 6px; }
	.thumbs { display: flex; flex-wrap: wrap; gap: 6px; }
	.thumbs figure { position: relative; margin: 0; display: grid; gap: 2px; }
	.thumbs img { width: 72px; height: 54px; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; object-fit: cover; }
	.thumbs figcaption { color: #4ab8ff; font: 600 9px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; }
	/* A small x on the picture's top-right corner. */
	.remove { z-index: 1; position: absolute; top: 3px; right: 3px; display: grid; place-items: center; width: 16px; height: 16px; border: 1px solid var(--color-nr-line); border-radius: 2px; background: rgb(5 7 10 / 0.8); padding: 0; color: var(--color-nr-ink); font: 600 11px/1 var(--font-sans); cursor: pointer; }
	.remove:hover:not(:disabled) { border-color: var(--color-nr-danger-line); color: var(--color-nr-danger-text); }
	.remove:disabled { opacity: 0.4; cursor: default; }
	.sheet { width: 100%; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; object-fit: contain; background: #000; }
	.sheet.old { opacity: 0.55; }
	.pic { display: block; border: 0; background: transparent; padding: 0; cursor: zoom-in; }
	.pic:hover img { border-color: color-mix(in srgb, var(--color-nr-accent) 55%, transparent); }
	.zoom { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; gap: 8px; border: 0; background: rgb(5 7 10 / 0.92); padding: 24px; cursor: zoom-out; }
	.zoom img { max-width: 100%; max-height: calc(100vh - 80px); object-fit: contain; border: 1px solid var(--color-nr-line); border-radius: 2px; }
	.zoom-cap { color: var(--color-nr-muted); font: 11px var(--font-mono); }
	.note { color: #a99ff2; font-size: 11px; }
	.overlay { width: 100%; max-height: 220px; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; object-fit: contain; background: #fff; }
	.scale { font-size: 11px; }
	.scale.ok { color: #4ee8d2; }
	.scale.off { color: var(--color-nr-danger-text); }
	.identity { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
	.identity label { display: grid; gap: 2px; min-width: 0; }
	.identity label.wide { grid-column: span 2; }
	.identity label.full { grid-column: 1 / -1; }
	.identity span { color: var(--color-nr-dim); font-size: 10.5px; }
	.identity em { color: var(--color-nr-muted); font: normal 10px var(--font-mono); }
	.identity input { min-width: 0; border: 1px solid var(--color-nr-line); border-radius: 2px; background: #0b0d11; padding: 3px 6px; color: var(--color-nr-ink); font: 12px var(--font-sans); outline: none; }
	.identity input:focus { border-color: color-mix(in srgb, var(--color-nr-accent) 50%, transparent); }
	.handoff { border: 1px solid var(--color-nr-line-soft); border-radius: 2px; background: #0b0d11; padding: 6px 8px; color: var(--color-nr-text); font: 11px/1.5 var(--font-mono); }
	.job { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; border: 1px solid color-mix(in srgb, #8174e8 50%, transparent); border-radius: 2px; padding: 6px 8px; color: #a99ff2; font-size: 12px; }
	.job.returned { border-color: color-mix(in srgb, #4ee8d2 45%, transparent); color: #4ee8d2; }
	.bar { flex-basis: 100%; height: 3px; border-radius: 2px; background: var(--color-nr-line-soft); overflow: hidden; }
	.bar span { display: block; height: 100%; background: linear-gradient(90deg, #4ee8d2, #4ab8ff 60%, #8174e8); transition: width 900ms linear; }
	.new { border: 1px solid color-mix(in srgb, #4ee8d2 50%, transparent); border-radius: 2px; padding: 0 5px; color: #4ee8d2; font: 600 9px/15px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; }
	.job.failed { border-color: var(--color-nr-danger-line); color: var(--color-nr-danger-text); }
	.working { display: flex; align-items: center; gap: 8px; border: 1px solid color-mix(in srgb, #4ab8ff 40%, transparent); border-radius: 2px; padding: 6px 8px; color: #4ab8ff; font-size: 12px; }
	.row { display: flex; flex-wrap: wrap; gap: 6px; }
	.field { display: grid; gap: 3px; }
	.field span { color: var(--color-nr-dim); font-size: 10.5px; }
	textarea { width: 100%; resize: vertical; border: 1px solid var(--color-nr-line); border-radius: 2px; background: #0b0d11; padding: 6px 8px; color: var(--color-nr-ink); font: 12px/1.5 var(--font-sans); outline: none; }
	textarea:focus { border-color: color-mix(in srgb, var(--color-nr-accent) 50%, transparent); }
	textarea.prompt { font: 11px/1.55 var(--font-mono); }
	.scenes { display: flex; flex-wrap: wrap; gap: 4px; }
	.scene-chip { border: 1px solid var(--color-nr-line); border-radius: 2px; padding: 0 6px; color: var(--color-nr-text); font: 10.5px/18px var(--font-sans); }
	.key { position: relative; display: inline-flex; align-items: center; border: 1px solid var(--color-nr-line); border-radius: 2px; background: transparent; padding: 0 10px; color: var(--color-nr-muted); font: 600 9px/24px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer; transition: border-color 140ms ease, color 140ms ease; }
	.key:hover:not(:disabled) { border-color: color-mix(in srgb, var(--color-nr-accent) 55%, transparent); color: var(--color-nr-ink); }
	.key.on { border-color: color-mix(in srgb, var(--color-nr-accent) 45%, transparent); color: var(--color-nr-accent); }
	.key:disabled { opacity: 0.5; cursor: default; }
	.hidden-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
	.pulse { width: 6px; height: 6px; border-radius: 50%; background: #4ab8ff; animation: pulse 1.2s ease-in-out infinite; }
	@keyframes pulse { 50% { opacity: 0.25; } }
	@media (max-width: 900px) { .graph { grid-template-columns: 1fr; gap: 8px; } .edge { display: none; } }
	@media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
</style>
