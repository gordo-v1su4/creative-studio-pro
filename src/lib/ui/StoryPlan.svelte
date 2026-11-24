<script lang="ts">
	/**
	 * The story plan, one level at a time (decision 3): brief, acts, scenes, story beats, shot list. Each level is
	 * proposed (by the Agent or by hand), read and changed here, then approved; approving it fixes that level's
	 * names (decision 22), and the line under the bar says so before the button is pressed. The row that is
	 * selected is edited in the pane beside the list, so nothing in the list moves.
	 */
	import type { Project } from '$lib/domain/schemas';
	import { boardCardFor, currentEdit, groupMeasures, sceneGroupId, type GroupMeasure, type PlanScene, type StoryPlan } from '$lib/domain/story-plan';
	import { approveLabel, canApprove, levelCounts, levelLabel, levelOpen, levelStates, levelSummary, lockNotice, nextLevel, projectCodes, sceneLabel, shortCodeOf, shotListAsItStands, STORY_LEVELS, type StoryLevel } from '$lib/domain/story-levels';
	import { shortName } from '$lib/domain/shot-card';
	import { suggestCode } from '$lib/domain/shot-codes';
	import { ui } from '$lib/ui/app-state.svelte';
	import BriefSheet from '$lib/ui/story/BriefSheet.svelte';
	import Pitch from '$lib/ui/story/Pitch.svelte';
	import { agentWork } from '$lib/ui/story/agent-work.svelte';
	import { proposeBlocked, runtimeSeconds, type ProposeLevel } from '$lib/domain/story-propose';

	let { project, onUpdated }: { project: Project; onUpdated: (project: Project) => void } = $props();

	type Section = StoryPlan['sections'][number];
	type Beat = Section['moments'][number];
	type Shot = Beat['shots'][number];

	let plan = $state<StoryPlan | null>(null);
	let loadedVersion = $state(-1);
	let dirty = $state(false);
	let briefDirty = $state(false);
	let briefTitle = $state('');
	let busy = $state('');
	/** What the last action here came to. It is said for the project as that action left it; a later change elsewhere clears it. */
	let saidRaw = $state<{ text: string; bad?: boolean; version?: number } | null>(null);
	const said = $derived(saidRaw && (saidRaw.version === undefined || saidRaw.version === project.version) ? saidRaw : null);
	let selected = $state('');
	let targetSeconds = $state(30);
	let sheet = $state<ReturnType<typeof BriefSheet> | null>(null);
	$effect(() => {
		if (project.version !== loadedVersion) {
			loadedVersion = project.version;
			plan = project.production.story_plan ? structuredClone($state.snapshot(project.production.story_plan)) : null;
			dirty = false;
		}
	});

	// Where each level stands. Counts follow what is on screen (the unsaved draft included); names come from the saved project.
	const approvals = $derived(project.production.story_levels?.approved ?? {});
	const counts = $derived({ ...levelCounts(project), brief: project.brief_state.versions.length || briefDirty ? 1 : 0, ...(plan ? { acts: plan.sections.length, scenes: plan.sections.reduce((sum, section) => sum + section.scenes.length, 0), beats: plan.sections.reduce((sum, section) => sum + section.moments.length, 0), shots: project.production.cards.length + plan.sections.flatMap((section) => section.moments).flatMap((beat) => beat.shots).filter((shot) => !boardCardFor(project.production, shot)).length } : {}) });
	const open = $derived(levelOpen(project));
	const states = $derived(levelStates(counts, approvals, open));
	const level = $derived<StoryLevel>(ui.storyLevel ?? nextLevel(states) ?? 'shots');
	const allowed = $derived(canApprove(level, states));
	const codes = $derived(projectCodes(project));

	// The two codes the brief fixes: suggested until then, and the operator may change them.
	let showCode = $state(''), projectCode = $state('');
	/** The project whose codes the operator has typed over: a suggestion never replaces what they typed. */
	let typed = $state({ project: '', show: false, code: false });
	$effect(() => {
		const mine = typed.project === project.project_id;
		// Suggested from the brief's title as it reads on the sheet, so the code shown is the one approving will fix.
		if (!(mine && typed.show)) showCode = codes.show ?? suggestCode(briefTitle.trim() || project.brief_state.versions.at(-1)?.title || project.title);
		if (!(mine && typed.code)) projectCode = codes.project ?? 'TR100';
	});
	const typeCode = (which: 'show' | 'code') => { typed = { project: project.project_id, show: (typed.project === project.project_id && typed.show) || which === 'show', code: (typed.project === project.project_id && typed.code) || which === 'code' }; };
	const codesFixed = $derived(!!approvals.brief || !!project.review_room);

	const room = $derived(project.review_room);
	const beats = $derived(plan?.sections.flatMap((section) => section.moments) ?? []);
	const edit = $derived(currentEdit(project.production));
	const measures = $derived(groupMeasures(project.production));
	const sceneGroup = (scene: PlanScene) => scene.group_id ?? (project.production.groups?.some((group) => group.group_id === sceneGroupId(scene)) ? sceneGroupId(scene) : undefined);
	const sceneMeasure = (scene: PlanScene): GroupMeasure | null => { const id = sceneGroup(scene); return id ? measures.get(id) ?? { shots: 0, in_edit: 0, edit_s: 0 } : null; };
	const beatsOf = (section: Section, scene: PlanScene | null) => section.moments.filter((beat) => (scene ? beat.scene_id === scene.id : !beat.scene_id || !section.scenes.some((entry) => entry.id === beat.scene_id)));
	const seconds = (list: Beat[]) => list.reduce((sum, beat) => sum + beat.duration_s, 0);
	const sceneSeconds = (section: Section, scene: PlanScene) => { const m = sceneMeasure(scene); return edit && m ? m.edit_s : seconds(beatsOf(section, scene)); };
	const sceneShots = (section: Section, scene: PlanScene) => sceneMeasure(scene)?.shots || beatsOf(section, scene).reduce((sum, beat) => sum + beat.shots.length, 0);
	const stamp = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.round(s * 10) / 10}s`);
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	/** A scene's code: Review Room's for its board group when it has one there, else the plan's. */
	const storedScene = (scene: PlanScene) => room?.scenes?.[sceneGroupId(scene)];
	const sceneCode = (scene: PlanScene) => storedScene(scene)?.code ?? scene.scene_code;
	/** A scene code can still be typed until the scenes are approved or Review Room holds it. */
	const sceneCodeFixed = (scene: PlanScene) => !!storedScene(scene) || (!!approvals.scenes && !!project.production.story_plan?.sections.some((section) => section.scenes.some((entry) => entry.id === scene.id && entry.scene_code)));
	const groupName = (groupId?: string) => { const group = project.production.groups?.find((entry) => entry.group_id === groupId); return group ? sceneLabel(project, group) : 'Main'; };
	/** The shot list as it stands (saved project): the board's shots under scenes the plan has no shots for. */
	const shotList = $derived(shotListAsItStands(project));
	const boardRowsOf = (scene: PlanScene) => shotList.acts.flatMap((act) => act.scenes).find((entry) => entry.id === scene.id && entry.from === 'board')?.shots ?? [];
	const boardShots = $derived(project.production.cards.toSorted((a, b) => groupName(a.group_id).localeCompare(groupName(b.group_id)) || a.order - b.order));
	const cardOf = (shot: Shot) => boardCardFor(project.production, shot);
	const shotCode = (shot: Shot) => { const card = cardOf(shot); return card ? shortCodeOf(project, card) : null; };
	const totalSeconds = $derived(edit ? [...measures.values()].reduce((sum, m) => sum + m.edit_s, 0) : seconds(beats));

	// The selected row, found again in the draft so the pane edits the draft itself.
	const picked = $derived.by(() => {
		if (!plan || !selected) return null;
		for (const section of plan.sections) {
			if (section.id === selected) return { kind: 'act' as const, section };
			for (const scene of section.scenes) if (scene.id === selected) return { kind: 'scene' as const, section, scene };
			for (const beat of section.moments) {
				if (beat.id === selected) return { kind: 'beat' as const, section, beat };
				for (const shot of beat.shots) if (shot.id === selected) return { kind: 'shot' as const, section, beat, shot };
			}
		}
		return null;
	});
	const paneFor: Record<StoryLevel, string[]> = { brief: [], acts: ['act'], scenes: ['scene'], beats: ['beat'], shots: ['beat', 'shot'] };
	const pane = $derived(picked && paneFor[level].includes(picked.kind) ? picked : null);

	const touch = () => { dirty = true; saidRaw = null; };
	/** A story beat that changes goes back to proposed, and its planned shots are cleared: they covered the old beat. */
	const touchBeat = (beat: Beat) => { beat.approved = false; beat.shots = []; touch(); };
	const id = () => crypto.randomUUID();

	function addAct() { if (!plan) return; const section: Section = { id: id(), title: `Act ${plan.sections.length + 1}`, summary: '', scenes: [], moments: [] }; plan.sections.push(section); selected = section.id; touch(); }
	function addScene() {
		if (!plan) return;
		const section = picked?.section ?? plan.sections[0];
		const scene: PlanScene = { id: id(), title: 'New scene' };
		section.scenes.push(scene); selected = scene.id; touch();
	}
	function addBeat() {
		if (!plan) return;
		const section = picked?.section ?? plan.sections[0];
		const scene = picked?.kind === 'scene' ? picked.scene : picked?.kind === 'beat' ? section.scenes.find((entry) => entry.id === picked.beat.scene_id) : section.scenes.at(-1);
		const beat: Beat = { id: id(), title: 'New story beat', beat: 'What happens, and what the audience should think.', duration_s: 6, characters: [], location: '', scene_id: scene?.id, approved: false, shots: [] };
		section.moments.push(beat); selected = beat.id; touch();
	}
	function addShot(beat: Beat) { const shot: Shot = { id: id(), title: 'New shot', beat: 'What we see.', duration_s: 3 }; beat.shots.push(shot); selected = shot.id; touch(); }
	function remove() {
		if (!plan || !picked) return;
		if (picked.kind === 'act') plan.sections = plan.sections.filter((section) => section.id !== picked.section.id);
		else if (picked.kind === 'scene') picked.section.scenes = picked.section.scenes.filter((scene) => scene.id !== picked.scene.id);
		else if (picked.kind === 'beat') picked.section.moments = picked.section.moments.filter((beat) => beat.id !== picked.beat.id);
		else picked.beat.shots = picked.beat.shots.filter((shot) => shot.id !== picked.shot.id);
		selected = ''; touch();
	}
	function setCode(scene: PlanScene, input: HTMLInputElement) {
		const code = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
		input.value = code; scene.scene_code = code.length === 3 ? code : undefined; touch();
	}
	function mapGroup(scene: PlanScene, groupId: string) {
		scene.group_id = groupId || undefined;
		const stored = scene.group_id ? room?.scenes?.[scene.group_id] : undefined;
		if (stored) scene.scene_code = stored.code;
		touch();
	}

	$effect(() => { ui.storyDirty = dirty || briefDirty; return () => { ui.storyDirty = false; }; });
	// The Agent proposes a level: its action, the same one its dock offers. What is on screen is saved first.
	const proposable = $derived(level === 'brief' ? null : (level as ProposeLevel));
	const proposeWhy = $derived(plan && proposable ? (proposable === 'shots' && !beats.some((beat) => beat.approved && !beat.shots.length) && beats.some((beat) => !beat.shots.length) ? 'Approve the story beats first' : proposeBlocked(plan, proposable)) : null);
	const proposeWords: Record<ProposeLevel, string> = { acts: 'Propose acts', scenes: 'Propose scenes', beats: 'Propose story beats', shots: 'Propose shots' };
	async function propose() {
		if (!proposable || proposeWhy || busy || agentWork.busy) return;
		if (dirty && !(await save())) return;
		saidRaw = null;
		if (!(await agentWork.propose(project, proposable, proposable === 'beats' ? targetSeconds : undefined))) saidRaw = { text: agentWork.linesFor(project.project_id).at(-1)?.text ?? 'The Agent could not propose that', bad: true };
	}
	// A project just started with nothing: the Agent pitches three loglines at once, unasked (story 6).
	$effect(() => {
		const ask = ui.agentAsk;
		if (ask?.projectId !== project.project_id || ask.action !== 'pitch') return;
		ui.agentAsk = null;
		if (!project.trailer_house?.rounds.length) void agentWork.pitch(project);
	});
	// The length story beats are proposed to: the brief's, until the operator types another.
	$effect(() => { project.project_id; targetSeconds = runtimeSeconds(project.brief_state.versions.at(-1)?.format.runtime); });

	type Action = 'save' | 'approve_level' | 'breakdown' | 'refresh_source';
	/** One request to the plan; resolves to the project it left, or null when it failed (the line says why). */
	async function send(action: Action, body: Record<string, unknown> = {}, version = project.version): Promise<Project | null> {
		busy = action; saidRaw = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, expected_version: version, ...body }) });
			const result = await response.json();
			if (!result.ok) throw new Error(result.error?.message ?? 'The story plan could not be saved');
			onUpdated(result.data);
			return result.data as Project;
		} catch (cause) { saidRaw = { text: cause instanceof Error ? cause.message : 'The story plan could not be saved', bad: true }; return null; }
		finally { busy = ''; }
	}
	async function save(): Promise<Project | null> {
		const saved = await send('save', { plan });
		if (saved) saidRaw = { text: 'Saved', version: saved.version };
		return saved;
	}
	/** Approve the open level. Anything not saved yet is saved first, so what is approved is what is on screen. */
	async function approve() {
		if (!allowed.ok || busy) return;
		const approving = level;
		let version = project.version;
		if (approving === 'brief' && (briefDirty || !project.brief_state.versions.length)) { const saved = await sheet?.save(); if (!saved) return; version = saved.version; }
		if (dirty) { const saved = await send('save', { plan }, version); if (!saved) return; version = saved.version; }
		// Keep the level on screen while it is approved; then move on to the next one that waits.
		ui.storyLevel = approving;
		const done = await send('approve_level', { level: approving, ...(approving === 'brief' && !codesFixed ? { show_code: showCode, project_code: projectCode } : {}) }, version);
		if (!done) return;
		const next = nextLevel(levelStates(levelCounts(done), done.production.story_levels?.approved ?? {}, levelOpen(done)));
		ui.storyLevel = next ? null : approving;
		saidRaw = { text: next ? `${levelLabel(approving)} approved. ${levelLabel(next)} next.` : `${levelLabel(approving)} approved. The whole story plan is approved.`, version: done.version };
	}
	async function draftShots(beat: Beat) {
		if (dirty && !(await save())) return;
		if (await send('breakdown', { moment_id: beat.id }, project.version)) saidRaw = { text: 'Shots drafted for you to read. Nothing was made.' };
	}
</script>

{#if plan}
<section class="plan" aria-label="Story plan">
	<div class="bar">
		<nav class="levels" aria-label="Story plan levels">
			{#each STORY_LEVELS as entry, i (entry)}
				<button type="button" class="tg" aria-pressed={entry === level} data-state={states[entry]} onclick={() => { ui.storyLevel = entry; selected = ''; saidRaw = null; }} title="{levelLabel(entry)}{levelSummary(entry, states[entry], counts[entry], open[entry], !!approvals[entry]) ? ` · ${levelSummary(entry, states[entry], counts[entry], open[entry], !!approvals[entry])}` : ''}"><span class="n">{String(i + 1).padStart(2, '0')}</span>{levelLabel(entry)}</button>
			{/each}
		</nav>
		<span class="meta">{levelSummary(level, states[level], counts[level], open[level], !!approvals[level]) || 'Nothing yet'}{#if level !== 'brief' && totalSeconds > 0}{` · ${stamp(totalSeconds)}`}{/if}</span>
		<span class="actions">
			{#if level === 'acts'}<button type="button" class="key" disabled={!!busy} onclick={addAct}>Add act</button>{/if}
			{#if level === 'scenes'}<button type="button" class="key" disabled={!!busy} onclick={addScene}>Add scene</button>{/if}
			{#if level === 'beats'}<button type="button" class="key" disabled={!!busy} onclick={addBeat}>Add story beat</button>{/if}
			{#if level === 'beats' && !proposeWhy}<label class="cp len" title="The length the proposed story beats add up to, with what is already planned">Length<input class="code-in wide" type="number" min="4" max="600" step="1" bind:value={targetSeconds} />s</label>{/if}
			{#if proposable && states[level] !== 'approved'}<button type="button" class="key agent" disabled={!!busy || agentWork.busy !== null || !!proposeWhy} onclick={() => void propose()} title={proposeWhy ?? 'The Agent proposes this level from the brief and the levels above it. It fills what is empty and changes nothing that is there.'}>{agentWork.busy === `propose:${proposable}` ? 'Proposing…' : proposeWords[proposable]}</button>{/if}
			{#if dirty}<button type="button" class="key" disabled={!!busy} onclick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save'}</button>{/if}
			{#if states[level] === 'approved'}
				<span class="cp done">Approved</span>
			{:else}
				<button type="button" class="key go" disabled={!allowed.ok || !!busy} onclick={() => void approve()} title={allowed.ok ? lockNotice(level) : allowed.why}>{busy === 'approve_level' ? 'Approving…' : approveLabel(level, counts[level], open[level], !!approvals[level])}</button>
			{/if}
		</span>
	</div>
	<p class={['lockn', said?.bad && 'bad']} aria-live="polite">
		{#if said}{said.text}
		{:else if states[level] === 'approved'}<b>Approved</b> · {level === 'brief' ? 'the show code and the project code are fixed' : level === 'scenes' ? 'each scene code is fixed' : level === 'shots' ? 'each shot code is fixed' : 'nothing more to do here'}{#if level === 'brief' || level === 'scenes' || level === 'shots'}; titles can still change{/if}
		{:else if !allowed.ok}{allowed.why}
		{:else}<b>Names lock on approve</b> · {lockNotice(level)}{/if}
	</p>

	<div class={['body', level === 'brief' && 'one']}>
		<div class="list">
			{#if level === 'brief'}
				<div class="codes">
					<label class="cp" for="show-code">Show code</label>
					{#if codesFixed}<span class="kept">{codes.show ?? showCode}</span>{:else}<input id="show-code" class="code-in" value={showCode} maxlength="3" oninput={(event) => { showCode = event.currentTarget.value = event.currentTarget.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3); typeCode('show'); }} />{/if}
					<label class="cp" for="project-code">Project code</label>
					{#if codesFixed}<span class="kept">{codes.project ?? projectCode}</span>{:else}<input id="project-code" class="code-in wide" value={projectCode} maxlength="5" oninput={(event) => { projectCode = event.currentTarget.value = event.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); typeCode('code'); }} />{/if}
					<span class="cp eg">{codesFixed ? (room && !approvals.brief ? 'From Review Room' : 'Fixed') : 'Fixed when you approve'} · shots read {codes.show ?? (showCode || 'AAA')}_{codes.project ?? (projectCode || 'TR100')}_VHS_0010</span>
				</div>
				<!-- The pitch shows once the Agent has pitched, and as an invitation while there is no idea to draft a brief from. -->
				{#if project.trailer_house?.rounds.length || (!project.brief_state.versions.length && !briefDirty && (!project.seed.brief.trim() || plan.source?.title === 'Direction for the pitch'))}<Pitch {project} {onUpdated} />{/if}
				<BriefSheet bind:this={sheet} {project} {onUpdated} bind:dirty={briefDirty} bind:titleNow={briefTitle} />
				{#if plan.source}
					<details class="source">
						<summary class="cp">Source · {plan.source.title}</summary>
						<p class="hint">Read {new Date(plan.source.imported_at).toLocaleDateString()}. The plan follows this source; nothing proposed here changes it.{#if plan.source.url}{' '}<a href={plan.source.url} target="_blank" rel="noreferrer">Open in Notion</a>{/if}</p>
						{#if plan.source.series_id}<button type="button" class="key" disabled={!!busy || dirty} onclick={() => void send('refresh_source').then((done) => { if (done) saidRaw = { text: 'Source read again from Notion' }; })} title={dirty ? 'Save your changes first' : 'Read the current story from Notion again'}>{busy === 'refresh_source' ? 'Reading…' : 'Read again from Notion'}</button>{/if}
						<pre>{plan.source.text}</pre>
					</details>
				{/if}
			{:else if level === 'acts'}
				{#each plan.sections as section, i (section.id)}
					<button type="button" class="sc" data-sel={selected === section.id ? '' : undefined} onclick={() => (selected = section.id)}>
						<span class="code">{String(i + 1).padStart(2, '0')}</span><span class="n">{section.title}</span><span class="d">{section.summary}</span><span class="x">{stamp(seconds(section.moments))} · {plural(section.scenes.length, 'scene')}</span>
					</button>
				{/each}
			{:else}
				{#each plan.sections as section (section.id)}
					<section>
						<div class="ah cp"><span>{section.title}</span><span class="t">{stamp(seconds(section.moments))}</span></div>
						{#if level === 'scenes'}
							{#each section.scenes as scene (scene.id)}
								<button type="button" class="sc" data-sel={selected === scene.id ? '' : undefined} onclick={() => (selected = scene.id)}>
									<span class="code" data-none={sceneCode(scene) ? undefined : ''}>{sceneCode(scene) ?? '···'}</span><span class="n">{scene.title}</span><span class="d">{beatsOf(section, scene).map((beat) => beat.title).join(' · ')}</span><span class="x">{stamp(sceneSeconds(section, scene))} · {plural(sceneShots(section, scene), 'shot')}</span>
								</button>
							{:else}
								<p class="none">No scenes in this act yet</p>
							{/each}
						{:else}
							{#each [...section.scenes, null] as scene (scene?.id ?? 'loose')}
								{@const own = beatsOf(section, scene)}
								{@const board = level === 'shots' && scene ? boardRowsOf(scene) : []}
								{#if scene || own.length}
									<div class="sh cp"><span class="code" data-none={scene && sceneCode(scene) ? undefined : ''}>{scene ? sceneCode(scene) ?? '···' : '···'}</span><span>{scene ? scene.title : 'Not in a scene yet'}</span></div>
									{#each own as beat, j (beat.id)}
										<button type="button" class="sc" data-sel={selected === beat.id ? '' : undefined} data-sub={level === 'shots' ? '' : undefined} onclick={() => (selected = beat.id)}>
											<span class="code num">{String(j + 1).padStart(2, '0')}</span><span class="n">{beat.title}</span><span class="d">{beat.beat}</span><span class="x">{stamp(beat.duration_s)}{#if level === 'beats'}{' · '}<i data-ok={beat.approved ? '' : undefined}>{beat.approved ? 'Approved' : 'Proposed'}</i>{:else}{` · ${plural(beat.shots.length, 'shot')}`}{/if}</span>
										</button>
										{#if level === 'shots'}
											{#each beat.shots as shot (shot.id)}
												{@const code = shotCode(shot)}
												<button type="button" class="sc shot" data-sel={selected === shot.id ? '' : undefined} onclick={() => (selected = shot.id)}>
													<span class="code" data-none={code ? undefined : ''}>{code ?? '····'}</span><span class="n">{shot.title}</span><span class="d">{shot.beat}</span><span class="x">{stamp(shot.duration_s)} · <i data-ok={cardOf(shot) ? '' : undefined}>{cardOf(shot) ? 'On the list' : 'Proposed'}</i></span>
												</button>
											{/each}
										{/if}
									{/each}
									<!-- A scene the plan has no shots for lists the shots on its board group, as they are: read here, changed on the Shots stage. -->
									{#each board as shot (shot.id)}
										<div class="sc shot ro" title={`${shot.code ?? 'No code yet'} · ${shot.title}. On the board; change it on the Shots stage.`}>
											<span class="code" data-none={shot.code ? undefined : ''}>{shot.code ? shortName(shot.code) : '····'}</span><span class="n">{shot.title}</span><span class="d"></span><span class="x">{stamp(shot.duration_s)} · <i data-ok>On the board</i></span>
										</div>
									{/each}
								{/if}
							{/each}
							{#if !section.moments.length && !(level === 'shots' && section.scenes.some((scene) => boardRowsOf(scene).length))}<p class="none">No story beats in this act yet</p>{/if}
						{/if}
					</section>
				{/each}
				{#if level === 'shots' && shotList.unplaced.length}
					<section>
						<div class="ah cp"><span>Not in a scene</span></div>
						{#each shotList.unplaced as shot (shot.id)}
							<div class="sc shot ro" title={`${shot.code ?? 'No code yet'} · ${shot.title}. On the board, in no scene of the plan.`}>
								<span class="code" data-none={shot.code ? undefined : ''}>{shot.code ? shortName(shot.code) : '····'}</span><span class="n">{shot.title}</span><span class="d"></span><span class="x">{stamp(shot.duration_s)} · <i data-ok>On the board</i></span>
							</div>
						{/each}
					</section>
				{/if}
			{/if}
		</div>

		{#if level !== 'brief'}
			<aside class="edit" aria-label="Selected row">
				{#if !pane}
					<p class="none">Select a row to change it</p>
				{:else if pane.kind === 'act'}
					<p class="cp head">Act</p>
					<label class="f"><span class="cp">Title</span><input bind:value={pane.section.title} oninput={touch} maxlength="200" /></label>
					<label class="f"><span class="cp">What it does</span><textarea bind:value={pane.section.summary} oninput={touch} rows="5" maxlength="2000"></textarea></label>
					{#if plan.sections.length > 1 && !pane.section.scenes.length && !pane.section.moments.length}<button type="button" class="key" onclick={remove}>Remove act</button>{/if}
				{:else if pane.kind === 'scene'}
					{@const scene = pane.scene}
					<p class="cp head">Scene</p>
					<label class="f"><span class="cp">Title</span><input bind:value={scene.title} oninput={touch} maxlength="200" /></label>
					<div class="f">
						<span class="cp">Scene code</span>
						{#if sceneCodeFixed(scene)}<span class="kept" title="Fixed: this code names the scene everywhere, and in Review Room">{sceneCode(scene)}</span>
						{:else}<input class="code-in" value={scene.scene_code ?? ''} maxlength="3" placeholder={suggestCode(scene.title, plan.sections.flatMap((section) => section.scenes).flatMap((entry) => (entry.scene_code && entry.id !== scene.id ? [entry.scene_code] : [])))} oninput={(event) => setCode(scene, event.currentTarget)} />{/if}
					</div>
					<p class="hint">{sceneCodeFixed(scene) ? 'The code is fixed. The title can still change.' : 'Leave it empty and approving the scenes gives it the code shown.'}</p>
					{#if !storedScene(scene) && (scene.group_id || !sceneGroup(scene)) && (project.production.groups?.length ?? 0) > 0}
						<label class="f"><span class="cp">Shots already on the board</span><select value={scene.group_id ?? ''} onchange={(event) => mapGroup(scene, event.currentTarget.value)}><option value="">None: a new group for this scene</option>{#each project.production.groups ?? [] as group (group.group_id)}<option value={group.group_id}>{sceneLabel(project, group)}{room?.scenes?.[group.group_id] && !sceneLabel(project, group).startsWith(`${room.scenes[group.group_id].code} · `) ? ` · ${room.scenes[group.group_id].code}` : ''}</option>{/each}</select></label>
					{/if}
					{#if !beatsOf(pane.section, scene).length && !sceneCodeFixed(scene)}<button type="button" class="key" onclick={remove}>Remove scene</button>{/if}
				{:else if pane.kind === 'beat' && level === 'beats'}
					{@const beat = pane.beat}
					<p class="cp head">Story beat</p>
					<label class="f"><span class="cp">Title</span><input bind:value={beat.title} oninput={() => touchBeat(beat)} maxlength="180" /></label>
					<label class="f"><span class="cp">What happens</span><textarea bind:value={beat.beat} oninput={() => touchBeat(beat)} rows="5" maxlength="4000"></textarea></label>
					<div class="two">
						<label class="f"><span class="cp">Seconds</span><input type="number" min="0.5" max="120" step="0.5" bind:value={beat.duration_s} oninput={() => touchBeat(beat)} /></label>
						{#if pane.section.scenes.length}<label class="f"><span class="cp">Scene</span><select value={beat.scene_id ?? ''} onchange={(event) => { beat.scene_id = event.currentTarget.value || undefined; touch(); }}><option value="">Not in a scene yet</option>{#each pane.section.scenes as scene (scene.id)}<option value={scene.id}>{sceneCode(scene) ? `${sceneCode(scene)} · ` : ''}{scene.title}</option>{/each}</select></label>{/if}
					</div>
					<label class="f"><span class="cp">Who is in it</span><input value={beat.characters.join(', ')} oninput={(event) => { beat.characters = event.currentTarget.value.split(',').map((name) => name.trim()).filter(Boolean); touchBeat(beat); }} placeholder="Names, comma separated" /></label>
					<label class="f"><span class="cp">Where</span><input bind:value={beat.location} oninput={() => touchBeat(beat)} maxlength="200" /></label>
					{#if project.production.assets.some((asset) => asset.kind === 'video')}
						<label class="f"><span class="cp">Footage to try</span><select value={beat.candidate_asset_id ?? ''} onchange={(event) => { beat.candidate_asset_id = event.currentTarget.value || undefined; touch(); }}><option value="">None yet</option>{#each project.production.assets.filter((asset) => asset.kind === 'video') as asset (asset.asset_id)}<option value={asset.asset_id}>{asset.name}</option>{/each}</select></label>
					{/if}
					<p class="hint">Changing a story beat sends it back to proposed and clears its planned shots.</p>
					<button type="button" class="key" onclick={remove}>Remove story beat</button>
				{:else if pane.kind === 'beat'}
					{@const beat = pane.beat}
					<p class="cp head">Story beat</p>
					<p class="read">{beat.title}</p>
					<p class="hint">{beat.beat}</p>
					<div class="row">
						<button type="button" class="key" disabled={!!busy} onclick={() => addShot(beat)}>Add shot</button>
						{#if !beat.shots.length}<button type="button" class="key agent" disabled={!!busy || !beat.approved} onclick={() => void draftShots(beat)} title={beat.approved ? 'The Agent splits this story beat into shots with their lengths. Nothing is made.' : 'Approve the story beats first'}>{busy === 'breakdown' ? 'Drafting…' : 'Draft shots'}</button>{/if}
					</div>
				{:else if pane.kind === 'shot'}
					{@const shot = pane.shot}
					{@const card = cardOf(shot)}
					<p class="cp head">Shot{#if shotCode(shot)}<span class="kept">{shotCode(shot)}</span>{/if}</p>
					<label class="f"><span class="cp">Title</span><input bind:value={shot.title} oninput={touch} maxlength="180" /></label>
					<label class="f"><span class="cp">What we see</span><textarea bind:value={shot.beat} oninput={touch} rows="5" maxlength="4000"></textarea></label>
					<label class="f"><span class="cp">Seconds</span><input type="number" min="0.5" max="120" step="0.5" bind:value={shot.duration_s} oninput={touch} /></label>
					{#if boardShots.length}
						<label class="f"><span class="cp">Already on the board as</span><select value={shot.card_id ?? ''} onchange={(event) => { shot.card_id = event.currentTarget.value || undefined; touch(); }}><option value="">A new shot</option>{#each boardShots as entry (entry.card_id)}<option value={entry.card_id}>{shortCodeOf(project, entry) ? `${shortCodeOf(project, entry)} · ` : ''}{entry.title} · {groupName(entry.group_id)}</option>{/each}</select></label>
					{/if}
					<p class="hint">{card ? 'On the shot list. Its code is fixed; change its text on the Shots stage.' : 'Approving the shot list puts it on the board, benched, with its shot code.'}</p>
					{#if !card}<button type="button" class="key" onclick={remove}>Remove shot</button>{/if}
				{/if}
			</aside>
		{/if}
	</div>
</section>
{/if}

<style>
	.plan { display: flex; min-height: 100%; flex-direction: column; color: var(--color-ink-2); font: 12.5px/1.35 var(--font-sans); }
	.bar { position: sticky; top: 0; z-index: 2; display: flex; min-height: 36px; flex-wrap: wrap; align-items: center; gap: 2px 10px; background: var(--color-panel); padding: 4px 10px; }
	.levels { display: flex; min-width: 0; flex-wrap: wrap; gap: 1px; }
	.levels .n { margin-right: 5px; color: #52525b; }
	.levels [data-state='approved'] .n, .levels [aria-pressed='true'] .n { color: var(--color-teal); }
	.levels [data-state='approved'] { color: var(--color-ink-2); }
	.meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-ink-3); font: 10.5px var(--font-mono); letter-spacing: 0.01em; }
	.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-left: auto; }
	.done { color: var(--color-teal); padding: 0 4px; }
	.lockn { min-height: 18px; margin: 0 14px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-ink-3); font: 9.5px/18px var(--font-mono); letter-spacing: 0.11em; text-transform: uppercase; }
	.lockn b { color: var(--color-teal); font-weight: 400; }
	.lockn.bad { color: #ff7a6b; }

	.body { display: grid; min-height: 0; flex: 1; grid-template-columns: minmax(0, 1fr) 280px; gap: 3px; padding: 0 8px 12px; }
	.body.one { grid-template-columns: minmax(0, 1fr); }
	.list { display: flex; min-width: 0; flex-direction: column; gap: 6px; }
	.body.one .list { gap: 12px; padding: 0 6px; }
	section > .ah { display: flex; align-items: baseline; gap: 12px; padding: 8px 6px 4px; color: var(--color-teal); }
	.ah .t { margin-left: auto; color: var(--color-ink-3); font: 10.5px var(--font-mono); letter-spacing: 0.01em; text-transform: none; }
	.sh { display: flex; align-items: baseline; gap: 14px; overflow: hidden; padding: 6px 6px 2px; color: var(--color-ink-3); }
	.sc { display: flex; width: 100%; height: 30px; align-items: center; gap: 14px; overflow: hidden; border: 0; border-radius: 5px; background: none; padding: 0 6px; color: inherit; font: inherit; text-align: left; white-space: nowrap; cursor: pointer; }
	.sc:hover { background: #101012; }
	.sc[data-sel] { background: var(--color-selected); }
	.sc:focus-visible { outline: 2px solid var(--color-teal); outline-offset: -2px; }
	.sc.shot { height: 26px; padding-left: 20px; }
	.sc.ro { cursor: default; }
	.sc.ro:hover { background: none; }
	.sc[data-sub] .n { color: var(--color-ink-2); }
	.code { width: 62px; flex: none; color: var(--color-teal); font: 10.5px var(--font-mono); letter-spacing: 0.01em; text-transform: none; }
	.code[data-none] { color: #52525b; }
	.code.num { color: var(--color-ink-3); }
	.sc.shot .code { width: 74px; }
	.sc .n { flex: none; max-width: 46%; overflow: hidden; text-overflow: ellipsis; color: var(--color-ink); }
	.sc[data-sel] .n { color: var(--color-teal-ink); }
	.sc .d { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; color: var(--color-ink-3); }
	.sc .x { flex: none; color: var(--color-ink-3); font: 10.5px var(--font-mono); letter-spacing: 0.01em; }
	.sc .x i { font-style: normal; }
	.sc .x i[data-ok] { color: var(--color-teal); }
	.none { margin: 0; padding: 4px 6px; color: var(--color-ink-3); font-size: 12px; }

	.edit { position: sticky; top: 44px; display: flex; max-height: calc(100vh - 150px); min-width: 0; flex-direction: column; gap: 8px; align-self: start; overflow-y: auto; border-radius: 8px; background: #101012; padding: 10px; }
	.head { display: flex; align-items: baseline; gap: 10px; margin: 0; color: var(--color-ink-3); }
	.f { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
	.f > .cp { color: var(--color-ink-3); }
	.f input, .f textarea, .f select { width: 100%; box-sizing: border-box; border: 0; border-radius: 5px; background: var(--color-raised); padding: 5px 8px; color: var(--color-ink); font: 12.5px/1.45 var(--font-sans); outline: none; resize: vertical; }
	.f input, .f select { height: 26px; padding-block: 0; }
	.f input:focus, .f textarea:focus, .f select:focus { background: var(--color-control); }
	.two { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 8px; }
	.row { display: flex; flex-wrap: wrap; gap: 4px; }
	.edit > .key { align-self: flex-start; }
	.read { margin: 0; color: var(--color-ink); }
	.hint { margin: 0; color: var(--color-ink-3); font-size: 11.5px; line-height: 1.45; }
	.hint a { color: var(--color-teal); }
	/* Not "fixed": that name is a Tailwind utility (position). */
	.kept { color: var(--color-teal); font: 10.5px var(--font-mono); letter-spacing: 0.01em; text-transform: none; }
	.code-in { width: 52px; height: 22px; box-sizing: border-box; flex: none; border: 0; border-radius: 5px; background: var(--color-raised); padding: 0 6px; color: var(--color-teal); font: 10.5px var(--font-mono); letter-spacing: 0.06em; outline: none; text-transform: uppercase; }
	.code-in.wide { width: 64px; }
	.code-in:focus { background: var(--color-control); }
	.code-in::placeholder { color: #52525b; }
	.codes { display: flex; max-width: 760px; flex-wrap: wrap; align-items: center; gap: 6px 8px; color: var(--color-ink-3); }
	.codes .eg { min-width: 0; flex: 1 1 200px; overflow: hidden; text-overflow: ellipsis; text-transform: none; letter-spacing: 0.02em; }
	.codes .kept { margin-right: 8px; }
	.len { display: inline-flex; align-items: center; gap: 5px; color: var(--color-ink-3); }
	.key.agent { background: var(--color-agent-purple-deep); color: #ddd6fe; }
	.source { max-width: 760px; }
	.source summary { cursor: pointer; color: var(--color-ink-3); }
	.source pre { max-height: 360px; margin: 6px 0 0; overflow: auto; border-radius: 8px; background: #101012; padding: 12px; color: var(--color-ink-2); font: 12px/1.6 var(--font-sans); white-space: pre-wrap; }
	.source .key { margin-top: 6px; }

	@media (max-width: 900px) {
		.body { grid-template-columns: minmax(0, 1fr); }
		.edit { position: static; max-height: none; }
		.sc .d { display: none; }
		.sc .n { max-width: none; flex: 1; }
	}
	@media (pointer: coarse) { .sc { height: 36px; } .f input, .f select { height: 36px; } }
</style>
