<script lang="ts">
	import type { Project } from '$lib/domain/schemas';
	import { boardCardFor, currentEdit, groupMeasures, sceneGroupId, shortShotCode, type GroupMeasure, type StoryPlan, type PlanScene } from '$lib/domain/story-plan';
	import { cutLength } from '$lib/domain/cuts';
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
	type Section = StoryPlan['sections'][number];
	type Beat = Section['moments'][number];
	const beats = $derived(plan?.sections.flatMap(section => section.moments) ?? []);
	const shots = $derived(beats.filter(beat => beat.approved).flatMap(beat => beat.shots));
	const seconds = $derived(beats.reduce((sum, beat) => sum + beat.duration_s, 0));
	const added = $derived(shots.filter(shot => boardCardFor(project.production, shot)).length);
	const room = $derived(project.review_room);
	/** The Review Room scene a scene's board group already has (codes never change once given). */
	const storedScene = (scene: PlanScene) => room?.scenes?.[sceneGroupId(scene)];
	const groupName = (groupId?: string) => project.production.groups?.find(group => group.group_id === groupId)?.name ?? 'Main board';
	const boardGroups = $derived(project.production.groups ?? []);
	const boardShots = $derived(project.production.cards.toSorted((a, b) => groupName(a.group_id).localeCompare(groupName(b.group_id)) || a.order - b.order));
	const codeOf = (cardId: string) => room?.shots?.[cardId]?.code;
	const shortCode = (cardId: string) => shortShotCode(codeOf(cardId));
	// Real length and shots from the board and the current edit (the cut worked on last), not only from story beats.
	const edit = $derived(currentEdit(project.production));
	const measures = $derived(groupMeasures(project.production));
	const editSeconds = $derived(edit ? cutLength(edit) : 0);
	const inEdit = $derived(new Set(edit?.entries.map(entry => entry.card_id) ?? []).size);
	/** A scene's board group, once it has one (linked, or made by Add to Board). */
	const sceneGroup = (scene: PlanScene) => scene.group_id ?? (project.production.groups?.some(group => group.group_id === sceneGroupId(scene)) ? sceneGroupId(scene) : undefined);
	const sceneMeasure = (scene: PlanScene): GroupMeasure | null => { const id = sceneGroup(scene); return id ? measures.get(id) ?? { shots: 0, in_edit: 0, edit_s: 0 } : null; };
	const sectionMeasure = (section: Section): GroupMeasure => [...new Set(section.scenes.map(sceneGroup).filter((id): id is string => !!id))]
		.reduce((sum, id) => { const m = measures.get(id); return m ? { shots: sum.shots + m.shots, in_edit: sum.in_edit + m.in_edit, edit_s: sum.edit_s + m.edit_s } : sum; }, { shots: 0, in_edit: 0, edit_s: 0 });
	/** An act's length: its scenes' time in the edit when there is an edit, else its story beats' planned time. */
	const actSeconds = (section: Section) => edit ? sectionMeasure(section).edit_s : total(section);
	const totalSeconds = $derived(edit ? editSeconds : seconds);
	/** Once scenes or shots exist, the length comes from the edit: the target and the Bible draft step away. */
	const started = $derived(project.production.cards.length > 0 || (plan?.sections.some(section => section.scenes.length) ?? false));
	const stamp = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
	const total = (section: Section) => section.moments.reduce((sum, beat) => sum + beat.duration_s, 0);
	const start = (index: number) => plan?.sections.slice(0, index).reduce((sum, section) => sum + actSeconds(section), 0) ?? 0;
	/** Story beats in scene order: each scene's beats under it, then any beat not yet in a scene. */
	const grouped = (section: Section): Array<{ scene: PlanScene | null; beats: Beat[] }> => [
		...section.scenes.map(scene => ({ scene, beats: section.moments.filter(beat => beat.scene_id === scene.id) })),
		{ scene: null, beats: section.moments.filter(beat => !beat.scene_id || !section.scenes.some(scene => scene.id === beat.scene_id)) }
	].filter(entry => entry.scene || entry.beats.length);
	const sceneCode = (scene: PlanScene) => storedScene(scene)?.code ?? scene.scene_code;
	function setCode(scene: PlanScene, input: HTMLInputElement) {
		const code = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
		input.value = code; scene.scene_code = code.length === 3 ? code : undefined; dirty = true;
	}
	function mapGroup(scene: PlanScene, groupId: string) {
		scene.group_id = groupId || undefined;
		const stored = scene.group_id ? room?.scenes?.[scene.group_id] : undefined;
		if (stored) scene.scene_code = stored.code;
		dirty = true;
	}
	async function send(action: 'save' | 'board' | 'approve' | 'breakdown' | 'moments' | 'refresh_source', moment_id?: string) {
		busy = true; error = ''; note = '';
		try {
			const response = await fetch(`/api/projects/${project.project_id}/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, expected_version: project.version, ...(action === 'save' ? { plan } : {}), ...(action === 'moments' ? { target_s:targetSeconds } : {}), ...(moment_id ? { moment_id } : {}) }) });
			const result = await response.json();
			if (!result.ok) throw new Error(result.error?.message ?? 'Could not save the plan');
			onUpdated(result.data); dirty = false;
			note = action === 'refresh_source' ? `Bible refreshed from Notion: ${result.source?.title ?? 'current story'}.` : action === 'moments' ? 'Story beats proposed for your review. No shots or media were created.' : action === 'save' ? 'Story plan saved.' : action === 'approve' ? 'Story beat approved. You can now draft its shots.' : action === 'breakdown' ? 'Shot breakdown drafted for review; no media was generated.' : `Planned shots added to their scenes' board groups, benched until you use them.${project.review_room ? ' Scenes with a scene code now have their Review Room folders.' : ''}`;
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Could not save the plan'; }
		finally { busy = false; }
	}
</script>

{#snippet beatRow(beat: Beat, j: number, section: Section)}
	<details class="shot">
		<summary><span class="number">{String(j + 1).padStart(2, '0')}</span><span class="shot-name">{beat.title}</span><span class="length">{beat.duration_s}s</span><span class="state">{beat.approved ? 'Approved story beat' : 'Proposed story beat'}</span></summary>
		<div class="shot-body">
			<label>Story beat<input bind:value={beat.title} oninput={() => { dirty = true; beat.approved = false; beat.shots = []; }} maxlength="180" /></label>
			<label>What happens and what the audience should think<textarea bind:value={beat.beat} oninput={() => { dirty = true; beat.approved = false; beat.shots = []; }} rows="4" maxlength="4000"></textarea></label>
			<div class="shot-facts"><label>Trailer time (seconds)<input type="number" min="0.001" max="120" step="0.001" bind:value={beat.duration_s} oninput={() => { dirty = true; beat.approved = false; beat.shots = []; }} /></label><p>Longer source performances can be cut across this story beat.</p></div>
			{#if section.scenes.length}<label>Scene<select value={beat.scene_id ?? ''} onchange={(event) => { beat.scene_id = event.currentTarget.value || undefined; dirty = true; }}><option value="">Not in a scene yet</option>{#each section.scenes as scene (scene.id)}<option value={scene.id}>{sceneCode(scene) ? `${sceneCode(scene)} · ` : ''}{scene.title}</option>{/each}</select></label>{/if}
			<label>Characters (comma separated)<input value={beat.characters.join(', ')} oninput={(event) => { beat.characters = event.currentTarget.value.split(',').map(name => name.trim()).filter(Boolean); dirty = true; beat.approved = false; beat.shots = []; }} /></label>
			<label>Location<input bind:value={beat.location} oninput={() => { dirty = true; beat.approved = false; beat.shots = []; }} maxlength="200" /></label>
			<label>Candidate footage<select value={beat.candidate_asset_id ?? ''} onchange={(event) => { beat.candidate_asset_id = event.currentTarget.value || undefined; dirty = true; }}><option value="">New coverage / choose later</option>{#each project.production.assets.filter(asset => asset.kind === 'video') as asset (asset.asset_id)}<option value={asset.asset_id}>{asset.name}</option>{/each}</select></label>
			{#if beat.candidate_asset_id}{@const asset = project.production.assets.find(asset => asset.asset_id === beat.candidate_asset_id)}{#if asset}<a href={asset.url} target="_blank" rel="noreferrer">Review candidate clip</a>{/if}{/if}
			<div class="actions">{#if !beat.approved}<button type="button" class="primary" disabled={dirty || busy} onclick={() => void send('approve', beat.id)}>Approve this story beat</button>{:else if !beat.shots.length}<button type="button" class="primary" disabled={dirty || busy} onclick={() => void send('breakdown', beat.id)}>{busy ? 'Drafting…' : 'Draft shots for this story beat'}</button>{/if}</div>
			{#if beat.shots.length}<p class="hint">Shot breakdown · {beat.shots.reduce((sum, entry) => sum + entry.duration_s, 0)}s. Review before adding to Board.</p>{#each beat.shots as entry (entry.id)}{@const covered = boardCardFor(project.production, entry)}<div class="breakdown"><b>{entry.title} · {entry.duration_s}s</b><p>{entry.beat}</p>
					<label>Covered by board shot<select value={entry.card_id ?? ''} onchange={(event) => { entry.card_id = event.currentTarget.value || undefined; dirty = true; }}><option value="">New shot on Add to Board</option>{#each boardShots as card (card.card_id)}<option value={card.card_id}>{shortCode(card.card_id) ? `${shortCode(card.card_id)} · ` : ''}{card.title} · {groupName(card.group_id)}</option>{/each}</select></label>
					{#if covered}<p class="on-board">On board · {groupName(covered.group_id)} · {shortCode(covered.card_id) ? `${shortCode(covered.card_id)} · ` : ''}{covered.title}{codeOf(covered.card_id) ? '' : ' · no Review Room code yet'}</p>{/if}</div>{/each}{/if}
		</div>
	</details>
{/snippet}

{#if plan}
<section class="plan" aria-label="Trailer story and shot plan">
	<header>
			<div><p class="eyebrow">BIBLE · ACTS · SCENES · STORY BEATS · SHOTS</p><h2>{plan.title}</h2><p class="intro">Choose the story beats first. Put each in its scene, approve it, draft its shots, then prepare references and add shots to the Board.</p></div>
		<div class="metrics"><strong title={edit ? `Length of the edit ${edit.name}` : 'Planned length of the story beats'}>{stamp(totalSeconds)}</strong><span>{project.production.cards.length} shots on board{#if edit} · {inEdit} in the edit{/if}<br />{#if edit}<span class="edit-name">Edit · {edit.name}</span>{:else}{beats.length} story beats · {beats.filter(beat => beat.approved).length} approved{/if}</span></div>
	</header>
	{#if plan.footage_source_project_id}<p class="hint"><a href={`/?project=${plan.footage_source_project_id}&tab=beats`} target="_blank" rel="noreferrer">Review the original test footage</a> · The existing project remains the source pool.</p>{/if}
	{#if plan.source}<details class="act"><summary>Source Bible · {plan.source.title}</summary><p class="hint">Imported {new Date(plan.source.imported_at).toLocaleDateString()}. The trailer plan follows this source; its proposals do not change canon.</p>{#if plan.source.url}<a href={plan.source.url} target="_blank" rel="noreferrer">Open Bible in Notion</a>{/if}{#if plan.source.series_id}<button type="button" class="agent-mini" disabled={busy || dirty} onclick={() => send('refresh_source')} title={dirty ? 'Save your plan edits first' : 'Read the current Bible from Notion again (the page marked CURRENT)'}>Refresh from Notion</button>{/if}<pre class="bible">{plan.source.text}</pre></details>{/if}
	<div class="actions">
		{#if !beats.length && !started}<label>Trailer target (seconds)<input type="number" min="15" max="600" step="1" bind:value={targetSeconds} /></label><button type="button" class="primary" disabled={busy || dirty} onclick={() => void send('moments')}>{busy ? 'Proposing story beats…' : 'Draft proposed story beats from Bible'}</button>{/if}
		<button type="button" class="primary" onclick={onPrep} disabled={dirty || busy}>Continue to Prep</button>
		{#if shots.length}<button type="button" onclick={() => void send('board')} disabled={dirty || busy || added === shots.length}>Add {shots.length - added} missing shots to Board</button>{/if}
		{#if added || project.production.cards.length}<button type="button" onclick={onBoard} disabled={dirty || busy}>Open trailer Board</button>{/if}
		{#if dirty}<button type="button" class="primary" onclick={() => void send('save')} disabled={busy}>Save story plan</button>{/if}
	</div>
	<details class="how">
		<summary>What each step does</summary>
		<ol>
			<li><b>Acts → scenes → story beats → shots.</b> Each act holds scenes; each scene is one board group{#if room} and one Review Room folder{/if}; each story beat sits in one scene.</li>
			<li><b>Add scene</b> names a scene in an act. Give it a three-letter <b>scene code</b>{#if room} (its Review Room folder; its shots are named like {room.show_code}_{room.code}_ABC_0010){/if}, or point it at a <b>board group</b> that already exists so it keeps that group's shots and code.</li>
			<li><b>Approve this story beat</b> marks a proposed story beat as yours. Nothing else changes.</li>
			<li><b>Draft shots for this story beat</b> splits it into planned shots with times. No media is made.</li>
			<li><b>Covered by board shot</b> (on a planned shot) points it at a shot that already exists, so Add to Board makes no duplicate.</li>
			<li><b>Add missing shots to Board</b> puts one benched card per planned shot that isn't covered yet into its scene's group, making the group if needed. Each new shot gets its permanent code then. It never removes or replaces anything.</li>
			<li><b>Continue to Prep</b> only opens the references step (character and location sheets). It creates nothing.</li>
		</ol>
	</details>
	<p class="hint">Existing boards and footage stay intact. Candidate takes are suggestions; they do not change picks. New planned shots are added benched for review.</p>
	{#if dirty}<p class="hint">Save your story-plan edits before continuing. Story text uses Save workspace.</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if note}<p role="status">{note}</p>{/if}
	{#each plan.sections as section, i (section.id)}
		{@const sm = sectionMeasure(section)}
		<section class="act" aria-label={section.title}>
			<div class="act-heading"><span class="time">{stamp(start(i))}–{stamp(start(i) + actSeconds(section))}</span><h3>{section.title}</h3><span>{section.scenes.length} scenes · {sm.shots || section.moments.flatMap(beat => beat.shots).length} shots{#if edit} · {sm.in_edit} in the edit{/if}{#if section.moments.length} · {section.moments.length} story beats{/if}</span></div>
			<p class="summary">{section.summary}</p>
			{#each grouped(section) as entry, g (entry.scene?.id ?? `loose-${g}`)}
				{#if entry.scene}
					{@const scene = entry.scene}
					{@const stored = storedScene(scene)}
					{@const m = sceneMeasure(scene)}
					<div class="scene">
						<div class="scene-heading">
							<span class="code">{sceneCode(scene) ?? '···'}</span>
							<input class="scene-title" value={scene.title} maxlength="200" aria-label="Scene title" oninput={(event) => { scene.title = event.currentTarget.value; dirty = true; }} />
							<span class="scene-meta">{#if m}{m.shots} shots{#if edit} · {m.in_edit} in the edit · {stamp(m.edit_s)}{/if}{/if}{#if entry.beats.length || !m}{m ? ' · ' : ''}{entry.beats.length} story beats{/if}</span>
						</div>
						<div class="scene-fields">
							{#if stored && scene.group_id}<p class="linked">Board group · <b>{groupName(scene.group_id)}</b> · Review Room scene folder <b>{stored.code}</b></p>{:else}<label>Board group<select value={scene.group_id ?? ''} onchange={(event) => mapGroup(scene, event.currentTarget.value)}><option value="">New group on Add to Board</option>{#each boardGroups as group (group.group_id)}<option value={group.group_id}>{group.name}{room?.scenes?.[group.group_id] ? ` · ${room.scenes[group.group_id].code}` : ''}</option>{/each}</select></label>{/if}
							{#if room}{#if stored}{#if !scene.group_id}<p class="hint">Review Room scene folder · <b>{stored.code}</b> (permanent)</p>{/if}{:else}<label class="scene-code">Scene code<input value={scene.scene_code ?? ''} maxlength="3" placeholder="e.g. PCK" oninput={(event) => setCode(scene, event.currentTarget)} /><span>Three capital letters. Add to Board makes this scene's Review Room folder.</span></label>{/if}{/if}
						</div>
						{#each entry.beats as beat, j (beat.id)}{@render beatRow(beat, j, section)}{/each}
					</div>
				{:else}
					{#if section.scenes.length}<p class="hint loose">Not in a scene yet</p>{/if}
					{#each entry.beats as beat, j (beat.id)}{@render beatRow(beat, j, section)}{/each}
				{/if}
			{/each}
			<div class="actions">
				<button type="button" disabled={busy} onclick={() => { section.scenes.push({ id: crypto.randomUUID(), title: 'New scene' }); dirty = true; }}>Add scene</button>
				<button type="button" disabled={busy} onclick={() => { section.moments.push({ id: crypto.randomUUID(), title: 'New story beat', beat: 'Describe what happens and what the audience should suspect.', duration_s: 8, characters: [], location: '', scene_id: section.scenes.at(-1)?.id, approved: false, shots: [] }); dirty = true; }}>Add story beat</button>
			</div>
		</section>
	{/each}
</section>
{/if}

<style>
	.how {margin:8px 0;font-size:12px;color:#9fbcc0;} .how summary::before {content:none;} .how summary {padding:6px 0;color:#7bd7c6;} .how ol {margin:4px 0 8px 18px;line-height:1.8;} .how b {color:#c9e2df;font-weight:600;}
	.scene-code {max-width:520px;} .scene-code input {max-width:90px;text-transform:uppercase;font-family:var(--font-mono,monospace);letter-spacing:.12em;} .scene-code span {display:block;margin-top:4px;font-size:10.5px;color:#6f8f95;}
	.on-board {font-size:11px;color:#7bd7c6;margin-top:4px;}
	.scene {margin:14px 0 6px;padding:10px 12px 6px;background:#0e171c;border:1px solid #1f3138;} .scene-heading {display:flex;align-items:center;gap:12px;} .scene-heading .code {font:12px var(--font-mono,monospace);letter-spacing:.14em;color:#7bd7c6;min-width:34px;} .scene-title {flex:1;margin:0;border:1px solid transparent;background:transparent;font-size:13px;color:#d1e8e6;padding:4px 6px;} .scene-title:hover,.scene-title:focus {border-color:#30434b;background:#0c141a;} .scene-meta {font-size:10px;color:#6f8f95;white-space:nowrap;} .scene-fields {display:flex;flex-wrap:wrap;gap:0 18px;align-items:start;} .scene-fields>label:first-child {flex:1;min-width:240px;} .loose {margin-top:14px;}
	.bible {white-space:pre-wrap;max-height:380px;overflow:auto;font:12px/1.8 var(--font-sans);padding:16px;background:#10191f;} .breakdown {padding:10px 0;border-top:1px solid #294047;font-size:12px;line-height:1.7;} .breakdown p {color:#8ba6ae;}
	.plan { color: #b9d0d2; margin-bottom: 36px; } header { display:flex; justify-content:space-between; gap:24px; align-items:start; } h2 { font-size:24px; color:#d7efed; margin:8px 0; font-weight:600; } .eyebrow,.time,.number,.state,.metrics span { font:10px var(--font-mono,monospace); letter-spacing:.08em; } .eyebrow {color:#66d9ca;} .intro,.hint,.summary {font-size:12px;line-height:1.7;color:#819fa5;} .metrics {display:flex;gap:14px;align-items:center;white-space:nowrap;} .metrics strong {font-size:30px;font-weight:400;color:#b8eee5;} .metrics span {line-height:1.9;} .actions {display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:16px 0 8px;} button {flex:none;width:auto;border:1px solid #355155;padding:4px 10px;line-height:1.4;color:#b3d5d4;font-size:11px;background:#101b20;cursor:pointer;} .actions label {margin:0;} .linked {flex:1;min-width:240px;font-size:11px;color:#91afb3;margin:10px 0;} .linked b {color:#c9e2df;font-weight:600;} .edit-name {color:#8fbbbc;} button.primary {background:#16483f;border-color:#2c7c6c;color:#c5f7e8;} button:disabled {opacity:.45;cursor:default;} .hint {font-size:11px;} .act {border-top:1px solid #294047;margin-top:26px;padding-top:15px;} .act-heading {display:flex;align-items:center;gap:16px;} .act-heading h3 {font-size:16px;color:#c9e2df;flex:1;} .act-heading>span:last-child {font-size:11px;color:#83a6aa;white-space:nowrap;} .time {color:#5cbcaf;min-width:90px;} .summary {margin:8px 0 12px;} .shot {border-top:1px solid #1d2d35;} summary {display:flex;gap:12px;align-items:center;padding:12px 2px;cursor:pointer;font-size:12px;list-style:none;} summary::before {content:'+';color:#629b9e;} details[open]>summary::before {content:'−';} .number {color:#587c86;} .shot-name {flex:1;} .length {color:#8fbbbc;min-width:30px;} .state {color:#8b9c99;width:125px;text-align:right;font-size:9px;} .shot-body {padding:8px 18px 18px;background:#10191f;} label {display:block;font-size:11px;color:#91afb3;margin:10px 0;} input,textarea,select {display:block;width:100%;border:1px solid #30434b;background:#0c141a;padding:8px;color:#bed3d5;font-size:12px;margin-top:5px;} .shot-facts {display:flex;gap:24px;align-items:center;font-size:11px;} .shot-facts label {max-width:180px;} a {font-size:12px;color:#7bd7c6;} .error {color:#f6a6a2;font-size:12px;} :is(button,input,textarea,select,summary,a):focus-visible {outline:2px solid #7bd7c6;outline-offset:3px;} @media(max-width:600px) {header {flex-direction:column;gap:10px;} .act-heading {flex-wrap:wrap;gap:8px;} .time {min-width:auto;} .state {width:85px;font-size:8px;} .shot-facts {flex-direction:column;align-items:start;gap:0;}}
</style>
