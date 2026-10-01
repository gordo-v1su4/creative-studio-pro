<script lang="ts">
	import { onMount } from 'svelte';
	import {
		SvelteFlow,
		Background,
		BackgroundVariant,
		Controls,
		type Node,
		type Edge,
		type Viewport
	} from '@xyflow/svelte';
	import SeedNode from '$lib/ui/nodes/SeedNode.svelte';
	import VoiceNode from '$lib/ui/nodes/VoiceNode.svelte';
	import StoryCardNode from '$lib/ui/nodes/StoryCardNode.svelte';
	import SequencePlayer from '$lib/ui/SequencePlayer.svelte';
	import { reviewSequence } from '$lib/ui/review-sequence.svelte';
	import StageGatePanel from '$lib/ui/StageGatePanel.svelte';
	import ProductionWorkspace from '$lib/ui/ProductionWorkspace.svelte';
	import type { ProductionTab } from '$lib/ui/ProductionWorkspace.svelte';
	import { ui } from '$lib/ui/app-state.svelte';
	import { stageName, isCurrentBriefLocked } from '$lib/domain/gates';
	import { voiceStatusColor, voiceSurfaceStatus } from '$lib/ui/voice-display';
	import type { Project, ProjectSummary, CanvasLayout } from '$lib/domain/schemas';

	const nodeTypes = { seed: SeedNode, voice: VoiceNode, story_card: StoryCardNode };

	let projects = $state<ProjectSummary[]>([]);
	let activeProject = $state<Project | null>(null);
	let layout = $state<CanvasLayout | null>(null);

	// View projections (AD-12): server state is canonical; these runes hold
	// optimistic command state replaced by server results.
	let nodes = $state<Node[]>([]);
	let edges = $state<Edge[]>([]);
	let viewport = $state<Viewport>({ x: 0, y: 0, zoom: 1 });
	let selectedNodeId = $state<string | null>(null);
	let savingLayout = $state(false);
	let loadError = $state<string | null>(null);
	let creating = $state(false);
	let inspectorOpen = $state(true);
	let canvasOpen = $state(true);
	let productionTab = $state<ProductionTab>('story');

	// Seed editing (update_seed command; user-authored fields only).
	let editTitle = $state('');
	let editBrief = $state('');
	let savingSeed = $state(false);
	let seedError = $state<string | null>(null);
	let catalogBusy = $state(false);
	let roomBusy = $state(false);
	let roomError = $state<string | null>(null);
	let seedDirty = $derived(
		activeProject !== null &&
			(editTitle !== activeProject.seed.title || editBrief !== activeProject.seed.brief)
	);
	let selectedVoice = $derived(
		activeProject?.voices.find((voice) => voice.voice_id === selectedNodeId) ?? null
	);
	let briefLocked = $derived(activeProject ? isCurrentBriefLocked(activeProject) : false);
	const workspaceTabs: Array<{ label: string; tab: 'canvas' | ProductionTab }> = [
		{ label: 'Board', tab: 'canvas' }, { label: 'Story', tab: 'story' }, { label: 'Cards', tab: 'cards' },
		{ label: 'Media', tab: 'media' }, { label: 'Preview', tab: 'preview' }, { label: 'Export', tab: 'export' }
	];

	function openWorkspace(tab: 'canvas' | ProductionTab) {
		canvasOpen = tab === 'canvas';
		if (tab !== 'canvas') productionTab = tab;
		localStorage.setItem('csp.workspace-tab', tab);
	}

	function projectToNodes(project: Project, saved: CanvasLayout | null): Node[] {
		const seedSaved = saved?.nodes.find((n) => n.node_id === project.seed.seed_id);
		const seedNode: Node = {
			id: project.seed.seed_id,
			type: 'seed',
			position: { x: seedSaved?.x ?? 0, y: seedSaved?.y ?? 0 },
			data: {
				...project.seed,
				projectVersion: project.version,
				stageId: project.stage.id,
				catalog: project.catalog_snapshot,
				room: project.creative_room,
				catalogBusy,
				roomBusy,
				actionError: roomError,
				onHarvest: () => void harvestCatalog(),
				onReshuffle: () => void reshuffleRoster(),
				onRun: () => void startCreativeRoom()
			},
			ariaLabel: `Seed node, ${project.seed.title || 'Untitled'}, stage ${project.stage.id} ${stageName(project.stage.id)}, ${project.stage.state.toLowerCase()}`
		};
		const voiceNodes: Node[] = project.voices.map((voice, index) => {
			const savedNode = saved?.nodes.find((n) => n.node_id === voice.voice_id);
			return {
				id: voice.voice_id,
				type: 'voice',
				position: { x: savedNode?.x ?? 380, y: savedNode?.y ?? index * 200 },
				data: { ...voice },
				ariaLabel: `Model Voice, ${voice.label}, ${voiceSurfaceStatus(voice).toLowerCase()}`
			};
		});
		const cardRecords = project.production.cards.length > 0
			? project.production.cards.map((card) => ({ id: card.card_id, card }))
			: Array.from({ length: 6 }, (_, order) => ({ id: `story-placeholder-${order}`, card: null }));
		const storyNodes: Node[] = cardRecords.map(({ id, card }, index) => {
			const savedNode = saved?.nodes.find((n) => n.node_id === id);
			const image = card ? project.production.assets.findLast((asset) => asset.card_id === card.card_id && asset.kind === 'image') : null;
			const video = card ? project.production.assets.findLast((asset) => asset.card_id === card.card_id && asset.kind === 'video') : null;
			return {
				id,
				type: 'story_card',
				position: { x: savedNode?.x ?? 760 + (index % 5) * 260, y: savedNode?.y ?? Math.floor(index / 5) * 210 },
				data: { card, order: index, imageUrl: image?.url ?? null, videoUrl: video?.url ?? null, videoAssetId: video?.asset_id ?? null, videoIn: video?.in_s ?? null, videoOut: video?.out_s ?? null, videoSpeed: video?.speed ?? null },
				ariaLabel: card ? `Story card ${index + 1}, ${card.title}` : `Story card ${index + 1}, awaiting draft`
			};
		});
		return [seedNode, ...voiceNodes, ...storyNodes];
	}

	function projectToEdges(project: Project): Edge[] {
		const voiceEdges = project.voices.map((voice) => ({
			id: `${project.seed.seed_id}->${voice.voice_id}`,
			source: project.seed.seed_id,
			target: voice.voice_id
		}));
		const storyIds = project.production.cards.length > 0
			? project.production.cards.map((card) => card.card_id)
			: Array.from({ length: 6 }, (_, order) => `story-placeholder-${order}`);
		const storyEdges = storyIds.map((id, index) => ({
			id: index === 0 ? `${project.seed.seed_id}->${id}` : `${storyIds[index - 1]}->${id}`,
			source: index === 0 ? project.seed.seed_id : storyIds[index - 1],
			target: id,
			animated: project.production.cards.length === 0
		}));
		return [...voiceEdges, ...storyEdges];
	}

	function adoptProject(project: Project, nextLayout: CanvasLayout | null = layout) {
		const keepEdits = seedDirty;
		activeProject = project;
		if (!keepEdits) {
			editTitle = project.seed.title;
			editBrief = project.seed.brief;
		}
		ui.activeProjectTitle = project.title;
		ui.activeProject = project;
		layout = nextLayout;
		nodes = projectToNodes(project, nextLayout);
		edges = projectToEdges(project);
		syncPolling(project);
	}

	async function loadProjects() {
		try {
			const response = await fetch('/api/projects');
			if (!response.ok) throw new Error(`GET /api/projects failed: ${response.status}`);
			const body = (await response.json()) as { projects: ProjectSummary[] };
			projects = body.projects;
			loadError = null;
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Project list read failed';
		}
	}

	async function openProject(projectId: string) {
		try {
			const response = await fetch(`/api/projects/${projectId}`);
			if (!response.ok) throw new Error(`GET /api/projects/${projectId} failed: ${response.status}`);
			const body = (await response.json()) as { project: Project; layout: CanvasLayout | null };
			adoptProject(body.project, body.layout);
			viewport = body.layout?.viewport ?? { x: 0, y: 0, zoom: 1 };
			selectedNodeId = null;
			loadError = null;
			seedError = null;
			roomError = null;
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Project read failed';
		}
	}

	async function createProject() {
		creating = true;
		try {
			const response = await fetch('/api/projects', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					command: 'create_project',
					title: 'Untitled creative spurt',
					brief: '',
					creative_focus: 'full room',
					created_by: 'gordo'
				})
			});
			if (!response.ok && response.status !== 201) {
				throw new Error(`create_project failed: ${response.status}`);
			}
			const body = (await response.json()) as { ok: boolean; data: Project };
			if (!body.ok) throw new Error('create_project rejected');
			await loadProjects();
			await openProject(body.data.project_id);
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Project create failed';
		} finally {
			creating = false;
		}
	}

	async function saveSeed() {
		if (!activeProject || !seedDirty || savingSeed) return;
		savingSeed = true;
		seedError = null;
		try {
			const response = await fetch(`/api/projects/${activeProject.project_id}/seed`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					expected_version: activeProject.version,
					title: editTitle.trim() || undefined,
					brief: editBrief
				})
			});
			const body = (await response.json()) as
				| { ok: true; data: Project }
				| { ok: false; error: { message: string } };
			if (!body.ok) throw new Error(body.error.message);
			adoptProject(body.data, layout);
			await loadProjects();
		} catch (e) {
			seedError = e instanceof Error ? e.message : 'Seed update failed';
		} finally {
			savingSeed = false;
		}
	}

	let layoutSaveTimer: ReturnType<typeof setTimeout> | null = null;

	async function persistLayout() {
		if (!activeProject) return;
		savingLayout = true;
		try {
			const next: CanvasLayout = {
				schema_version: 1,
				project_id: activeProject.project_id,
				nodes: nodes.filter((n) => !n.id.startsWith('story-placeholder-')).map((n) => {
					const previous = layout?.nodes.find((p) => p.node_id === n.id);
					const type = n.type === 'voice' ? 'voice' : n.type === 'story_card' ? 'story_card' : 'seed';
					return {
						node_id: n.id,
						type,
						lane: previous?.lane ?? (type === 'voice' ? 'voices' : type === 'story_card' ? 'storyboard' : 'seeds'),
						x: n.position.x,
						y: n.position.y,
						width: previous?.width ?? 320,
						height: previous?.height ?? (type === 'voice' ? 280 : 400)
					};
				}),
				viewport,
				updated_at: layout?.updated_at ?? new Date().toISOString()
			};
			const response = await fetch(`/api/projects/${activeProject.project_id}/layout`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ command: 'save_canvas_layout', project_id: activeProject.project_id, layout: next })
			});
			if (!response.ok) throw new Error(`layout save failed: ${response.status}`);
			const body = (await response.json()) as { ok: boolean; data: CanvasLayout };
			if (body.ok) layout = body.data;
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Canvas layout save failed';
		} finally {
			savingLayout = false;
		}
	}

	function scheduleLayoutSave() {
		if (layoutSaveTimer) clearTimeout(layoutSaveTimer);
		layoutSaveTimer = setTimeout(() => void persistLayout(), 600);
	}

	async function commandProject(url: string, payload: Record<string, unknown>): Promise<Project> {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
		const body = (await response.json()) as
			| { ok: true; data: Project }
			| { ok: false; error: { message: string } };
		if (!body.ok) throw new Error(body.error.message);
		return body.data;
	}

	async function refreshOpenProject(project: Project) {
		const response = await fetch(`/api/projects/${project.project_id}`);
		if (response.ok) {
			const body = (await response.json()) as { project: Project; layout: CanvasLayout | null };
			adoptProject(body.project, body.layout);
			return;
		}
		adoptProject(project, layout);
	}

	async function harvestCatalog() {
		if (!activeProject || catalogBusy) return;
		catalogBusy = true;
		roomError = null;
		try {
			const project = await commandProject(`/api/projects/${activeProject.project_id}/catalog`, {
				command: 'harvest_catalog',
				expected_version: activeProject.version
			});
			catalogBusy = false;
			await refreshOpenProject(project);
		} catch (e) {
			roomError = e instanceof Error ? e.message : 'Catalog harvest failed';
			catalogBusy = false;
			if (activeProject) nodes = projectToNodes(activeProject, layout);
		} finally {
			catalogBusy = false;
		}
	}

	async function reshuffleRoster() {
		if (!activeProject || catalogBusy) return;
		catalogBusy = true;
		roomError = null;
		try {
			const project = await commandProject(`/api/projects/${activeProject.project_id}/catalog`, {
				command: 'reshuffle_roster',
				expected_version: activeProject.version
			});
			catalogBusy = false;
			await refreshOpenProject(project);
		} catch (e) {
			roomError = e instanceof Error ? e.message : 'Reshuffle failed';
			catalogBusy = false;
			if (activeProject) nodes = projectToNodes(activeProject, layout);
		} finally {
			catalogBusy = false;
		}
	}

	async function startCreativeRoom() {
		if (!activeProject || roomBusy) return;
		roomBusy = true;
		roomError = null;
		try {
			const project = await commandProject(`/api/projects/${activeProject.project_id}/creative-room`, {
				command: 'start_creative_room',
				expected_version: activeProject.version
			});
			roomBusy = false;
			await refreshOpenProject(project);
		} catch (e) {
			roomError = e instanceof Error ? e.message : 'Creative Room dispatch failed';
			roomBusy = false;
			if (activeProject) nodes = projectToNodes(activeProject, layout);
		} finally {
			roomBusy = false;
		}
	}

	async function reconcileCreativeRoom() {
		if (!activeProject || roomBusy) return;
		try {
			const project = await commandProject(`/api/projects/${activeProject.project_id}/creative-room`, {
				command: 'reconcile_creative_room',
				expected_version: activeProject.version
			});
			if (project.version !== activeProject.version) await refreshOpenProject(project);
		} catch (e) {
			const message = e instanceof Error ? e.message : 'Creative Room reconcile failed';
			if (message.includes('Version conflict') && activeProject) {
				await openProject(activeProject.project_id);
				return;
			}
			roomError = message;
		}
	}

	let pollTimer: ReturnType<typeof setInterval> | null = null;

	function syncPolling(project: Project) {
		const flying = project.creative_room?.status === 'queued' || project.creative_room?.status === 'running';
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
		if (flying) {
			pollTimer = setInterval(() => void reconcileCreativeRoom(), 3000);
		}
	}

	onMount(() => {
		const savedWorkspace = localStorage.getItem('csp.workspace-tab');
		if (savedWorkspace && ['canvas', 'story', 'cards', 'media', 'preview', 'export'].includes(savedWorkspace)) {
			openWorkspace(savedWorkspace as 'canvas' | ProductionTab);
		}
		ui.activeProjectUpdater = (project) => adoptProject(project, layout);
		ui.pageActions = [
			{ id: 'new-project', label: 'new project', hint: 'seed · s0', run: () => void createProject() },
			{ id: 'toggle-inspector', label: 'toggle inspector', hint: 'panel', run: () => (inspectorOpen = !inspectorOpen) }
		];
		void loadProjects().then(() => {
			if (projects.length > 0) void openProject(projects[0].project_id);
		});
		return () => {
			if (layoutSaveTimer) clearTimeout(layoutSaveTimer);
			if (pollTimer) clearInterval(pollTimer);
			ui.pageActions = [];
			ui.activeProjectTitle = '';
			ui.activeProjectUpdater = null;
		};
	});
