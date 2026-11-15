<script lang="ts">
	import type { Project } from '$lib/domain/schemas';
	import { plannedCardId, type StoryPlan } from '$lib/domain/story-plan';
	let { project, onUpdated, onPrep, onBoard }: { project: Project; onUpdated: (project: Project) => void; onPrep: () => void; onBoard: () => void } = $props();
	let plan = $state<StoryPlan | null>(null);
	let loadedVersion = $state(-1);
	let busy = $state(false);
	let dirty = $state(false);
	let error = $state('');
	let note = $state('');
	let targetSeconds = $state(105);
	$effect(() => {
		if (project.version !== loadedVersion) {
			loadedVersion = project.version;
			plan = project.production.story_plan ? structuredClone($state.snapshot(project.production.story_plan)) : null;
			dirty = false;
		}
	});
	const moments = $derived(plan?.sections.flatMap(section => section.moments) ?? []);
	const shots = $derived(moments.filter(moment => moment.approved).flatMap(moment => moment.shots));
	const seconds = $derived(moments.reduce((sum, moment) => sum + moment.duration_s, 0));
	const added = $derived(shots.filter(shot => project.production.cards.some(card => card.card_id === plannedCardId(shot.id))).length);
	const stamp = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
	const total = (section: StoryPlan['sections'][number]) => section.moments.reduce((sum, moment) => sum + moment.duration_s, 0);
	const start = (index: number) => plan?.sections.slice(0, index).reduce((sum, section) => sum + total(section), 0) ?? 0;
	async function send(action: 'save' | 'board' | 'approve' | 'breakdown' | 'moments', moment_id?: string) {
		busy = true; error = ''; note = '';
		try {
			const response = await fetch(`/api/projects/${project.project_id}/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, expected_version: project.version, ...(action === 'save' ? { plan } : {}), ...(action === 'moments' ? { target_s:targetSeconds } : {}), ...(moment_id ? { moment_id } : {}) }) });
			const result = await response.json();
			if (!result.ok) throw new Error(result.error?.message ?? 'Could not save the plan');
			onUpdated(result.data); dirty = false;
			note = action === 'moments' ? 'Moments proposed for your review. No shots or media were created.' : action === 'save' ? 'Moment plan saved.' : action === 'approve' ? 'Moment approved. You can now draft its shots.' : action === 'breakdown' ? 'Shot breakdown drafted for review; no media was generated.' : 'Planned shots added in new board groups. They stay benched until you choose to use them.';
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Could not save the plan'; }
		finally { busy = false; }
	}
</script>

{#if plan}
<section class="plan" aria-label="Trailer story and shot plan">
	<header>
			<div><p class="eyebrow">BIBLE · MOMENTS · SHOTS</p><h2>{plan.title}</h2><p class="intro">Choose the moments first. Approve a moment, draft its shots, then prepare references and add shots to the Board.</p></div>
		<div class="metrics"><strong>{stamp(seconds)}</strong><span>{moments.length} moments · {moments.filter(moment => moment.approved).length} approved<br />{shots.length} shots drafted · {added} on board</span></div>
	</header>
	{#if plan.footage_source_project_id}<p class="hint"><a href={`/?project=${plan.footage_source_project_id}&tab=beats`} target="_blank" rel="noreferrer">Review the original test footage</a> · The existing project remains the source pool.</p>{/if}
	{#if plan.source}<details class="act"><summary>Source Bible · {plan.source.title}</summary><p class="hint">Imported {new Date(plan.source.imported_at).toLocaleDateString()}. The trailer plan follows this source; its proposals do not change canon.</p>{#if plan.source.url}<a href={plan.source.url} target="_blank" rel="noreferrer">Open Bible in Notion</a>{/if}<pre class="bible">{plan.source.text}</pre></details>{/if}
	<div class="actions">
		{#if !moments.length}<label>Trailer target (seconds)<input type="number" min="15" max="600" step="1" bind:value={targetSeconds} /></label><button type="button" class="primary" disabled={busy || dirty} onclick={() => void send('moments')}>{busy ? 'Proposing moments…' : 'Draft proposed moments from Bible'}</button>{/if}
		<button type="button" class="primary" onclick={onPrep} disabled={dirty || busy}>Continue to Prep</button>
		<button type="button" onclick={() => void send('board')} disabled={dirty || busy || added === shots.length || !shots.length}>Add {shots.length - added} missing shots to Board</button>
		{#if added}<button type="button" onclick={onBoard} disabled={dirty || busy}>Open trailer Board</button>{/if}
		{#if dirty}<button type="button" class="primary" onclick={() => void send('save')} disabled={busy}>Save moment plan</button>{/if}
	</div>
	<p class="hint">Existing boards and footage stay intact. Candidate takes are suggestions; they do not change picks. New planned shots are added benched for review.</p>
	{#if dirty}<p class="hint">Save your shot-plan edits before continuing. Story text uses Save workspace.</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if note}<p role="status">{note}</p>{/if}
	{#each plan.sections as section, i (section.id)}
		<section class="act" aria-label={section.title}>
			<div class="act-heading"><span class="time">{stamp(start(i))}–{stamp(start(i) + total(section))}</span><h3>{section.title}</h3><span>{section.moments.length} moments · {section.moments.flatMap(moment => moment.shots).length} shots · {total(section)}s</span></div>
			<p class="summary">{section.summary}</p>
			{#each section.moments as shot, j (shot.id)}
				<details class="shot">
					<summary><span class="number">{String(j + 1).padStart(2, '0')}</span><span class="shot-name">{shot.title}</span><span class="length">{shot.duration_s}s</span><span class="state">{shot.approved ? 'Approved moment' : 'Proposed moment'}</span></summary>
					<div class="shot-body">
						<label>Moment title<input bind:value={shot.title} oninput={() => { dirty = true; shot.approved = false; shot.shots = []; }} maxlength="180" /></label>
						<label>What happens and what the audience should think<textarea bind:value={shot.beat} oninput={() => { dirty = true; shot.approved = false; shot.shots = []; }} rows="4" maxlength="4000"></textarea></label>
						<div class="shot-facts"><label>Trailer time (seconds)<input type="number" min="0.001" max="120" step="0.001" bind:value={shot.duration_s} oninput={() => { dirty = true; shot.approved = false; shot.shots = []; }} /></label><p>Longer source performances can be cut across this moment.</p></div>
						<label>Characters (comma separated)<input value={shot.characters.join(', ')} oninput={(event) => { shot.characters = event.currentTarget.value.split(',').map(name => name.trim()).filter(Boolean); dirty = true; shot.approved = false; shot.shots = []; }} /></label>
						<label>Location<input bind:value={shot.location} oninput={() => { dirty = true; shot.approved = false; shot.shots = []; }} maxlength="200" /></label>
						<label>Candidate footage<select value={shot.candidate_asset_id ?? ''} onchange={(event) => { shot.candidate_asset_id = event.currentTarget.value || undefined; dirty = true; }}><option value="">New coverage / choose later</option>{#each project.production.assets.filter(asset => asset.kind === 'video') as asset (asset.asset_id)}<option value={asset.asset_id}>{asset.name}</option>{/each}</select></label>
						{#if shot.candidate_asset_id}{@const asset = project.production.assets.find(asset => asset.asset_id === shot.candidate_asset_id)}{#if asset}<a href={asset.url} target="_blank" rel="noreferrer">Review candidate clip</a>{/if}{/if}
						<div class="actions">{#if !shot.approved}<button type="button" class="primary" disabled={dirty || busy} onclick={() => void send('approve', shot.id)}>Approve this moment</button>{:else if !shot.shots.length}<button type="button" class="primary" disabled={dirty || busy} onclick={() => void send('breakdown', shot.id)}>{busy ? 'Drafting…' : 'Draft shots for this moment'}</button>{/if}</div>
						{#if shot.shots.length}<p class="hint">Shot breakdown · {shot.shots.reduce((sum, entry) => sum + entry.duration_s, 0)}s. Review before adding to Board.</p>{#each shot.shots as entry (entry.id)}<div class="breakdown"><b>{entry.title} · {entry.duration_s}s</b><p>{entry.beat}</p></div>{/each}{/if}
					</div>
				</details>
			{/each}
			<button type="button" disabled={busy} onclick={() => { section.moments.push({ id: crypto.randomUUID(), title: 'New moment', beat: 'Describe what happens and what the audience should suspect.', duration_s: 8, characters: [], location: '', approved: false, shots: [] }); dirty = true; }}>Add moment</button>
		</section>
	{/each}
</section>
{/if}

<style>
	.bible {white-space:pre-wrap;max-height:380px;overflow:auto;font:12px/1.8 var(--font-sans);padding:16px;background:#10191f;} .breakdown {padding:10px 0;border-top:1px solid #294047;font-size:12px;line-height:1.7;} .breakdown p {color:#8ba6ae;}
	.plan { color: #b9d0d2; margin-bottom: 36px; } header { display:flex; justify-content:space-between; gap:24px; align-items:start; } h2 { font-size:24px; color:#d7efed; margin:8px 0; font-weight:600; } .eyebrow,.time,.number,.state,.metrics span { font:10px var(--font-mono,monospace); letter-spacing:.08em; } .eyebrow {color:#66d9ca;} .intro,.hint,.summary {font-size:12px;line-height:1.7;color:#819fa5;} .metrics {display:flex;gap:14px;align-items:center;white-space:nowrap;} .metrics strong {font-size:30px;font-weight:400;color:#b8eee5;} .metrics span {line-height:1.9;} .actions {display:flex;gap:8px;flex-wrap:wrap;margin:20px 0 8px;} button {border:1px solid #355155;padding:9px 12px;color:#b3d5d4;font-size:12px;background:#101b20;cursor:pointer;} button.primary {background:#16483f;border-color:#2c7c6c;color:#c5f7e8;} button:disabled {opacity:.45;cursor:default;} .hint {font-size:11px;} .act {border-top:1px solid #294047;margin-top:26px;padding-top:15px;} .act-heading {display:flex;align-items:center;gap:16px;} .act-heading h3 {font-size:16px;color:#c9e2df;flex:1;} .act-heading>span:last-child {font-size:11px;color:#83a6aa;white-space:nowrap;} .time {color:#5cbcaf;min-width:90px;} .summary {margin:8px 0 12px;} .shot {border-top:1px solid #1d2d35;} summary {display:flex;gap:12px;align-items:center;padding:12px 2px;cursor:pointer;font-size:12px;list-style:none;} summary::before {content:'+';color:#629b9e;} details[open]>summary::before {content:'−';} .number {color:#587c86;} .shot-name {flex:1;} .length {color:#8fbbbc;min-width:30px;} .state {color:#8b9c99;width:125px;text-align:right;font-size:9px;} .shot-body {padding:8px 18px 18px;background:#10191f;} label {display:block;font-size:11px;color:#91afb3;margin:10px 0;} input,textarea,select {display:block;width:100%;border:1px solid #30434b;background:#0c141a;padding:8px;color:#bed3d5;font-size:12px;margin-top:5px;} .shot-facts {display:flex;gap:24px;align-items:center;font-size:11px;} .shot-facts label {max-width:180px;} a {font-size:12px;color:#7bd7c6;} .error {color:#f6a6a2;font-size:12px;} :is(button,input,textarea,select,summary,a):focus-visible {outline:2px solid #7bd7c6;outline-offset:3px;} @media(max-width:600px) {header {flex-direction:column;gap:10px;} .act-heading {flex-wrap:wrap;gap:8px;} .time {min-width:auto;} .state {width:85px;font-size:8px;} .shot-facts {flex-direction:column;align-items:start;gap:0;}}
</style>