</script>

<svelte:head><title>Creative Studio Pro</title></svelte:head>

<div class="grid h-full min-w-0 overflow-x-hidden" style="grid-template-rows: 40px minmax(0,1fr) 42px">
	<!-- Project toolbar (40px) -->
	<div class="flex min-w-0 items-center gap-2 border-b border-border-subtle bg-surface-raised px-3">
		<span class="meta-label hidden sm:inline">Project</span>
		<b class="min-w-0 truncate">{activeProject?.title ?? 'No project open'}</b>
		{#if activeProject}
			<span class="meta-label text-text-dim">v{activeProject.version}</span>
		{/if}
		<div class="ml-2 hidden min-w-0 items-center gap-0.5 overflow-x-auto lg:flex">
			{#each workspaceTabs as item (item.label)}
				<button type="button" class={['px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em]', (item.tab === 'canvas' ? canvasOpen : !canvasOpen && productionTab === item.tab) ? 'bg-[color-mix(in_srgb,var(--color-voice-1)_12%,var(--color-surface-raised-2))] text-[color-mix(in_srgb,var(--color-voice-1)_75%,white)]' : 'text-text-dim hover:text-text-muted']} onclick={() => openWorkspace(item.tab)}>{item.label}</button>
			{/each}
		</div>
		<span class="grow"></span>
		<button type="button" class="btn btn-charm" disabled={!activeProject || !briefLocked} title={briefLocked ? 'Open Stage Agent' : 'Save and lock the owner brief first'} onclick={() => { ui.chatMode = 'focus'; ui.chatOpen = !ui.chatOpen; }}>
			<span class="charm-gradient-text font-bold">✦</span> Agent
		</button>
		<button type="button" class="btn btn-accent" onclick={() => void createProject()} disabled={creating}>
			<span class="sm:hidden">{creating ? '…' : '+ New'}</span>
			<span class="hidden sm:inline">{creating ? 'Creating…' : '+ New project'}</span>
		</button>
		<button type="button" class="btn hidden sm:flex" disabled title="Source video lane arrives in Phase 2">
			+ Source
		</button>
		<button type="button" class="btn hidden font-mono text-[11px] sm:flex" onclick={() => (ui.paletteOpen = true)} title="Command palette">
			⌘K
		</button>
		<button
			type="button"
			class="btn px-2 font-mono text-[11px]"
			onclick={() => (inspectorOpen = !inspectorOpen)}
			title={inspectorOpen ? 'Collapse inspector' : 'Expand inspector'}
			aria-pressed={inspectorOpen}
		>
			{inspectorOpen ? '▸' : '◂'}
		</button>
	</div>

	<!-- Work area: lane rail + canvas + inspector -->
	<div
		class="work-area grid min-h-0 min-w-0 transition-[grid-template-columns] duration-300 ease-out"
		style={`--inspector-width: ${inspectorOpen ? '300px' : '0px'}; --rail-width: ${canvasOpen ? '190px' : '0px'}`}
	>
		<aside class={['hidden overflow-hidden bg-surface-raised md:block', canvasOpen ? 'border-r border-border-default p-3' : 'p-0']} aria-label="Canvas layers" aria-hidden={!canvasOpen}>
			{#if canvasOpen}
				<div class="meta-label">Canvas layers</div>
				<div class="mt-3 grid gap-1.5">
					<div class="layer-row"><span class="bg-voice-1"></span><b>Seed</b><small>1</small></div>
					<div class="layer-row"><span class="bg-[#4ab8ff]"></span><b>Voices</b><small>{activeProject?.voices.length ?? 0}</small></div>
					<div class="layer-row"><span class="bg-[#5cffbe]"></span><b>Story cards</b><small>{activeProject?.production.cards.length || 6}</small></div>
					<div class="layer-row"><span class="bg-[#8174e8]"></span><b>Media</b><small>{activeProject?.production.assets.length ?? 0}</small></div>
				</div>
				<p class="mt-4 font-mono text-[9px] leading-4 text-text-dim">Drag cards to arrange the production. Flip each card between text, image, and video.</p>
			{/if}
		</aside>

		<main class="relative min-w-0">
			{#if loadError}
				<div
					class="absolute inset-x-0 top-0 z-10 border-b border-[color-mix(in_srgb,var(--color-gate-failed)_55%,var(--color-border-default))] bg-surface-raised-2 px-3 py-2 text-gate-failed"
					role="alert"
				>
					{loadError}
				</div>
			{/if}

			{#if activeProject && canvasOpen}
				<div class="relative h-full">
					<SvelteFlow
						bind:nodes
						bind:edges
						bind:viewport
						{nodeTypes}
						minZoom={0.25}
						maxZoom={2}
						fitView={false}
						nodesConnectable={false}
						selectionKey={null}
						onnodeclick={({ node }) => (selectedNodeId = node.id)}
						onnodedragstop={scheduleLayoutSave}
						onmoveend={scheduleLayoutSave}
					>
						<Background
							variant={BackgroundVariant.Dots}
							gap={22}
							size={1.4}
							patternColor="#3a3a40"
						/>
						<Controls showLock={false} position="bottom-left" />
					</SvelteFlow>
					{#if reviewSequence.items.length}
						<div class="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 border border-[#26383f] bg-[#0b0f13]/95 px-2 py-1.5 font-mono text-[10px] text-[#9fc9cf]">
							<span class="text-[#55dfd5]">SEQUENCE</span>
							{#each reviewSequence.items as item, i (item.id)}<span class="bg-[#14232a] px-1.5 py-0.5">{i + 1} · {item.title.split(' — ')[0]}</span>{/each}
							<button type="button" class="bg-[#55dfd5] px-2 py-0.5 font-bold text-black" onclick={() => (reviewSequence.playing = true)}>▶ play</button>
							<button type="button" class="bg-[#14232a] px-2 py-0.5" onclick={() => reviewSequence.clear()}>clear</button>
						</div>
					{/if}
					{#if reviewSequence.playing && activeProject}<SequencePlayer project={activeProject} onUpdated={(project) => adoptProject(project, layout)} />{/if}
				</div>
			{:else if activeProject}
				<ProductionWorkspace project={activeProject} onUpdated={(project) => adoptProject(project, layout)} bind:tab={productionTab} />
			{:else}
				<div class="canvas-empty flex h-full items-center justify-center p-6">
					<div class="w-full max-w-[340px] rounded-md border border-dashed border-border-default bg-surface-raised/80 p-5 text-center backdrop-blur-sm">
						<span class="chip meta-label mx-auto">Seed · S0</span>
						<h2 class="mt-4 text-[16px] font-semibold leading-snug">Start a project</h2>
						<p class="mx-auto mt-1.5 max-w-[260px] text-text-muted">
							Drop an idea, image, or source video. The creative room takes it from there.
						</p>
						<div class="mt-4">
							<button type="button" class="btn btn-accent" onclick={() => void createProject()} disabled={creating}>
								{creating ? 'Creating…' : '+ New project'}
							</button>
						</div>
					</div>
				</div>
			{/if}
		</main>

		<aside
			class={[
				'overflow-hidden bg-surface-raised',
				inspectorOpen
					? 'fixed bottom-[42px] right-0 top-[88px] z-30 block w-[min(92vw,360px)] border-l lg:static lg:w-auto'
					: 'hidden',
				inspectorOpen && 'border-l border-border-default'
			]}
			aria-label="Inspector"
			aria-hidden={!inspectorOpen}
		>
			<div class="h-full w-[300px] overflow-y-auto p-3">
				{#if activeProject}
					<StageGatePanel project={activeProject} onUpdated={(p) => adoptProject(p, layout)} />

					<div class="my-3 h-px bg-border-subtle"></div>

					<div class="meta-label">Seed</div>
					<label class="meta-label mt-2 block" for="seed-title">Title</label>
					<input
						id="seed-title"
						bind:value={editTitle}
						maxlength="200"
						class="mt-1 w-full rounded-sm border border-border-default bg-surface-base px-2 py-1.5 text-[13px] text-text-primary outline-none placeholder:text-text-dim focus:border-text-dim"
						placeholder="Seed title"
					/>
					<label class="meta-label mt-2 block" for="seed-brief">Brief</label>
					<textarea
						id="seed-brief"
						bind:value={editBrief}
						rows="4"
						maxlength="5000"
						class="mt-1 w-full resize-y rounded-sm border border-border-default bg-surface-base px-2 py-1.5 text-[13px] text-text-primary outline-none placeholder:text-text-dim focus:border-text-dim"
						placeholder="Rough idea, references, constraints…"
					></textarea>
					<div class="mt-1.5 flex items-center gap-2">
						<span class="meta-label text-text-dim capitalize">{activeProject.seed.creative_focus}</span>
						<span class="grow"></span>
						{#if seedDirty}
							<button type="button" class="btn btn-accent px-2.5 py-1" onclick={() => void saveSeed()} disabled={savingSeed}>
								{savingSeed ? 'Saving…' : 'Save seed'}
							</button>
						{/if}
					</div>
					{#if seedError}
						<div class="mt-1.5 text-gate-failed" role="alert">{seedError}</div>
					{/if}

					<div class="my-3 h-px bg-border-subtle"></div>
				{/if}

				{#if selectedVoice}
					<div class="meta-label">Model Voice</div>
					<div class="mt-2 rounded-sm border border-border-default bg-surface-raised-2 p-2.5">
						<span class="flex items-center gap-1.5">
							<span class="block h-1.5 w-1.5 rounded-full" style:background={voiceStatusColor[voiceSurfaceStatus(selectedVoice)]}></span>
							<strong>{selectedVoice.label}</strong>
						</span>
						<div class="meta-label mt-1 text-text-dim">{selectedVoice.provider} · {selectedVoice.raycast_agent}</div>
						<div class="meta-label mt-1" style:color={voiceStatusColor[voiceSurfaceStatus(selectedVoice)]}>
							{voiceSurfaceStatus(selectedVoice)}
						</div>
						{#if selectedVoice.title}
							<p class="mt-2 font-medium">{selectedVoice.title}</p>
						{/if}
						{#if selectedVoice.logline}
							<p class="mt-1 text-text-muted">{selectedVoice.logline}</p>
						{/if}
						{#if selectedVoice.raw_text}
							<pre class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-text-muted">{selectedVoice.raw_text}</pre>
						{:else}
							<p class="mt-2 text-text-dim">No verbatim reply stored yet.</p>
						{/if}
						{#if selectedVoice.content_hash}
							<div class="meta-label mt-2 break-all text-text-dim">content {selectedVoice.content_hash}</div>
						{/if}
						{#if selectedVoice.prompt_hash}
							<div class="meta-label mt-1 break-all text-text-dim">prompt {selectedVoice.prompt_hash}</div>
						{/if}
					</div>
					<div class="my-3 h-px bg-border-subtle"></div>
				{/if}

				<div class="meta-label">Capability</div>
				<div class="mt-1.5 rounded-sm border border-border-default bg-surface-raised-2 p-2.5">
					<span class="mb-1 flex items-center gap-1.5">
						<span
							class={[
								'block h-1.5 w-1.5 rounded-full',
								activeProject?.catalog_snapshot ? 'bg-gate-approved' : 'bg-capability-offline'
							]}
						></span>
						<strong class="meta-label text-text-primary">Creative Room bridge</strong>
					</span>
					<span class="text-text-muted">
						{activeProject?.catalog_snapshot
							? `${activeProject.catalog_snapshot.models.length} labels · ${activeProject.catalog_snapshot.bridge_version}`
							: 'Creative Room runs need a live catalog.'}
					</span>
					<button
						type="button"
						class="btn mt-2 w-full justify-center px-2 py-1"
						onclick={() => (ui.capabilitiesOpen = true)}
					>
						Open Capability Drawer
					</button>
				</div>
			</div>
		</aside>
	</div>

	<!-- Transport strip (42px) -->
	<footer class="meta-label flex min-w-0 items-center gap-2 overflow-hidden border-t border-border-default bg-surface-raised px-3 sm:gap-3">
		<span class="flex items-center gap-1.5 text-gate-pending">
			<span class="block h-1.5 w-1.5 rounded-full bg-gate-pending"></span>
			{activeProject ? `${activeProject.stage.id} · ${stageName(activeProject.stage.id).toUpperCase()}` : 'NO PROJECT'}
		</span>
		<span class="text-border-default">|</span>
		<span class="hidden sm:inline">
			Confidence {activeProject?.stage.confidence ?? '—'}
		</span>
		{#if activeProject?.creative_room}
			<span class="text-border-default">|</span>
			<span class="text-text-muted">
				Room {activeProject.creative_room.status}
				{#if activeProject.voices.length > 0}
					· {activeProject.voices.filter((v) => v.raw_text).length}/{activeProject.voices.length} replies
				{/if}
			</span>
		{/if}
		<span class="grow"></span>
		<span aria-live="polite" class={['hidden transition-opacity sm:inline', savingLayout ? 'opacity-100' : 'opacity-0']}>
			Saving canvas…
		</span>
		<span class="text-border-default">|</span>
		<span class="text-text-dim">{activeProject?.stage.state ?? '—'}</span>
	</footer>
</div>

<style>
	.layer-row { display: grid; grid-template-columns: 6px 1fr auto; align-items: center; gap: 8px; padding: 6px 7px; background: #151519; color: #8d9ca1; }
	.layer-row > span { width: 6px; height: 6px; }
	.layer-row b { font-size: 11px; font-weight: 500; }
	.layer-row small { font: 9px var(--font-mono); color: #626b70; }
</style>
