<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import {
		SvelteFlow,
		Background,
		BackgroundVariant,
		Controls,
		SelectionMode,
		type Node,
		type Edge,
		type Viewport
	} from '@xyflow/svelte';
	import SeedNode from '$lib/ui/nodes/SeedNode.svelte';
	import VoiceNode from '$lib/ui/nodes/VoiceNode.svelte';
	import StoryCardNode from '$lib/ui/nodes/StoryCardNode.svelte';
	import SceneNode from '$lib/ui/nodes/SceneNode.svelte';
	import { posterUrl } from '$lib/media/gpu/clipBanks';
	import SpineEdge from '$lib/ui/edges/SpineEdge.svelte';
	import FitOnOpen from '$lib/ui/FitOnOpen.svelte';
	import FrameKey from '$lib/ui/FrameKey.svelte';
	import SequencePlayer from '$lib/ui/SequencePlayer.svelte';
	import { reviewSequence } from '$lib/ui/review-sequence.svelte';
	import ProductionWorkspace from '$lib/ui/ProductionWorkspace.svelte';
	import NewProjectFlow from '$lib/ui/NewProjectFlow.svelte';
	import AgentChat from '$lib/ui/chat/AgentChat.svelte';
	import ProjectMenu from '$lib/ui/shell/ProjectMenu.svelte';
	import Outline from '$lib/ui/shell/Outline.svelte';
	import { STAGES, restoreTab, stageOfTab, tabForStage, viewsOfStage } from '$lib/domain/stages';
	import type { StageId, WorkspaceTab } from '$lib/domain/stages';
	import { nextLine } from '$lib/domain/next-line';
	import { storyNextLine } from '$lib/domain/story-levels';
	import type { ProductionTab } from '$lib/ui/ProductionWorkspace.svelte';
	import { ui } from '$lib/ui/app-state.svelte';
	import { stageName } from '$lib/domain/gates';
	import { voiceStatusColor, voiceSurfaceStatus } from '$lib/ui/voice-display';
	import { pickFor, takesFor } from '$lib/domain/takes';
	import { isMissingShot, playItemFor, slateAssetId, slateUrl } from '$lib/domain/slate';
	import { shortShotCode } from '$lib/domain/story-plan';
	import { benchedBeats } from '$lib/domain/bench';
	import { mediaKind } from '$lib/domain/media';
	import { dropMeaning, type DropContext } from '$lib/domain/drops';
	import ShotBrief from '$lib/ui/shots/ShotBrief.svelte';
	import { roomState } from '$lib/ui/review-room-state.svelte';
	import { due, roomLine } from '$lib/domain/review-poll';
	import { droppedFiles } from '$lib/ui/dropped-files';
	import { pendingGenerations } from '$lib/domain/animate';
	import AnimatePanel from '$lib/ui/AnimatePanel.svelte';
	import FinalizePanel from '$lib/ui/FinalizePanel.svelte';
	import { ASSEMBLY_VIEW, assemblyPlay, assemblyViews, type AssemblyItem, CUT_VIEW, cutShots, cutViews, groupOf, groupsOf, isAssemblyView, isBoardView, isCutView, MAIN_GROUP, sceneGlimpse, sceneShots, nextGroupName } from '$lib/domain/groups';
	import { readingOrder } from '$lib/domain/board-order';
	import Pick from '$lib/ui/controls/Pick.svelte';
	import Toggle from '$lib/ui/controls/Toggle.svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { CLOSING_MS, draftsClosingSoon, finalizingIds, timeLeft } from '$lib/domain/finalize';
	import { clock } from '$lib/ui/clock.svelte';
	import { SEED, connect, deriveSpine, disconnect, linksOf, spineOf, type SpineLink } from '$lib/domain/spine';
	import type { Project, ProjectSummary, CanvasLayout, ShotReference } from '$lib/domain/schemas';
	import { previousPick } from '$lib/domain/shot-references';
	import { prepEntries } from '$lib/domain/prep';
	import ReferencesDrawer from '$lib/ui/ReferencesDrawer.svelte';

	const nodeTypes = { seed: SeedNode, voice: VoiceNode, story_card: StoryCardNode, scene: SceneNode };
	const edgeTypes = { spine: SpineEdge };

	let projects = $state<ProjectSummary[]>([]);
	let activeProject = $state<Project | null>(null);
	let layout = $state<CanvasLayout | null>(null);

	// View projections (AD-12): server state is canonical; these runes hold
	// optimistic command state replaced by server results.
	let nodes = $state<Node[]>([]);
	let edges = $state<Edge[]>([]);
	let viewport = $state<Viewport>({ x: 0, y: 0, zoom: 1 });
	let fitRequest = $state<string | null>(null);
	/** A shot to frame on the board (a click in the Bin): its card id. */
	let focusRequest = $state<string | null>(null);
	let selectedNodeId = $state<string | null>(null);
	let savingLayout = $state(false);
	let loadError = $state<string | null>(null);
	// The series' references (V1S-326): names for the chips on shots, thumbnails in the References drawer.
	type SeriesRef = { page_id: string; name: string; kind: string; role: string; handles: string[]; file_name: string; name_on_sheet: boolean; scene_ids: string[] };
	type SeriesRefFile = { width: number; height: number; file_name: string; version_id: string };
	let seriesRefs = $state<SeriesRef[]>([]);
	let seriesRefFiles = $state<Record<string, SeriesRefFile>>({});
	// The drawer follows Prep's order for this episode (most-used characters first, then places in
	// scene order); references the episode doesn't use come after.
	let drawerRefs = $derived.by(() => {
		const order = prepEntries(activeProject?.series?.scenes ?? [], seriesRefs).map((entry) => entry.reference_page_id);
		const rank = (pageId: string) => { const at = order.indexOf(pageId); return at < 0 ? order.length : at; };
		return seriesRefs.toSorted((a, b) => rank(a.page_id) - rank(b.page_id));
	});
	let seriesRefsFor = $state<string | null>(null);
	function loadSeriesRefs(id: string) {
		void fetch(`/api/series/${id}`).then((response) => response.json()).then((body: { ok: boolean; data?: { references?: { items: SeriesRef[] }; reference_files?: Record<string, SeriesRefFile> } }) => {
			if (body.ok && seriesRefsFor === id) {
				seriesRefs = body.data?.references?.items ?? [];
				seriesRefFiles = body.data?.reference_files ?? {};
				if (activeProject) nodes = projectToNodes(activeProject, layout);
			}
		}).catch(() => {});
	}
	$effect(() => {
		const id = activeProject?.series?.series_id ?? null;
		if (id === seriesRefsFor) return;
		seriesRefsFor = id;
		seriesRefs = [];
		seriesRefFiles = {};
		if (id) loadSeriesRefs(id);
	});
	// A trailer has no series: the drawer shows its Prep sheets instead (characters, places, props), read-only.
	type PrepRef = { page_id: string; name: string; kind: string; handles: string[]; file_name: string; name_on_sheet: boolean; url: string | null };
	let prepRefs = $state<PrepRef[]>([]);
	let prepRefsFor = $state<string | null>(null);
	function loadPrepRefs(projectId: string, signal: AbortSignal) {
		type Item = { entry: { key: string; name: string; kind: string }; current?: { url?: string } | null; state: { result?: { url?: string } | null } };
		void fetch(`/api/projects/${projectId}/prep`, { signal }).then((response) => response.json()).then((body: { ok: boolean; data?: { items: Item[] } | null }) => {
			if (signal.aborted || !body.ok || prepRefsFor !== projectId) return;
			prepRefs = (body.data?.items ?? []).map((item) => ({ page_id: item.entry.key, name: item.entry.name, kind: item.entry.kind, handles: [], file_name: '', name_on_sheet: true, url: item.state.result?.url ?? item.current?.url ?? null }));
		}).catch(() => {});
	}
	$effect(() => {
		const id = activeProject && !activeProject.series ? activeProject.project_id : null;
		const boardOpen = canvasOpen;
		const refsOpen = inspectorOpen;
		if (id !== prepRefsFor) {
			prepRefsFor = id;
			prepRefs = [];
		}
		// Prep writes its own state: refresh on returning to Board or reopening Refs.
		const controller = new AbortController();
		if (id && (boardOpen || refsOpen)) loadPrepRefs(id, controller.signal);
		return () => controller.abort();
	});
	/** The selected shot on the board, for "Attach" in the References drawer. */
	let selectedCard = $derived(activeProject?.production.cards.find((card) => card.card_id === selectedNodeId) ?? null);
	let creating = $state(false);
	// The board has no permanent right panel (V1S-132): the brief lives in Story; the inspector opens on demand.
	let inspectorOpen = $state(false);
	// The left panel collapses inward to a slim tab on the edge (remembered).
	let railCollapsed = $state(false);
	$effect(() => { try { railCollapsed = localStorage.getItem('csp.rail-collapsed') === '1'; } catch { /* private mode */ } });
	// Layers panel width: drag its right edge; remembered per browser.
	const RAIL_MIN = 184, RAIL_MAX = 520;
	let railWidth = $state(260);
	let railResizing = $state(false);
	$effect(() => { try { const saved = Number(localStorage.getItem('csp.rail-width')); if (saved >= RAIL_MIN && saved <= RAIL_MAX) railWidth = saved; } catch { /* private mode */ } });
	function startRailResize(event: PointerEvent) {
		event.preventDefault();
		const startX = event.clientX, startWidth = railWidth;
		railResizing = true;
		const move = (e: PointerEvent) => { railWidth = Math.round(Math.min(RAIL_MAX, Math.max(RAIL_MIN, startWidth + e.clientX - startX))); };
		const up = () => {
			railResizing = false;
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			try { localStorage.setItem('csp.rail-width', String(railWidth)); } catch { /* private mode */ }
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}
	function nudgeRail(event: KeyboardEvent) {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		railWidth = Math.min(RAIL_MAX, Math.max(RAIL_MIN, railWidth + (event.key === 'ArrowRight' ? 16 : -16)));
		try { localStorage.setItem('csp.rail-width', String(railWidth)); } catch { /* private mode */ }
	}
	function setRailCollapsed(collapsed: boolean) {
		railCollapsed = collapsed;
		try { localStorage.setItem('csp.rail-collapsed', collapsed ? '1' : '0'); } catch { /* private mode */ }
	}
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
	// The four stages (CONTEXT.md: Stage); each groups the views the app already had.
	let lastViews = $state<Partial<Record<StageId, WorkspaceTab>>>({});
	const currentTab = $derived<WorkspaceTab>(canvasOpen ? 'canvas' : productionTab);
	const currentStage = $derived(stageOfTab(currentTab));
	const stageViews = $derived(viewsOfStage(currentStage));
	let menuOpen = $state(false);
	/** The dock holds the Agent and the selected shot's details. */
	let dockTab = $state<'agent' | 'details'>('agent');
	let detailsHost = $state<HTMLElement | null>(null);
	/** The Agent is docked beside the work; whether it is open is remembered on this machine. */
	let agentRestored = $state(false);
	const dockOpen = $derived(ui.chatOpen && ui.chatMode === 'dock');
	$effect(() => { if (agentRestored) localStorage.setItem('csp.agent-open', ui.chatOpen ? '1' : '0'); });
	const next = $derived(nextLine(activeProject ? { production: activeProject.production, reviewed: !!(activeProject.series || activeProject.review_room), story: storyNextLine(activeProject) } : null));
	const secondaryNav = [
		{ label: 'Series', href: '/series', hint: 'Series from Notion: connect a show, check it, import episodes as projects' },
		{ label: 'Watch', href: '/watch', hint: 'The public, read-only pages: what you have published' },
		{ label: 'Library', href: '/library', hint: 'Every project, its files and media' },
		{ label: 'Runs', href: '/runs', hint: 'Agent and generation runs, with their cost and results' },
		{ label: 'Settings', href: '/settings', hint: 'App settings: the Agent\'s model, video generation (Higgsfield), the sound-effects folder' }
	];

	function openWorkspace(tab: WorkspaceTab) {
		canvasOpen = tab === 'canvas';
		if (tab !== 'canvas') productionTab = tab;
		lastViews[stageOfTab(tab)] = tab;
		localStorage.setItem('csp.workspace-tab', tab);
	}

	function openStage(stage: StageId) {
		openWorkspace(tabForStage(stage, lastViews));
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
		// A cut view shows the cut's shots in play order, laid out fresh in reading order so "play in order" gives the edit.
		const cutView = isCutView(activeGroup);
		// An assembly shows its single shots as the real shot cards, at the places the assembly keeps for them.
		const asm = isAssemblyView(activeGroup) ? (project.production.assemblies ?? []).find((a) => `${ASSEMBLY_VIEW}${a.assembly_id}` === activeGroup) ?? null : null;
		const asmPlace = (cardId: string) => asm?.shots?.find((s) => s.card_id === cardId);
		const cardRecords = project.production.cards.length > 0
			? (asm ? (asm.shots ?? []).flatMap((s) => project.production.cards.filter((card) => card.card_id === s.card_id))
				: cutView ? cutShots(project.production, activeGroup.slice(CUT_VIEW.length)) : project.production.cards.filter((card) => groupOf(card) === activeGroup)).map((card) => ({ id: card.card_id, card }))
			: Array.from({ length: 6 }, (_, order) => ({ id: `story-placeholder-${order}`, card: null }));
		const chain = spineOf(project.production).chain.map((card) => card.card_id);
		const storyNodes: Node[] = cardRecords.map(({ id, card }, index) => {
			const savedNode = asm ? asmPlace(id) : cutView ? undefined : saved?.nodes.find((n) => n.node_id === id);
			const takes = card ? takesFor(project.production, card.card_id, true) : [];
			const pick = card ? pickFor(project.production, card) : null;
			const spineIndex = card ? chain.indexOf(card.card_id) : index;
			return {
				id,
				type: 'story_card',
				position: { x: savedNode?.x ?? 760 + (index % 5) * 260, y: savedNode?.y ?? Math.floor(index / 5) * 300 },
				data: {
					card, order: index, spineIndex: spineIndex < 0 ? null : spineIndex, takes, pickId: pick?.asset_id ?? null,
					code: card ? shortShotCode(project.review_room?.shots?.[card.card_id]?.code) : null,
					slate: card && isMissingShot(project.production, card) ? { src: slateUrl(project.project_id, card.card_id), assetId: slateAssetId(card.card_id) } : null,
					onPick: (takeId: string) => card && pickTake(card.card_id, takeId),
					onReject: (takeId: string) => sendBoardCommand({ command: 'reject_take', take_id: takeId }),
					onRestore: (takeId: string) => sendBoardCommand({ command: 'restore_take', take_id: takeId }),
					onBench: (benched: boolean) => card && benchBeat(card.card_id, benched),
					series: Boolean(project.series),
					references: card ? (card.references ?? []).map((reference) => ({ key: referenceKey(reference), kind: reference.kind, label: reference.kind === 'series' ? (seriesRefs.find((item) => item.page_id === reference.page_id)?.name ?? 'Missing reference') : reference.upscaled_from ? `Prev frame (up from ${Math.max(reference.upscaled_from.width, reference.upscaled_from.height)} px)` : 'Prev frame', url: reference.kind === 'previous_frame' ? reference.url : null })) : [],
					canAttachPrevious: card ? Boolean(previousPick(project.production, card.card_id)) : false,
					onAttachPrevious: () => card && attachPreviousFrame(card.card_id),
					onRemoveReference: (key: string) => card && setShotReferences(card.card_id, (card.references ?? []).filter((reference) => referenceKey(reference) !== key)),
					onDropReference: (pageId: string) => card && setShotReferences(card.card_id, [...(card.references ?? []).filter((reference) => reference.kind === 'series'), { kind: 'series', page_id: pageId }, ...(card.references ?? []).filter((reference) => reference.kind !== 'series')]),
					onHold: (options: { length_s: number; push_in: boolean; fade: boolean }) => card && makeHold(card.card_id, card.title, options),
					onAnimate: () => card && (animateCardId = card.card_id),
					onSplit: (takeId: string) => card && void splitTake(takeId),
					splitting: splittingTake,
					animating: card ? pendingGenerations(project.production).some((generation) => generation.card_id === card.card_id && !generation.finalizes) : false,
					onFinalize: (takeId: string) => card && (finalizing = { takeIds: [takeId], title: card.title }),
					finalizing: [...finalizingIds(project.production)]
				},
				ariaLabel: card
					? `Story card ${spineIndex < 0 ? 'off the spine' : spineIndex + 1}, ${card.title}${card.benched ? ', benched' : ''}`
					: `Story card ${index + 1}, awaiting draft`
			};
		});
		if (asm) return [...sceneNodesFor(project, asm.assembly_id), ...storyNodes];
		// The seed and voices are project-level: they live on Main, not on every scene's canvas.
		if (activeGroup !== MAIN_GROUP && project.production.cards.length > 0) return storyNodes;
		return [seedNode, ...voiceNodes, ...storyNodes];
	}

	// --- Assemblies: scenes dropped on their own canvas, one big node each; reading order of the nodes is the scene order.
	const SCENE_NODE = 'scene:';
	function sceneNodesFor(project: Project, assemblyId: string): Node[] {
		const assembly = (project.production.assemblies ?? []).find((a) => a.assembly_id === assemblyId);
		if (!assembly) return [];
		return assembly.scenes.flatMap((place) => {
			const group = (project.production.groups ?? []).find((g) => g.group_id === place.group_id);
			if (!group) return [];
			const shots = sceneShots(project.production, group.group_id);
			const pickOf = (card: (typeof shots)[number]) => {
				const pick = pickFor(project.production, card);
				return pick ? takesFor(project.production, card.card_id, true).find((take) => take.asset_id === pick.asset_id) ?? null : null;
			};
			const seconds = shots.filter((card) => !card.benched).reduce((sum, card) => {
				const take = pickOf(card);
				const full = take?.duration_s ?? card.duration_ms / 1000;
				return sum + Math.max(0, (take?.out_s ?? full) - (take?.in_s ?? 0));
			}, 0);
			const glimpses = sceneGlimpse(shots.filter((card) => !card.benched), 4).map((card) => {
				const take = pickOf(card);
				return { card_id: card.card_id, title: card.title, kind: take ? (take.kind === 'video' ? 'video' as const : take.kind === 'image' ? 'image' as const : null) : null, url: take?.url ?? null, in_s: take?.in_s ?? null, out_s: take?.out_s ?? null };
			});
			return [{
				id: `${SCENE_NODE}${group.group_id}`,
				type: 'scene',
				position: { x: place.x, y: place.y },
				data: {
					name: group.name, shots: shots.length, benched: shots.filter((card) => card.benched).length, seconds, glimpses,
					onRemove: () => saveAssemblyScenes(assembly.scenes.filter((s) => s.group_id !== group.group_id)),
					onOpen: () => { const from = activeGroup; showGroup(group.group_id); cameFrom = from; }
				},
				ariaLabel: `Scene ${group.name}`
			} satisfies Node];
		});
	}
	function saveAssemblyScenes(scenes: Array<{ group_id: string; x: number; y: number }>) {
		if (!activeAssembly) return;
		sendBoardCommand({ command: 'update_assembly', assembly_id: activeAssembly.assembly_id, scenes });
	}
	/** Where the scene nodes sit now: their places, in reading order. */
	function placedScenes(): Array<{ group_id: string; x: number; y: number }> {
		const placed = nodes.filter((node) => node.id.startsWith(SCENE_NODE)).map((node) => ({ id: node.id.slice(SCENE_NODE.length), x: Math.round(node.position.x), y: Math.round(node.position.y) }));
		return readingOrder(placed).map(({ id, x, y }) => ({ group_id: id, x, y }));
	}
	/** Where the single shots sit on the open assembly now. */
	function placedShots(): Array<{ card_id: string; x: number; y: number }> {
		const ids = new Set((activeAssembly?.shots ?? []).map((s) => s.card_id));
		return nodes.filter((node) => ids.has(node.id)).map((node) => ({ card_id: node.id, x: Math.round(node.position.x), y: Math.round(node.position.y) }));
	}
	/**
	 * Add shots to an assembly by reference (they stay in their scenes), in a row under what is already there,
	 * in the order given. Shots already in it are skipped.
	 */
	function addShotsToAssembly(assemblyId: string, cardIds: string[]) {
		const project = activeProject;
		const assembly = project?.production.assemblies?.find((a) => a.assembly_id === assemblyId);
		if (!project || !assembly) return;
		const have = new Set((assembly.shots ?? []).map((s) => s.card_id));
		const adding = cardIds.filter((id) => !have.has(id));
		if (!adding.length) { notify('Those shots are already in that assembly.'); return; }
		const bottom = Math.max(-400, ...assembly.scenes.map((s) => s.y + 260), ...(assembly.shots ?? []).map((s) => s.y + 300));
		const shots = [...(assembly.shots ?? []), ...adding.map((card_id, i) => ({ card_id, x: (i % 6) * 280, y: bottom + 100 + Math.floor(i / 6) * 330 }))];
		sendBoardCommand({ command: 'update_assembly', assembly_id: assemblyId, shots });
		notify(`${adding.length} ${adding.length === 1 ? 'shot' : 'shots'} added to ${assembly.name}. They stay in their scenes.`);
	}
	/** Take the selected scenes and shots out of the open assembly (nothing leaves its scene). */
	function removeSelectedFromAssembly() {
		if (!activeAssembly) return;
		const sceneIds = new Set(selectedItems.filter((i) => i.kind === 'scene').map((i) => i.id));
		const shotIds = new Set(selectedItems.filter((i) => i.kind === 'shot').map((i) => i.id));
		sendBoardCommand({ command: 'update_assembly', assembly_id: activeAssembly.assembly_id,
			scenes: placedScenes().filter((s) => !sceneIds.has(s.group_id)), shots: placedShots().filter((s) => !shotIds.has(s.card_id)) });
	}
	function addSceneAt(groupId: string, at: { x: number; y: number }) {
		if (!activeAssembly) return;
		if (activeAssembly.scenes.some((s) => s.group_id === groupId)) { notify('That scene is already in this assembly.'); return; }
		saveAssemblyScenes([...placedScenes(), { group_id: groupId, x: Math.round(at.x), y: Math.round(at.y) }]);
	}
	/** A new assembly holding these shots by reference, then open it. */
	function createAssemblyWith(cardIds: string[]) {
		const project = activeProject;
		if (!project || !cardIds.length) return;
		const taken = new Set((project.production.assemblies ?? []).map((a) => a.name.toLowerCase()));
		let n = (project.production.assemblies ?? []).length + 1;
		while (taken.has(`assembly ${n}`)) n++;
		const id = crypto.randomUUID();
		sendBoardCommand({ command: 'create_assembly', assembly_id: id, name: `Assembly ${n}` });
		sendBoardCommand({ command: 'update_assembly', assembly_id: id, shots: cardIds.map((card_id, i) => ({ card_id, x: (i % 6) * 280, y: Math.floor(i / 6) * 330 })) });
		showGroup(`${ASSEMBLY_VIEW}${id}`);
	}
	function createAssembly() {
		const project = activeProject;
		if (!project) return;
		const taken = new Set((project.production.assemblies ?? []).map((a) => a.name.toLowerCase()));
		let n = (project.production.assemblies ?? []).length + 1;
		while (taken.has(`assembly ${n}`)) n++;
		const id = crypto.randomUUID();
		sendBoardCommand({ command: 'create_assembly', assembly_id: id, name: `Assembly ${n}` });
		showGroup(`${ASSEMBLY_VIEW}${id}`);
	}
	let renamingAssembly = $state<{ id: string; name: string } | null>(null);
	/** The "+ Add to assembly" menu on the selection bar. */
	let addMenuOpen = $state(false);
	function renameAssembly() {
		const editing = renamingAssembly;
		renamingAssembly = null;
		const project = activeProject;
		if (!editing || !project || !editing.name.trim()) return;
		const current = (project.production.assemblies ?? []).find((a) => `${ASSEMBLY_VIEW}${a.assembly_id}` === editing.id);
		if (current && current.name !== editing.name.trim()) sendBoardCommand({ command: 'update_assembly', assembly_id: current.assembly_id, name: editing.name.trim() });
	}
	function removeAssembly(viewId: string) {
		if (viewId === activeGroup) showGroup(MAIN_GROUP);
		sendBoardCommand({ command: 'remove_assembly', assembly_id: viewId.slice(ASSEMBLY_VIEW.length) });
	}

	function projectToEdges(project: Project): Edge[] {
		const voiceEdges = project.voices.map((voice) => ({
			id: `${project.seed.seed_id}->${voice.voice_id}`,
			source: project.seed.seed_id,
			target: voice.voice_id
		}));
		if (project.production.cards.length === 0) {
			const placeholders = Array.from({ length: 6 }, (_, order) => `story-placeholder-${order}`);
			return [...voiceEdges, ...placeholders.map((id, index) => {
				const source = index === 0 ? project.seed.seed_id : placeholders[index - 1];
				return { id: `${source}->${id}`, source, target: id, animated: true, deletable: false };
			})];
		}
		// Spine links are the editable connectors: drag an end to rehook, drop it on empty canvas or press Delete to unhook.
		const storyEdges = linksOf(project.production).map(({ from, to }) => {
			const source = from === SEED ? project.seed.seed_id : from;
			return { id: `${source}->${to}`, type: 'spine', source, target: to, reconnectable: true, data: { spine: true } };
		});
		return [...voiceEdges.map((edge) => ({ ...edge, deletable: false })), ...storyEdges];
	}

	// --- Spine rewiring (rewire_spine): the board sends the full new link set; the server derives the order.
	const linkEnd = (nodeId: string) => (nodeId === activeProject?.seed.seed_id ? SEED : nodeId);
	const isBeat = (nodeId: string) => activeProject?.production.cards.some((card) => card.card_id === nodeId) ?? false;

	function rewire(links: SpineLink[]) {
		sendBoardCommand({ command: 'rewire_spine', links });
	}

	function wouldConnect(from: string, to: string): SpineLink[] | null {
		if (!activeProject || !isBeat(to) || (from !== SEED && !isBeat(from)) || from === to) return null;
		const links = connect(linksOf(activeProject.production), from, to);
		return deriveSpine(activeProject.production.cards, links).ok ? links : null;
	}

	function validSpineConnection(connection: { source: string; target: string }) {
		return wouldConnect(linkEnd(connection.source), connection.target) !== null;
	}

	function onSpineConnect(connection: { source: string; target: string }) {
		const links = wouldConnect(linkEnd(connection.source), connection.target);
		if (links) rewire(links);
	}

	function onSpineReconnect(oldEdge: Edge, connection: { source: string; target: string }) {
		if (!activeProject) return;
		const from = linkEnd(connection.source);
		const links = connect(disconnect(linksOf(activeProject.production), linkEnd(oldEdge.source), oldEdge.target), from, connection.target);
		if (deriveSpine(activeProject.production.cards, links).ok) rewire(links);
		else adoptProject(activeProject);
	}

	function onSpineReconnectEnd(_event: MouseEvent | TouchEvent, edge: Edge, _handle: unknown, state: { isValid: boolean | null }) {
		// Dropped on empty canvas: the connector comes off.
		if (!activeProject || state.isValid || !edge.data?.spine) return;
		rewire(disconnect(linksOf(activeProject.production), linkEnd(edge.source), edge.target));
	}

	async function beforeBoardDelete({ edges: doomed }: { nodes: Node[]; edges: Edge[] }) {
		// Only spine connectors can be deleted from the board; shots, seed and voices stay.
		const spine = doomed.filter((edge) => edge.data?.spine);
		if (spine.length === 0 || !activeProject) return false;
		rewire(spine.reduce((links, edge) => disconnect(links, linkEnd(edge.source), edge.target), linksOf(activeProject.production)));
		return { nodes: [], edges: spine };
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
		// Keep what's selected on the board across project updates (polling, saves).
		const keep = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
		nodes = projectToNodes(project, nextLayout).map((node) => (keep.has(node.id) ? { ...node, selected: true } : node));
		const shown = new Set(nodes.map((node) => node.id));
		edges = projectToEdges(project).filter((edge) => shown.has(edge.source) && shown.has(edge.target));
		syncPolling(project);
	}

	// Take commands (set_pick / reject_take / restore_take) run one at a time, each
	// against the latest version. Cycling shows the new pick at once and sends only
	// where the operator stops (pendingPicks), so a burst of clicks is one command.
	let takeQueue: Promise<void> = Promise.resolve();
	const pendingPicks = new Map<string, { takeId: string; timer: ReturnType<typeof setTimeout> }>();

	function withPendingPicks(project: Project): Project {
		if (pendingPicks.size === 0) return project;
		const cards = project.production.cards.map((card) => {
			const pending = pendingPicks.get(card.card_id);
			return pending ? { ...card, pick_take_id: pending.takeId } : card;
		});
		return { ...project, production: { ...project.production, cards } };
	}

	/** Run one board request against the latest version, after every earlier one; adopt what the server returns. */
	function enqueueBoard(send: (project: Project) => Promise<Response>, adopted?: (body: Record<string, unknown>) => void) {
		takeQueue = takeQueue.then(async () => {
			const project = activeProject;
			if (!project) return;
			try {
				type Answer = ({ ok: true; data: Project } | { ok: false; error: { message: string; code?: string } }) & Record<string, unknown>;
				let result = (await (await send(project)).json()) as Answer;
				// The project can move on underneath a request (Review Room's changes arrive on their own): read it
				// again and send once more before treating it as a failure.
				if (!result.ok && result.error.code === 'VERSION_CONFLICT') {
					const fresh = (await (await fetch(`/api/projects/${project.project_id}`)).json()) as { project?: Project };
					if (fresh.project) result = (await (await send(fresh.project)).json()) as Answer;
				}
				if (!result.ok) throw new Error(result.error.message);
				// A pick saved here that did not reach Review Room is kept and sent again with the next check.
				roomState.keepPick(result);
				adopted?.(result);
				if (activeProject?.project_id === project.project_id) adoptProject(withPendingPicks(result.data));
			} catch (e) {
				loadError = e instanceof Error ? e.message : 'Board update failed';
				await openProject(project.project_id);
			}
		});
	}

	// --- Review Room (ADR 0008): no sync button. While a connected project is open and in view, its changes are
	// read every ten seconds and on coming back to the window; reviews that could not be sent are tried again.
	const roomConnected = $derived(!!(activeProject?.series || activeProject?.review_room));
	const roomStatus = $derived(roomLine({ connected: roomConnected, lastAt: roomState.lastAt, error: roomState.error, waiting: roomState.outbox.length, now: roomState.now }));
	/**
	 * One check. It runs beside the board's own requests, never ahead of them in the queue, so a pick or a move
	 * does not wait on Review Room; a request that collides with an arriving change is sent again (enqueueBoard).
	 */
	function checkRoom() {
		if (roomState.checking) return;
		roomState.checking = true;
		void (async () => {
			const project = activeProject;
			try {
				if (!project || !(project.series || project.review_room)) return;
				const response = await fetch(`/api/projects/${project.project_id}/review-room`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'pull' }) });
				const text = await response.text();
				let body: { ok?: boolean; data?: Project; changed?: string[]; error?: { message?: string } };
				try { body = JSON.parse(text); } catch { throw new Error(`HTTP ${response.status}`); }
				if (!body.ok || !body.data) throw new Error(body.error?.message ?? 'Review Room could not be read');
				if (activeProject?.project_id === project.project_id) {
					// Only a newer project is taken; one of the operator's own requests may have landed meanwhile.
					if (body.data.version > activeProject.version) adoptProject(withPendingPicks(body.data));
					roomState.mark(body.changed ?? []);
				}
				roomState.error = null;
				// Once per opened project: make sure Review Room's locked folders link back here (a no-op when they do).
				if (!linkedBack.has(project.project_id) && project.review_room) {
					linkedBack.add(project.project_id);
					void fetch(`/api/projects/${project.project_id}/review-room`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'link_back' }) })
						.then((response) => response.json())
						.then((answer: { ok?: boolean; data?: Project; pending?: string }) => {
							if (answer.pending) linkedBack.delete(project.project_id);
							if (answer.ok && answer.data && activeProject?.project_id === project.project_id && answer.data.version > activeProject.version) adoptProject(withPendingPicks(answer.data));
						})
						.catch(() => linkedBack.delete(project.project_id));
				}
				// Reviews that could not be sent earlier go out again, oldest first.
				for (const entry of [...roomState.outbox]) {
					const current = activeProject;
					if (!current || current.project_id !== project.project_id) break;
					const sent = await roomState.send(current, entry);
					if (sent.ok) adoptProject(withPendingPicks(sent.project));
					else break;
				}
			} catch (cause) {
				roomState.error = cause instanceof Error ? cause.message : 'Review Room could not be read';
			} finally {
				roomState.lastAt = Date.now();
				roomState.checking = false;
			}
		})();
	}
	/** Projects whose link back has been checked in this session. */
	const linkedBack = new Set<string>();
	/** Changes only when another project is opened, so the check below is not restarted by every update of this one. */
	const roomProjectId = $derived(activeProject?.project_id ?? '');
	$effect(() => {
		if (!roomProjectId || !roomConnected) return;
		untrack(() => roomState.reset());
		const tick = (focused = false) => {
			roomState.now = Date.now();
			if (due({ connected: true, visible: document.visibilityState === 'visible', checking: roomState.checking, lastAt: roomState.lastAt, now: roomState.now, focused })) checkRoom();
		};
		const timer = setInterval(() => tick(), 1000);
		const back = () => tick(true);
		window.addEventListener('focus', back);
		document.addEventListener('visibilitychange', back);
		untrack(() => tick());
		return () => { clearInterval(timer); window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back); };
	});

	function sendBoardCommand(body: Record<string, unknown>) {
		for (const [cardId, pending] of pendingPicks) if (cardId !== body.card_id) flushPick(cardId, pending);
		enqueueBoard((project) => fetch(`/api/projects/${project.project_id}/board`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...body, expected_version: project.version })
		}));
	}

	// --- Animate: the panel for one shot, and polling while any generation is still running.
	let animateCardId = $state<string | null>(null);

	// --- Board groups (V1S-131): which set of shots the board shows (remembered per project).
	let activeGroup = $state<string>(MAIN_GROUP);
	const activeAssembly = $derived(activeProject && isAssemblyView(activeGroup) ? (activeProject.production.assemblies ?? []).find((a) => `${ASSEMBLY_VIEW}${a.assembly_id}` === activeGroup) ?? null : null);
	/** Selected scene nodes in reading order, and the shots they play (story order within, benched skipped). */
	/** Selected assembly items (scenes and single shots) in reading order. */
	const selectedItems = $derived<AssemblyItem[]>(activeAssembly ? readingOrder(nodes.filter((node) => node.selected && (node.id.startsWith(SCENE_NODE) || node.type === 'story_card')).map((node) => ({ id: node.id, x: node.position.x, y: node.position.y })))
		.map(({ id }) => (id.startsWith(SCENE_NODE) ? { kind: 'scene' as const, id: id.slice(SCENE_NODE.length) } : { kind: 'shot' as const, id })) : []);
	const selectedSceneShots = $derived(activeProject ? assemblyPlay(activeProject.production, selectedItems) : []);
	let newGroupName = $state<string | null>(null);
	let groupInput = $state<HTMLInputElement>();
	// Focus the name box as soon as it opens, so typing goes straight in.
	$effect(() => { if (newGroupName !== null) groupInput?.focus(); });
	let splittingTake = $state<string | null>(null);
	const groupKey = (projectId: string) => `csp.board-group.${projectId}`;
	let groupLoadedFor = '';
	$effect(() => {
		const project = activeProject;
		if (!project || groupLoadedFor === project.project_id) return;
		groupLoadedFor = project.project_id;
		let saved: string | null = null;
		try { saved = localStorage.getItem(groupKey(project.project_id)); } catch { /* private mode */ }
		const known = [...groupsOf(project.production), ...cutViews(project.production), ...assemblyViews(project.production)].some((g) => g.group_id === saved);
		if (known && saved !== activeGroup) { activeGroup = saved!; adoptProject(project); fitRequest = `${project.project_id}:${saved}`; }
	});

	/** The assembly a scene was opened from (double-click on its node), for ← back; any other switch forgets it. */
	let cameFrom = $state<string | null>(null);
	function showGroup(groupId: string) {
		cameFrom = null;
		activeGroup = groupId;
		try { if (activeProject) localStorage.setItem(groupKey(activeProject.project_id), groupId); } catch { /* private mode */ }
		selectedNodeId = null;
		if (activeProject) { adoptProject(activeProject); fitRequest = `${activeProject.project_id}:${groupId}`; }
	}

	// Shots picked on the board (click, or drag a box over several), in reading order.
	// Dragging empty canvas draws the selection box; Space-drag, a middle/right drag or a two-finger scroll pans,
	// and a pinch (or ⌘/Ctrl + scroll) zooms.
	const selectedBeats = $derived(readingOrder(nodes.filter((node) => node.selected && isBeat(node.id)).map((node) => ({ id: node.id, x: node.position.x, y: node.position.y }))).map((item) => item.id));
	const beatTitle = (cardId: string) => activeProject?.production.cards.find((card) => card.card_id === cardId)?.title ?? 'the shot';
	const groupName = (groupId: string) => (activeProject ? groupsOf(activeProject.production).find((g) => g.group_id === groupId)?.name : null) ?? 'that group';
	const beatsLabel = (ids: string[]) => (ids.length === 1 ? beatTitle(ids[0]) : `${ids.length} beats`);

	function clearSelection() {
		nodes = nodes.map((node) => (node.selected ? { ...node, selected: false } : node));
		selectedNodeId = null;
	}

	/** A new group; with shots selected, they move into it (it's how a row becomes "Teaser 20s"). */
	function createGroup() {
		const name = newGroupName?.trim();
		if (!name) return;
		const groupId = crypto.randomUUID();
		const moving = [...selectedBeats];
		newGroupName = null;
		sendBoardCommand({ command: 'create_group', group_id: groupId, name });
		if (moving.length) {
			sendBoardCommand({ command: 'move_beats', group_id: groupId, card_ids: moving });
			notify(`Made ${name} with ${beatsLabel(moving)}. Pick it under Groups to see them.`);
			clearSelection();
		}
	}

	/** G on the canvas: the boxed shots become a new group named "Group N", with no dialog (rename it in the groups list). */
	function groupBoxed() {
		if (!activeProject || !selectedBeats.length) return;
		const name = nextGroupName(activeProject.production);
		const groupId = crypto.randomUUID();
		const moving = [...selectedBeats];
		sendBoardCommand({ command: 'create_group', group_id: groupId, name });
		sendBoardCommand({ command: 'move_beats', group_id: groupId, card_ids: moving });
		notify(`Made ${name} with ${beatsLabel(moving)}.`);
		clearSelection();
	}
	function canvasKey(event: KeyboardEvent) {
		if (!canvasOpen || (event.key !== 'g' && event.key !== 'G') || event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
		if (!selectedBeats.length) return;
		event.preventDefault();
		groupBoxed();
	}

	/** What the one drop resolver needs to know about this project (domain/drops). */
	const dropContext = $derived<DropContext>({
		groupOf: (cardId) => { const card = activeProject?.production.cards.find((entry) => entry.card_id === cardId); return card ? groupOf(card) : null; },
		playable: (cardId) => { const card = activeProject?.production.cards.find((entry) => entry.card_id === cardId); return !!activeProject && !!card && !!playItemFor(activeProject, card); }
	});
	/** The one shot boxed on the canvas, for the dock's Details tab. */
	const briefCard = $derived(canvasOpen && selectedBeats.length === 1 ? (activeProject?.production.cards.find((card) => card.card_id === selectedBeats[0]) ?? null) : null);

	function moveSelectedTo(groupId: string, ids: string[] = selectedBeats) {
		const moving = ids.filter((id) => { const card = activeProject?.production.cards.find((c) => c.card_id === id); return card && groupOf(card) !== groupId; });
		if (!moving.length) return;
		sendBoardCommand({ command: 'move_beats', group_id: groupId, card_ids: moving });
		notify(`Moved ${beatsLabel(moving)} to ${groupName(groupId)}.`);
		clearSelection();
	}

	// Drag shots from the board onto a group in the left panel to move them there. The cards go
	// back to where the drag started, so they keep their place on the board inside the new group.
	let dragStart = new Map<string, { x: number; y: number }>();
	let dropGroup = $state<string | null>(null);
	let draggingBeats = $state(false);
	// The board pans on its own when a dragged card nears its edge; heading left into the panel
	// (to drop on a group) it would keep scrolling, so auto-pan pauses there.
	let autoPanDrag = $state(true);
	let dragViewport: typeof viewport | null = null;
	function groupUnder(event: MouseEvent | TouchEvent): string | null {
		const point = 'changedTouches' in event ? (event.changedTouches[0] ?? event.touches[0]) : event;
		if (!point) return null;
		const row = document.elementFromPoint(point.clientX, point.clientY)?.closest<HTMLElement>('[data-group-id]');
		const groupId = row?.dataset.groupId ?? null;
		return groupId && groupId !== activeGroup ? groupId : null;
	}
	function onNodeDragStart({ nodes: dragged }: { nodes: Node[] }) {
		dragStart = new Map(dragged.map((node) => [node.id, { ...node.position }]));
		draggingBeats = dragged.some((node) => isBeat(node.id));
		dragViewport = { ...viewport };
	}
	function onNodeDrag({ event }: { event: MouseEvent | TouchEvent }) {
		if (!draggingBeats) return;
		dropGroup = groupUnder(event);
		const point = 'changedTouches' in event ? (event.changedTouches[0] ?? event.touches[0]) : event;
		const board = (event.target as Element | null)?.closest?.('.svelte-flow') ?? document.querySelector('.svelte-flow');
		const left = board?.getBoundingClientRect().left ?? 0;
		autoPanDrag = !(point && canvasOpen && !railCollapsed && point.clientX < left + 48);
	}
	function onNodeDragStop({ nodes: dragged, event }: { nodes: Node[]; event: MouseEvent | TouchEvent }) {
		// Dropping on a group moves shots home; never from an assembly, where shots are only placed by reference.
		const target = draggingBeats && !activeAssembly ? groupUnder(event) : null;
		dropGroup = null;
		draggingBeats = false;
		autoPanDrag = true;
		if (target && dragViewport) viewport = dragViewport;
		dragViewport = null;
		const beats = dragged.filter((node) => isBeat(node.id)).map((node) => node.id);
		if (target && beats.length) {
			nodes = nodes.map((node) => { const from = dragStart.get(node.id); return from ? { ...node, position: from } : node; });
			// The same rule as everywhere else: a shot dropped on a scene moves there.
			const meaning = dropMeaning({ kind: 'shots', cardIds: beats }, { kind: 'group', groupId: target }, dropContext);
			if (meaning.kind === 'move') {
				const moving = new Set(meaning.cardIds);
				moveSelectedTo(meaning.groupId, readingOrder(dragged.filter((node) => moving.has(node.id)).map((node) => ({ id: node.id, ...(dragStart.get(node.id) ?? node.position) }))).map((item) => item.id));
			} else if (meaning.kind === 'nothing') notify(meaning.why);
			return;
		}
		// An assembly keeps where its scene nodes sit (their reading order is the scene order).
		// An assembly keeps where its scenes and shots sit (their reading order is the play order).
		if (activeAssembly) {
			if (dragged.some((node) => node.id.startsWith(SCENE_NODE) || node.type === 'story_card')) sendBoardCommand({ command: 'update_assembly', assembly_id: activeAssembly.assembly_id, scenes: placedScenes(), shots: placedShots() });
			return;
		}
		scheduleLayoutSave();
	}

	/** Group from the selection: open the rail's name box; Enter makes the group and moves them in. */
	function groupSelection() {
		setRailCollapsed(false);
		newGroupName = '';
	}

	// Rename a group in place (double-click its name). Main keeps its name.
	let renaming = $state<{ group_id: string; name: string } | null>(null);
	function renameGroup() {
		const target = renaming;
		renaming = null;
		if (!target || !target.name.trim() || target.name.trim() === groupName(target.group_id)) return;
		sendBoardCommand({ command: 'rename_group', group_id: target.group_id, name: target.name.trim() });
	}

	/** Play the selected shots' picks in reading order; missing shots play as their text card; benched shots and stills are skipped. */
	function playSelection(ids: string[] = selectedBeats) {
		const project = activeProject;
		if (!project) return;
		const items = ids.flatMap((id) => {
			const card = project.production.cards.find((c) => c.card_id === id);
			const item = card ? playItemFor(project, card) : null;
			return item ? [item] : [];
		});
		if (!items.length) { notify('None of the selected shots has a video pick or is a missing shot to play.'); return; }
		reviewSequence.items = items;
		reviewSequence.playing = true;
	}

	/** Split a video take into shots through the splitter: a new group of shots, then show it. */
	async function splitTake(takeId: string) {
		const project = activeProject;
		if (!project || splittingTake) return;
		splittingTake = takeId;
		adoptProject(project);
		const take = project.production.assets.find((asset) => asset.asset_id === takeId);
		notify(`Splitting ${take?.name ?? 'the take'} into shots (scene detection)…`);
		try {
			const response = await fetch(`/api/projects/${project.project_id}/split`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ take_id: takeId }) });
			const result = (await response.json()) as { ok: true; data: Project; group_id: string; shots: number } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			adoptProject(result.data);
			showGroup(result.group_id);
			notify(`Split into ${result.shots} shots: a new group, one card per shot. A better take of a shot is just another take on it.`);
		} catch (cause) {
			notify(`Split failed: ${cause instanceof Error ? cause.message : 'error'}`);
		} finally {
			splittingTake = null;
			if (activeProject) adoptProject(activeProject);
		}
	}
	// Finalize: the takes in the open priced confirm, and the board banner of drafts closing within three days.
	let finalizing = $state<{ takeIds: string[]; title: string } | null>(null);
	let closingDrafts = $derived(activeProject ? draftsClosingSoon(activeProject.production, clock.now) : []);
	let bannerHiddenFor = $state<string | null>(null);
	let animatePolling = false;

	$effect(() => {
		const project = activeProject;
		if (!project || pendingGenerations(project.production).length === 0) return;
		const timer = setInterval(async () => {
			if (animatePolling || activeProject?.project_id !== project.project_id) return;
			animatePolling = true;
			try {
				const response = await fetch(`/api/projects/${project.project_id}/animate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'poll' }) });
				const result = (await response.json()) as { ok: true; data: Project } | { ok: false };
				if (result.ok && activeProject && result.data.version !== activeProject.version) {
					const landed = (result.data.production.generations ?? []).filter((generation) => generation.settled_at && !activeProject?.production.generations?.find((entry) => entry.request_id === generation.request_id)?.settled_at);
					adoptProject(withPendingPicks(result.data));
					for (const generation of landed) {
						const title = result.data.production.cards.find((card) => card.card_id === generation.card_id)?.title ?? 'a shot';
						if (generation.finalizes) {
							const take = result.data.production.assets.find((asset) => asset.asset_id === generation.finalizes);
							notify(generation.status === 'completed' ? `${title} is finalized: ${take?.name ?? 'the take'} is now 1080p.` : `Finalize on ${title} ended: ${generation.status}${generation.error ? ` (${generation.error})` : ''}. The 480p draft is unchanged.`);
							continue;
						}
						notify(generation.status === 'completed' ? `Animate finished on ${title}: it's the new pick.` : `Animate on ${title} ended: ${generation.status}${generation.error ? ` (${generation.error})` : ''}. Nothing was charged for it.`);
					}
				}
			} finally {
				animatePolling = false;
			}
		}, 10_000);
		return () => clearInterval(timer);
	});

	/** Render a Hold of the beat's still pick (local ffmpeg); it lands as the beat's new take. */
	function makeHold(cardId: string, title: string, options: { length_s: number; push_in: boolean; fade: boolean }) {
		for (const [pendingCard, pending] of pendingPicks) flushPick(pendingCard, pending);
		notify(`Rendering a ${options.length_s}s Hold of ${title}…`);
		enqueueBoard(
			(project) => fetch(`/api/projects/${project.project_id}/hold`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ expected_version: project.version, card_id: cardId, ...options })
			}),
			() => notify(`Hold ready on ${title}; the still stays a take.`)
		);
	}

	// --- Drag and drop: a file on a shot becomes its new take (and pick); on empty canvas, a new benched shot there.
	let dropNotice = $state<string | null>(null);
	let dropNoticeTimer: ReturnType<typeof setTimeout> | null = null;

	function notify(message: string) {
		dropNotice = message;
		if (dropNoticeTimer) clearTimeout(dropNoticeTimer);
		dropNoticeTimer = setTimeout(() => (dropNotice = null), 9000);
	}

	const SCENE_DRAG = 'application/x-csp-scene';
	function boardDragOver(event: DragEvent) {
		if (activeAssembly && event.dataTransfer?.types.includes(SCENE_DRAG)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; return; }
		if (!activeProject || !event.dataTransfer?.types.includes('Files')) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'copy';
	}

	function boardDrop(event: DragEvent) {
		// A scene dragged from the Groups panel onto an assembly lands as one node where it was dropped.
		if (activeAssembly && event.dataTransfer?.types.includes(SCENE_DRAG)) {
			event.preventDefault();
			const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
			addSceneAt(event.dataTransfer.getData(SCENE_DRAG), { x: (event.clientX - box.left - viewport.x) / viewport.zoom, y: (event.clientY - box.top - viewport.y) / viewport.zoom });
			return;
		}
		if (!activeProject || !event.dataTransfer?.types.includes('Files')) return;
		event.preventDefault();
		const nodeId = (event.target as Element | null)?.closest('.svelte-flow__node')?.getAttribute('data-id');
		const cardId = nodeId && activeProject.production.cards.some((card) => card.card_id === nodeId) ? nodeId : null;
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const at = { x: (event.clientX - box.left - viewport.x) / viewport.zoom, y: (event.clientY - box.top - viewport.y) / viewport.zoom };
		const space = isBoardView(activeGroup) ? MAIN_GROUP : activeGroup;
		void droppedFiles(event.dataTransfer).then((files) => {
			// The same rule as the grid: files on a shot are new takes of it, files on open space are new shots here.
			const meaning = dropMeaning({ kind: 'files', media: files.map((file) => mediaKind(file.name) ?? 'other') }, cardId ? { kind: 'shot', cardId } : { kind: 'space', groupId: space }, dropContext);
			if (meaning.kind === 'new-take') importFiles(files, { cardId: meaning.cardId });
			else if (meaning.kind === 'new-shots') importFiles(files, { at, groupId: meaning.groupId });
			else if (meaning.kind === 'nothing') notify(meaning.why);
		});
	}

	/**
	 * Files in through the board intake, one request at a time in the order given: each a new take on `cardId`,
	 * or each a new benched shot (placed from `at` on the board, in `groupId`). The Board and the Shots tab both use it.
	 */
	function importFiles(files: File[], place: { cardId?: string; at?: { x: number; y: number }; groupId?: string; unbenched?: boolean } = {}) {
		if (!activeProject || files.length === 0) return;
		for (const [cardId, pending] of pendingPicks) flushPick(cardId, pending);
		const refused = files.filter((file) => !mediaKind(file.name)).map((file) => file.name);
		const accepted = files.filter((file) => mediaKind(file.name));
		const flagged: string[] = [];
		let added = 0;
		const report = () => {
			const lines = [
				accepted.length > 1 ? `Added ${added} of ${accepted.length}` : '',
				refused.length ? `Not an image or video, left out: ${refused.join(', ')}` : '',
				flagged.length ? `Under 2K on the long edge, flagged: ${flagged.join(', ')}` : ''
			].filter(Boolean);
			if (lines.length) notify(lines.join(' · '));
		};
		if (accepted.length > 1) notify(`Adding ${accepted.length} files…`);
		accepted.forEach((file, index) => {
			const params = new URLSearchParams({ name: file.name });
			if (place.cardId) params.set('card_id', place.cardId);
			else {
				if (place.at) { params.set('x', String(Math.round(place.at.x + index * 40))); params.set('y', String(Math.round(place.at.y + index * 40))); }
				if (place.groupId) params.set('group_id', place.groupId);
				if (place.unbenched) params.set('benched', '0');
			}
			enqueueBoard(
				(project) => {
					params.set('expected_version', String(project.version));
					return fetch(`/api/projects/${project.project_id}/media?${params}`, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file });
				},
				(result) => {
					added += 1;
					const take = result.take as { under_2k?: boolean; name: string; width?: number; height?: number };
					if (take.under_2k) flagged.push(`${take.name} (${take.width}×${take.height})`);
					if (!place.cardId && place.at && layout) {
						// The server placed the new shot at the drop point; mirror it so the board doesn't jump.
						layout = { ...layout, nodes: [...layout.nodes, { node_id: String(result.beat_id), type: 'story_card', lane: 'storyboard', x: Number(params.get('x')), y: Number(params.get('y')), width: 320, height: 400 }] };
					}
					report();
				}
			);
		});
		if (accepted.length === 0) report();
	}

	/** Higgsfield renders in as new shots, one request at a time in the order given (the server downloads each). */
	function importRenders(jobIds: string[], groupId?: string, unbenched = false) {
		if (!activeProject || jobIds.length === 0) return;
		let added = 0;
		notify(`Importing ${jobIds.length} from Higgsfield…`);
		for (const jobId of jobIds) {
			enqueueBoard(
				(project) => {
					const params = new URLSearchParams({ job_id: jobId, expected_version: String(project.version) });
					if (groupId) params.set('group_id', groupId);
					if (unbenched) params.set('benched', '0');
					return fetch(`/api/projects/${project.project_id}/higgsfield?${params}`, { method: 'POST' });
				},
				() => { added += 1; notify(added === jobIds.length ? `Imported ${added} from Higgsfield as new shots` : `Importing from Higgsfield… ${added} of ${jobIds.length}`); }
			);
		}
	}

	function flushPick(cardId: string, pending: { takeId: string; timer: ReturnType<typeof setTimeout> }) {
		clearTimeout(pending.timer);
		pendingPicks.delete(cardId);
		sendBoardCommand({ command: 'set_pick', card_id: cardId, take_id: pending.takeId });
	}

	function pickTake(cardId: string, takeId: string) {
		if (!activeProject) return;
		const previous = pendingPicks.get(cardId);
		if (previous) clearTimeout(previous.timer);
		const pending = { takeId, timer: setTimeout(() => flushPick(cardId, pending), 300) };
		pendingPicks.set(cardId, pending);
		adoptProject(withPendingPicks(activeProject));
	}

	const referenceKey = (reference: ShotReference) => (reference.kind === 'series' ? `series:${reference.page_id}` : 'previous_frame');

	function setShotReferences(cardId: string, references: ShotReference[]) {
		sendBoardCommand({ command: 'set_shot_references', card_id: cardId, references });
	}

	/** V1S-328: the last frame of the previous shot's pick, taken from Review Room, as a reference of this shot. */
	function attachPreviousFrame(cardId: string) {
		enqueueBoard((project) => fetch(`/api/projects/${project.project_id}/references`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'previous_frame', card_id: cardId, expected_version: project.version })
		}));
	}

	function benchBeat(cardId: string, benched: boolean) {
		sendBoardCommand({ command: benched ? 'bench_beat' : 'unbench_beat', card_id: cardId });
	}

	/** Jump to a shot: show its group, select it, and frame it on the board. */
	function jumpToShot(cardId: string) {
		const card = activeProject?.production.cards.find((item) => item.card_id === cardId);
		if (!card) return;
		openWorkspace('canvas');
		if (groupOf(card) !== activeGroup) showGroup(groupOf(card));
		fitRequest = null;
		nodes = nodes.map((node) => (node.id === cardId ? { ...node, selected: true } : node.selected ? { ...node, selected: false } : node));
		selectedNodeId = cardId;
		focusRequest = cardId;
	}

	/** The Bin tile's picture: the shot's pick, or nothing yet. */
	function binMedia(card: Parameters<typeof pickFor>[1]): { kind: 'image' | 'video'; url: string } | null {
		const pick = activeProject ? pickFor(activeProject.production, card) : null;
		return pick && pick.url ? { kind: pick.kind === 'video' ? 'video' : 'image', url: pick.url } : null;
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
			const switching = activeProject?.project_id !== projectId;
			if (switching) ui.storyLevel = null;
			adoptProject(body.project, body.layout);
			viewport = body.layout?.viewport ?? { x: 0, y: 0, zoom: 1 };
			// A project (or group, in showGroup) that just opened is centered on its shots; a reload keeps the view.
			if (switching) fitRequest = projectId;
			selectedNodeId = null;
			loadError = null;
			seedError = null;
			roomError = null;
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Project read failed';
		}
	}

	/** Archived projects stay out of the picker unless "Show archived" is on (V1S-496); the open one always shows. */
	let showArchived = $state(false);
	const SHOW_ARCHIVED = '__show_archived__';
	/** Archive / unarchive live in the picker's menu, away from the version label (clicked by accident there). */
	const ARCHIVE_OPEN = '__archive_open__';
	const archivedCount = $derived(projects.filter((project) => project.archived_at).length);
	const projectOptions = $derived([
		...projects
			.filter((project) => !project.archived_at || showArchived || project.project_id === activeProject?.project_id)
			.map((project) => ({ value: project.project_id, label: project.title, hint: project.archived_at ? 'archived' : new Date(project.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) })),
		...(archivedCount ? [{ value: SHOW_ARCHIVED, label: showArchived ? 'Hide archived projects' : `Show archived projects (${archivedCount})`, hint: '' }] : []),
		...(activeProject ? [{ value: ARCHIVE_OPEN, label: activeProject.archived_at ? `Unarchive “${activeProject.title}”` : `Archive “${activeProject.title}”…`, hint: activeProject.archived_at ? 'back to the list' : 'nothing is deleted' }] : [])
	]);
	/** Bumped after a menu action so the picker shows the open project again, not the action it ran. */
	let pickKey = $state(0);
	function pickProject(id: string) {
		if (id === SHOW_ARCHIVED) { showArchived = !showArchived; pickKey += 1; return; }
		if (id === ARCHIVE_OPEN) { pickKey += 1; if (!archiving) void setArchived(!activeProject?.archived_at); return; }
		void switchProject(id);
	}
	let archiving = $state(false);
	async function setArchived(archived: boolean) {
		if (!activeProject || archiving) return;
		if (archived && !confirm(`Archive “${activeProject.title}”? It leaves the project list for everyone. Nothing is deleted, and you can unarchive it from “Show archived projects”.`)) return;
		archiving = true;
		try {
			const response = await fetch(`/api/projects/${activeProject.project_id}/archive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived, expected_version: activeProject.version }) });
			const body = await response.json();
			if (!body.ok) throw new Error(body.error?.message ?? 'Could not change the archive');
			activeProject = body.data;
			await loadProjects();
			notify(archived ? 'Archived. It now shows only under “Show archived projects”.' : 'Unarchived. It is back in the project list.');
		} catch (e) { notify(e instanceof Error ? e.message : 'Could not change the archive'); }
		finally { archiving = false; }
	}

	/** Open another project from the picker, and keep the address (?project=) pointing at it. */
	async function switchProject(projectId: string) {
		await openProject(projectId);
		const url = new URL(location.href);
		url.searchParams.set('project', projectId);
		replaceState(url, page.state);
		void loadProjects();
	}

	// ---- Publish: a read-only copy of the open project for the public watch pages ----
	let publishOpen = $state(false);
	let publishing = $state(false);
	let publishPrompts = $state(false);
	let publishResult = $state<{ url: string; beats: number; cuts: number; copied: number; missing: string[] } | null>(null);
	let publishError = $state<string | null>(null);

	async function publishProject() {
		if (!activeProject) return;
		publishing = true; publishError = null;
		try {
			const response = await fetch(`/api/projects/${activeProject.project_id}/publish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ show_prompts: publishPrompts }) });
			const body = (await response.json()) as { ok: true; data: NonNullable<typeof publishResult> } | { ok: false; error: { message: string } };
			if (!body.ok) throw new Error(body.error.message);
			publishResult = body.data;
		} catch (cause) { publishError = cause instanceof Error ? cause.message : 'Publish failed'; }
		finally { publishing = false; }
	}

	async function createProject() {
		newProjectOpen = true;
	}
	let newProjectOpen = $state(false);

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
		// A cut view lays shots out in play order for the moment; their places in their own groups stay as saved.
		if (!activeProject || isBoardView(activeGroup)) return;
		savingLayout = true;
		try {
			const next: CanvasLayout = {
				schema_version: 1,
				project_id: activeProject.project_id,
				// The board shows one group at a time: keep the saved places of shots in other groups.
				nodes: [...(layout?.nodes ?? []).filter((p) => !nodes.some((n) => n.id === p.node_id) && activeProject!.production.cards.some((card) => card.card_id === p.node_id)), ...nodes.filter((n) => !n.id.startsWith('story-placeholder-')).map((n) => {
					const previous = layout?.nodes.find((p) => p.node_id === n.id);
					const type: CanvasLayout['nodes'][number]['type'] = n.type === 'voice' ? 'voice' : n.type === 'story_card' ? 'story_card' : 'seed';
					return {
						node_id: n.id,
						type,
						lane: previous?.lane ?? (type === 'voice' ? 'voices' : type === 'story_card' ? 'storyboard' : 'seeds'),
						x: n.position.x,
						y: n.position.y,
						width: previous?.width ?? 320,
						height: previous?.height ?? (type === 'voice' ? 280 : 400)
					};
				})],
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
		const restored = restoreTab(savedWorkspace);
		if (restored) {
			openWorkspace(restored);
		}
		// The Agent sits in the dock; on a narrow screen it starts closed so it does not cover the work.
		ui.chatMode = 'dock';
		ui.chatOpen = localStorage.getItem('csp.agent-open') !== '0' && window.innerWidth >= 1024;
		agentRestored = true;
		ui.activeProjectUpdater = (project) => adoptProject(project, layout);
		ui.pageActions = [
			{ id: 'new-project', label: 'new project', hint: 'seed · s0', run: () => void createProject() },
			{ id: 'toggle-inspector', label: 'toggle inspector', hint: 'panel', run: () => (inspectorOpen = !inspectorOpen) }
		];
		void loadProjects().then(() => {
			// ?project=<id> opens that project (the Series page links imported episodes this way); else the newest.
			const params = new URLSearchParams(location.search);
			const wanted = params.get('project');
			// Links may name a view by an earlier name ("board" is the canvas).
			const tab = restoreTab(params.get('tab'));
			if (tab) openWorkspace(tab);
			// A link may open an archived project; the default is the newest one that isn't archived.
			const newest = projects.find((p) => !p.archived_at) ?? projects[0];
			if (projects.length > 0) void openProject(wanted && projects.some((p) => p.project_id === wanted) ? wanted : newest.project_id);
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

{#if newProjectOpen}<NewProjectFlow onClose={() => newProjectOpen = false} onCreated={async (id) => { await loadProjects(); await switchProject(id); openWorkspace('story'); newProjectOpen = false; }} />{/if}

<svelte:head><title>{activeProject ? `${activeProject.title} — Creative Studio Pro` : 'Creative Studio Pro'}</title></svelte:head>
<svelte:window onkeydown={canvasKey} />

<div class="grid h-full min-w-0 overflow-x-hidden bg-ground" style="grid-template-rows: auto minmax(0,1fr) 24px">
	<!-- The top bar (34px, wrapping on a narrow screen): the project, the four stages, the views of the open stage, then the Agent and the menu. It never clips, so its menus can hang below it. -->
	<div class="topbar relative z-40 flex min-h-[34px] min-w-0 flex-wrap items-center gap-x-3.5 gap-y-0.5 px-3">
		<span class="wordmark cp shrink-0" aria-label="Creative Studio Pro">Studio</span>
		{#if projects.length}
			<!-- Every project, newest first: the way back to any of them (the trailer, an imported episode…). -->
			<span class="project-pick w-[170px] shrink-0 max-w-[300px] sm:w-auto sm:min-w-0 sm:shrink" title={activeProject?.title}>
				{#key pickKey}<Pick label="Open a project" value={activeProject?.project_id} options={projectOptions} wide onchange={pickProject} />{/key}
			</span>
		{:else}
			<b class="project-name min-w-0 max-w-[260px] truncate">No project open</b>
		{/if}
		{#if activeProject?.archived_at}
			<span class="cp shrink-0 text-amber" title="Archived {new Date(activeProject.archived_at).toLocaleDateString()}. Unarchive it from the project menu.">archived</span>
		{/if}
		<nav class="mx-auto flex shrink-0 items-center gap-px" aria-label="Stages">
			{#each STAGES as stage (stage.id)}
				<button type="button" class="stage" aria-current={currentStage === stage.id ? 'page' : undefined} onclick={() => openStage(stage.id)}>{stage.label}</button>
			{/each}
		</nav>
		{#if stageViews.length > 1}
			<span class="flex shrink-0 items-center gap-px" role="group" aria-label="View">
				{#each stageViews as view (view.tab)}
					<button type="button" class="tg" aria-pressed={currentTab === view.tab} onclick={() => openWorkspace(view.tab)}>{view.label}</button>
				{/each}
			</span>
		{/if}
		<span class="cp hidden shrink-0 text-ink-3 lg:inline" title={roomState.error ?? (roomState.outbox[0]?.error ? `Not sent: ${roomState.outbox[0].error}` : "Every take's media is stored in Review Room. Its changes are read every ten seconds; yours are sent at once.")} aria-live="polite">Review Room <b class={['font-normal', roomStatus.tone === 'ok' ? 'text-teal' : roomStatus.tone === 'bad' ? 'text-[#ff7a6b]' : 'text-ink-3']} style="display: inline-block; min-width: 9ch;">{roomStatus.text}</b></span>
		<button type="button" class="shell-tab agent" disabled={!activeProject} aria-pressed={dockOpen} title="The Agent: your assistant for this project. It drafts the brief, shots and prompts, suggests effects, and makes judgment calls inside your rules." onclick={() => { ui.chatMode = 'dock'; ui.chatOpen = !ui.chatOpen; }}>Agent</button>
		<span class="relative shrink-0">
			<button type="button" class="tg" aria-haspopup="menu" aria-expanded={menuOpen} onclick={() => { menuOpen = !menuOpen; publishOpen = false; }}>Menu</button>
			<ProjectMenu
				bind:open={menuOpen}
				links={secondaryNav}
				version={activeProject?.version ?? null}
				hasProject={!!activeProject}
				{creating}
				refsOpen={inspectorOpen}
				onNew={() => void createProject()}
				onPublish={() => { publishOpen = true; publishResult = null; publishError = null; }}
				onRefs={() => (inspectorOpen = !inspectorOpen)}
				onStatus={() => (ui.capabilitiesOpen = true)}
			/>
			{#if publishOpen && activeProject}
				<div class="publish-pop" role="dialog" aria-label="Publish">
					<p class="publish-cap">Publish to Watch</p>
					<p class="publish-note">Visitors see a read-only copy: the story, the board with each shot's pick, and the cuts with their exported film. Publishing again replaces it.</p>
					<label class="publish-row"><span>Show the Agent's prompts</span><Toggle label="Show the Agent's prompts" bind:checked={publishPrompts} on="yes" off="no" /></label>
					{#if publishResult}
						<p class="publish-ok">Published: {publishResult.beats} shots, {publishResult.cuts} cut{publishResult.cuts === 1 ? '' : 's'}, {publishResult.copied} file{publishResult.copied === 1 ? '' : 's'}.{publishResult.missing.length ? ` ${publishResult.missing.length} file${publishResult.missing.length === 1 ? ' was' : 's were'} missing.` : ''} <a href={publishResult.url} target="_blank" rel="noreferrer">Open {publishResult.url} ↗</a></p>
					{/if}
					{#if publishError}<p class="publish-err" role="alert">{publishError}</p>{/if}
					<div class="flex justify-end gap-2">
						<button type="button" class="bar-key" onclick={() => (publishOpen = false)}>Close</button>
						<button type="button" class="bar-key agent" onclick={() => void publishProject()} disabled={publishing}>{publishing ? 'Publishing…' : publishResult ? 'Publish again' : 'Publish'}</button>
					</div>
				</div>
			{/if}
		</span>
		<button type="button" class="tg hidden shrink-0 sm:inline-flex" onclick={() => (ui.paletteOpen = true)} title="Command palette: jump to any action by typing">⌘K</button>
	</div>

	<!-- Work area: lane rail + canvas + inspector -->
	<div
		class={['work-area relative grid min-h-0 min-w-0 px-1', !railResizing && 'transition-[grid-template-columns] duration-300 ease-out']}
		style={`--inspector-width: ${inspectorOpen ? '403px' : '0px'}; --rail-width: ${canvasOpen && !railCollapsed ? `${railWidth}px` : '0px'}; --outline-width: ${canvasOpen ? '0px' : '223px'}; --dock-width: ${dockOpen ? '363px' : '0px'}`}
	>
		{#if !canvasOpen}
			<!-- The outline: the project's groups and shots. On the canvas the layers panel takes its place. -->
			<aside class="wa-outline hidden min-h-0 overflow-hidden rounded-[10px] bg-panel md:mr-[3px] md:block">
				<Outline project={activeProject} openGroupId={isBoardView(activeGroup) ? MAIN_GROUP : activeGroup} onOpenGroup={(groupId) => showGroup(groupId)} onMoveShots={(groupId, cardIds) => moveSelectedTo(groupId, cardIds)} onAddFiles={(groupId, files) => importFiles(files, { groupId, unbenched: true })} level={currentTab === 'story' ? ui.storyLevel : null} onOpenLevel={(level) => { ui.storyLevel = level; openWorkspace('story'); }} />
			</aside>
		{/if}
		<aside class={['rail wa-rail relative hidden bg-panel md:flex md:flex-col', canvasOpen && !railCollapsed ? 'rounded-[10px] md:mr-[3px]' : '']} aria-label="Canvas layers" aria-hidden={!canvasOpen || railCollapsed}>
			{#if canvasOpen && !railCollapsed}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div class={['rail-resize', railResizing && 'active']} role="separator" aria-orientation="vertical" aria-label="Resize the layers panel" aria-valuemin={RAIL_MIN} aria-valuemax={RAIL_MAX} aria-valuenow={railWidth} tabindex="0" title="Drag to resize" onpointerdown={startRailResize} onkeydown={nudgeRail} ondblclick={() => { railWidth = 260; try { localStorage.setItem('csp.rail-width', '260'); } catch { /* private mode */ } }}></div>
			{/if}
			{#if canvasOpen && !railCollapsed}
			<div class="min-h-0 grow overflow-y-auto overflow-x-hidden p-3">
				<div class="meta-label">Canvas layers</div>
				<div class="mt-3 grid gap-1.5">
					<div class="layer-row"><span class="bg-voice-1"></span><b>Seed</b><small>1</small></div>
					<div class="layer-row"><span class="bg-[#4ab8ff]"></span><b>Voices</b><small>{activeProject?.voices.length ?? 0}</small></div>
					<div class="layer-row"><span class="bg-[#5cffbe]"></span><b>Shots</b><small>{activeProject?.production.cards.length || 6}</small></div>
					<div class="layer-row"><span class="bg-[#8174e8]"></span><b>Takes</b><small>{activeProject?.production.assets.length ?? 0}</small></div>
				</div>
				<p class="mt-4 font-mono text-[9px] leading-4 text-text-dim">Drag cards to arrange the production. Cycle a shot's takes; the one showing is its pick.</p>
				{#if activeProject}
					{@const groups = groupsOf(activeProject.production)}
					<div class="meta-label mt-5 flex items-center">Groups<span class="grow"></span><button type="button" class="group-add" onclick={() => (newGroupName = '')} aria-label="New group">+ new</button></div>
					<ul class="mt-2 grid grid-cols-[minmax(0,1fr)] gap-px" aria-label="Board groups">
						{#each groups as group (group.group_id)}
							<li class={['group-row', group.group_id === activeGroup && 'active', draggingBeats && group.group_id !== activeGroup && 'droppable', dropGroup === group.group_id && 'drop']} data-group-id={group.group_id}>
								{#if renaming?.group_id === group.group_id}
									<!-- svelte-ignore a11y_autofocus -->
									<input class="group-name m-0" bind:value={renaming.name} aria-label={`Rename ${group.name}`} autofocus onkeydown={(event) => { if (event.key === 'Enter') renameGroup(); else if (event.key === 'Escape') renaming = null; }} onblur={renameGroup} />
								{:else}
									<button type="button" class="group-pick" draggable={group.group_id !== MAIN_GROUP && Boolean(activeAssembly)} ondragstart={(event) => { event.dataTransfer?.setData(SCENE_DRAG, group.group_id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'; }} onclick={() => showGroup(group.group_id)} ondblclick={() => { if (group.group_id !== MAIN_GROUP) renaming = { group_id: group.group_id, name: group.name }; }} aria-pressed={group.group_id === activeGroup} title={group.group_id === MAIN_GROUP ? 'Main: every shot not in a group' : 'Show this group · double-click to rename'}>
										<b class="min-w-0 grow truncate" title={group.name}>{group.name}</b>
										<small>{group.count}</small>
									</button>
								{/if}
								{#if group.count === 0 && group.group_id !== MAIN_GROUP && !selectedBeats.length}
									<button type="button" class="group-move" onclick={() => { if (activeGroup === group.group_id) showGroup(MAIN_GROUP); sendBoardCommand({ command: 'remove_group', group_id: group.group_id }); }} title="Delete this empty group" aria-label={`Delete the empty group ${group.name}`}>×</button>
								{/if}
								{#if selectedBeats.length && group.group_id !== activeGroup}
									<button type="button" class="group-move" onclick={() => moveSelectedTo(group.group_id)} title={`Move ${beatsLabel(selectedBeats)} here`} aria-label={`Move ${beatsLabel(selectedBeats)} to ${group.name}`}>→</button>
								{/if}
							</li>
						{/each}
					</ul>
					{@const assemblies = assemblyViews(activeProject.production)}
					<div class="meta-label mt-4 flex items-center">Assemblies<span class="grow"></span><button type="button" class="group-add" onclick={createAssembly} aria-label="New assembly">+ new</button></div>
					{#if assemblies.length}
						<ul class="mt-2 grid grid-cols-[minmax(0,1fr)] gap-px" aria-label="Assemblies">
							{#each assemblies as assembly (assembly.group_id)}
								<li class={['group-row', assembly.group_id === activeGroup && 'active']}>
									{#if renamingAssembly?.id === assembly.group_id}
										<!-- svelte-ignore a11y_autofocus -->
										<input class="group-name m-0" bind:value={renamingAssembly.name} aria-label={`Rename ${assembly.name}`} autofocus onkeydown={(event) => { if (event.key === 'Enter') renameAssembly(); else if (event.key === 'Escape') renamingAssembly = null; }} onblur={renameAssembly} />
									{:else}
										<button type="button" class="group-pick" onclick={() => showGroup(assembly.group_id)} ondblclick={() => (renamingAssembly = { id: assembly.group_id, name: assembly.name })} aria-pressed={assembly.group_id === activeGroup} title="Show this assembly · drag scenes from the list onto its canvas · double-click to rename">
											<b class="min-w-0 grow truncate" title={assembly.name}>▦ {assembly.name}</b>
											<small>{assembly.count}</small>
										</button>
										<button type="button" class="group-move" onclick={() => removeAssembly(assembly.group_id)} title="Delete this assembly (its scenes and shots stay)" aria-label={`Delete ${assembly.name}`}>×</button>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
					{#if activeAssembly}<p class="mt-2 font-mono text-[9px] leading-4 text-text-dim">Drag scenes from Groups onto the canvas: each lands as one node. Their reading order (rows top to bottom, left to right) is the order they play. Select scenes, then ▶ Play in order.</p>{/if}
					{@const cuts = cutViews(activeProject.production)}
					{#if cuts.length}
						<div class="meta-label mt-4">Cuts</div>
						<ul class="mt-2 grid grid-cols-[minmax(0,1fr)] gap-px" aria-label="Cuts on the board">
							{#each cuts as cut (cut.group_id)}
								<li class={['group-row', cut.group_id === activeGroup && 'active']}>
									<button type="button" class="group-pick" onclick={() => showGroup(cut.group_id)} aria-pressed={cut.group_id === activeGroup} title="Show this cut's shots in play order (each once). Select them and play in order to rework the edit; their own groups don't change.">
										<b class="min-w-0 grow truncate" title={cut.name}>✂ {cut.name}</b>
										<small>{cut.count}</small>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
					{#if newGroupName !== null}
						<input class="group-name" bind:this={groupInput} bind:value={newGroupName} placeholder={selectedBeats.length ? `Name for ${beatsLabel(selectedBeats)}` : 'Group name'} aria-label="New group name" onkeydown={(event) => { if (event.key === 'Enter') createGroup(); else if (event.key === 'Escape') newGroupName = null; }} onblur={() => (newGroupName?.trim() ? createGroup() : (newGroupName = null))} />
					{/if}
					<p class="mt-2 font-mono text-[9px] leading-4 text-text-dim">{draggingBeats ? 'Drop on a group to move the shots there.' : selectedBeats.length ? `Click → on a group to move ${beatsLabel(selectedBeats)} there, or + new to make one from them.` : 'Pick a group to show its beats. Drag a shot onto a group to move it. Drag a box over shots to select them (Space-drag or two-finger scroll pans, pinch zooms; F frames the selection), then group them. Double-click a group to rename it.'}</p>
					{@const bin = benchedBeats(activeProject.production)}
					<div class="meta-label mt-5 flex items-center">Bin<span class="grow"></span><small class="font-mono text-[10px] text-text-dim">{bin.length}</small></div>
					{#if bin.length === 0}
						<p class="mt-2 font-mono text-[9px] leading-4 text-text-dim">Benched shots land here. They keep their place and are skipped when the story plays.</p>
					{:else}
						<p class="mt-2 font-mono text-[9px] leading-4 text-text-dim">Benched shots sit out of the story. Click one to jump to it on the board; Put back makes it play in the story again.</p>
						<ul class="bin-grid mt-2" aria-label="Benched beats">
							{#each bin as card (card.card_id)}
								{@const media = binMedia(card)}
								<li class={['bin-tile', selectedNodeId === card.card_id && 'active']}>
									<button type="button" class="bin-jump" onclick={() => jumpToShot(card.card_id)} title={`${card.title} · jump to it on the board`} aria-label={`Jump to ${card.title} on the board`}>
										{#if media?.kind === 'video'}
											{@const still = posterUrl(media.url)}
											{#if still}<img src={still} alt="" loading="lazy" />{:else}<video src={`${media.url}#t=0.5`} preload="metadata" muted playsinline tabindex="-1"></video>{/if}
										{:else if media}
											<img src={media.url} alt="" loading="lazy" />
										{:else}
											<span class="bin-empty" aria-hidden="true">No take yet</span>
										{/if}
										<span class="bin-num">{String(card.order + 1).padStart(2, '0')}</span>
										<span class="bin-title">{card.title}</span>
									</button>
									<button type="button" class="bin-back" onclick={() => benchBeat(card.card_id, false)} title="Put back: take it off the bench so it plays in the story again" aria-label={`Put ${card.title} back in the story`}>Put back</button>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>
			<button type="button" class="rail-collapse" onclick={() => setRailCollapsed(true)} title="Collapse the panel">‹ Collapse</button>
			{/if}
		</aside>
		{#if canvasOpen && railCollapsed}
			<button type="button" class="rail-handle" onclick={() => setRailCollapsed(false)} aria-label="Expand the layers panel" title="Layers, groups and bin">
				<span class="rail-handle-mark" aria-hidden="true"></span>
				<span class="rail-handle-label">Layers</span>
			</button>
		{/if}

		<main class="wa-main relative min-w-0 overflow-hidden rounded-[10px] bg-panel">
			{#if loadError}
				<div
					class="absolute inset-x-0 top-0 z-10 border-b border-[color-mix(in_srgb,var(--color-gate-failed)_55%,var(--color-border-default))] bg-surface-raised-2 px-3 py-2 text-gate-failed"
					role="alert"
				>
					{loadError}
				</div>
			{/if}
			{#if dropNotice}
				<div class="absolute inset-x-0 top-0 z-10 flex items-center gap-2 border-b border-[color-mix(in_srgb,var(--color-gate-pending)_55%,var(--color-border-default))] bg-surface-raised-2 px-3 py-2 text-gate-pending" role="status">
					<span class="grow">{dropNotice}</span>
					<button type="button" class="font-mono text-[10px] uppercase text-text-dim hover:text-text-muted" onclick={() => (dropNotice = null)}>Dismiss</button>
				</div>
			{/if}

			{#if activeProject && canvasOpen}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="relative h-full" ondragover={boardDragOver} ondrop={boardDrop}>
					<SvelteFlow
						bind:nodes
						bind:edges
						bind:viewport
						{nodeTypes}
						{edgeTypes}
						minZoom={0.25}
						maxZoom={4}
						fitView={false}
						nodesConnectable={(activeProject?.production.cards.length ?? 0) > 0}
						isValidConnection={validSpineConnection}
						onconnect={onSpineConnect}
						onreconnect={onSpineReconnect}
						onreconnectend={onSpineReconnectEnd}
						onbeforedelete={beforeBoardDelete}
						selectionKey="Shift"
						selectionOnDrag
						selectionMode={SelectionMode.Partial}
						panOnDrag={[1, 2]}
						panOnScroll
						panActivationKey="Space"
						onnodeclick={({ node }) => (selectedNodeId = node.id)}
						autoPanOnNodeDrag={autoPanDrag}
						onnodedragstart={onNodeDragStart}
						onnodedrag={onNodeDrag}
						onnodedragstop={onNodeDragStop}
						onmoveend={scheduleLayoutSave}
					>
						<Background
							variant={BackgroundVariant.Dots}
							gap={22}
							size={1.4}
							patternColor="#3a3a40"
						/>
						<Controls showLock={false} position="bottom-left" />
						<FitOnOpen request={fitRequest} focus={focusRequest} done={() => { fitRequest = null; focusRequest = null; }} />
						<FrameKey />
					</SvelteFlow>
					{#if cameFrom && activeProject}
						{@const backTo = assemblyViews(activeProject.production).find((a) => a.group_id === cameFrom)}
						{#if backTo}<button type="button" class="bar-key absolute left-3 top-3 z-[6]" onclick={() => showGroup(backTo.group_id)} title="Back to the assembly">← back to {backTo.name}</button>{/if}
					{/if}
					{#if activeAssembly && selectedItems.length && activeProject}
						{@const sceneCount = selectedItems.filter((i) => i.kind === 'scene').length}
						<div class="sel-bar" role="group" aria-label="Selected in the assembly">
							<span class="seq-cap">{sceneCount ? `${sceneCount} ${sceneCount === 1 ? 'scene' : 'scenes'} · ` : ''}{selectedSceneShots.length} shots</span>
							<button type="button" class="bar-key agent" onclick={() => playSelection(selectedSceneShots)} title="Play in reading order: a scene plays its shots in story order (benched skipped), a single shot plays itself">▶ Play in order</button>
							<button type="button" class="bar-key" onclick={removeSelectedFromAssembly} title="Take them out of this assembly (they stay in their scenes)">Remove from assembly</button>
							<button type="button" class="bar-key" onclick={clearSelection}>Clear</button>
						</div>
					{/if}
					{#if selectedBeats.length >= 1 && activeProject && !activeAssembly}
						{@const moveTargets = groupsOf(activeProject.production).filter((g) => g.group_id !== activeGroup)}
						{@const assemblyTargets = (activeProject.production.assemblies ?? []).map((a) => ({ value: a.assembly_id, label: a.name, hint: String((a.shots ?? []).length + a.scenes.length) }))}
						<div class="sel-bar" role="group" aria-label="Selected beats">
							<span class="seq-cap">{selectedBeats.length} {selectedBeats.length === 1 ? 'shot' : 'shots'}</span>
							{#if selectedBeats.length > 1}<button type="button" class="bar-key agent" onclick={() => playSelection()} title="Play their picks in reading order: row by row, left to right">▶ Play in order</button>{/if}
							<!-- A menu anchored under its button (the bar is centred with a transform, which threw the shared picker off-screen). -->
							<div class="asm-add" onfocusout={(event) => { if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as globalThis.Node | null)) addMenuOpen = false; }}>
								<button type="button" class="bar-key" aria-haspopup="menu" aria-expanded={addMenuOpen} onclick={() => (addMenuOpen = !addMenuOpen)} onkeydown={(event) => { if (event.key === 'Escape') addMenuOpen = false; }} title="Add the selected shots to an assembly (they stay in their scenes)">+ Add to assembly ▾</button>
								{#if addMenuOpen}
									<ul class="asm-menu" role="menu" aria-label="Add to which assembly">
										{#each assemblyTargets as target (target.value)}
											<li role="none"><button type="button" role="menuitem" onclick={() => { addMenuOpen = false; addShotsToAssembly(target.value, [...selectedBeats]); }}><span>▦ {target.label}</span><small>{target.hint}</small></button></li>
										{/each}
										<li role="none"><button type="button" role="menuitem" class="new" onclick={() => { addMenuOpen = false; createAssemblyWith([...selectedBeats]); }}>+ New assembly</button></li>
									</ul>
								{/if}
							</div>
							<button type="button" class="bar-key" onclick={groupSelection} title="Name a new group and MOVE these shots into it (they leave their current scene)">Move to new group…</button>
							{#if moveTargets.length}<Pick label="Move the selected shots to a group" placeholder="Move to…" options={moveTargets.map((g) => ({ value: g.group_id, label: g.name, hint: String(g.count) }))} onchange={(groupId) => moveSelectedTo(groupId)} />{/if}
							<button type="button" class="bar-key" onclick={clearSelection}>Clear</button>
						</div>
					{/if}
					{#if reviewSequence.items.length}
						<div class="seq-bar" role="group" aria-label="Selected sequence">
							<span class="seq-cap">Sequence</span>
							{#each reviewSequence.items as item, i (item.id)}<span class="seq-item"><b>{i + 1}</b>{item.title.split(' — ')[0]}</span>{/each}
							<button type="button" class="bar-key agent" onclick={() => (reviewSequence.playing = true)} title="Play the selected shots in order">▶ Play</button>
							<button type="button" class="bar-key" onclick={() => reviewSequence.clear()}>Clear</button>
						</div>
					{/if}
					{#if reviewSequence.playing && activeProject}<SequencePlayer project={activeProject} onUpdated={(project) => adoptProject(project, layout)} />{/if}
					{#if closingDrafts.length && bannerHiddenFor !== activeProject.project_id}
						<div class="absolute inset-x-0 top-0 z-[5] flex flex-wrap items-center gap-2 border-b border-[#6a5a26] bg-[#17140a]/95 px-3 py-1.5 font-mono text-[10px] text-[#f2c14e]" role="status" aria-label="Drafts closing soon">
							<span class="font-bold uppercase">{closingDrafts.length} {closingDrafts.length === 1 ? 'draft closes' : 'drafts close'} within 3 days</span>
							{#each closingDrafts.slice(0, 6) as entry (entry.take.asset_id)}
								{@const beatTitle = activeProject.production.cards.find((card) => card.card_id === entry.take.card_id)?.title ?? entry.take.name}
								<button type="button" class={['border px-1.5 py-0.5', entry.ms_left <= CLOSING_MS ? 'border-[#6b3a3a] text-[#ff7b7b]' : 'border-[#6a5a26]']} onclick={() => (finalizing = { takeIds: [entry.take.asset_id], title: beatTitle })} title={`Finalize ${entry.take.name} to 1080p`}>{beatTitle.split(' — ')[0]} · {timeLeft(entry.ms_left)}</button>
							{/each}
							{#if closingDrafts.length > 6}<span>+{closingDrafts.length - 6} more</span>{/if}
							<span class="grow"></span>
							<button type="button" class="bg-[#f2c14e] px-2 py-0.5 font-bold text-black" onclick={() => (finalizing = { takeIds: closingDrafts.map((entry) => entry.take.asset_id), title: `${closingDrafts.length} drafts closing soon` })}>Finalize all…</button>
							<button type="button" class="px-1 text-[#8a7a46] hover:text-[#f2c14e]" onclick={() => (bannerHiddenFor = activeProject?.project_id ?? null)}>hide</button>
						</div>
					{/if}
					{#if finalizing && activeProject}<FinalizePanel project={activeProject} takeIds={finalizing.takeIds} title={finalizing.title} onUpdated={(project) => adoptProject(project, layout)} onclose={() => (finalizing = null)} onsent={notify} />{/if}
					{#if animateCardId && activeProject}<AnimatePanel project={activeProject} cardId={animateCardId} onUpdated={(project) => adoptProject(withPendingPicks(project), layout)} onclose={() => (animateCardId = null)} onsent={notify} />{/if}
				</div>
			{:else if activeProject}
				<ProductionWorkspace project={activeProject} onUpdated={(project) => adoptProject(project, layout)} onAddFiles={(files, place) => importFiles(files, place?.cardId ? { cardId: place.cardId } : { unbenched: true })} onImportRenders={(jobIds) => importRenders(jobIds, undefined, true)} onOpenBoard={(groupId) => { if (groupId) showGroup(groupId); openWorkspace('canvas'); }} bind:tab={productionTab} {detailsHost} onOpenDetails={() => { dockTab = 'details'; /* Below 1024px the dock lies over the work, so it is not opened for the viewer. */ if (window.matchMedia('(min-width: 1024px)').matches) { ui.chatMode = 'dock'; ui.chatOpen = true; } }} />
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
				'wa-inspector overflow-hidden rounded-[10px] bg-panel',
				inspectorOpen
					? 'fixed bottom-[24px] right-0 top-[62px] z-30 block w-[min(92vw,420px)] lg:static lg:ml-[3px] lg:w-auto'
					: 'hidden'
			]}
			aria-label="Inspector"
			aria-hidden={!inspectorOpen}
		>
			<div class="h-full w-[min(92vw,400px)] overflow-y-auto p-3">
				{#if activeProject?.series}
					<ReferencesDrawer
						seriesId={activeProject.series.series_id}
						references={drawerRefs}
						files={seriesRefFiles}
						selectedTitle={selectedCard?.title ?? null}
						onAttach={(pageId) => selectedCard && setShotReferences(selectedCard.card_id, [...(selectedCard.references ?? []).filter((reference) => reference.kind === 'series'), { kind: 'series', page_id: pageId }, ...(selectedCard.references ?? []).filter((reference) => reference.kind !== 'series')])}
						onUploaded={() => activeProject?.series && loadSeriesRefs(activeProject.series.series_id)}
					/>
				{:else if activeProject}
					<ReferencesDrawer seriesId={null} references={prepRefs} files={{}} />
				{/if}
				{#if activeProject}
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
		{#if dockOpen}
			<!-- The Agent, docked beside the work; below 1024px it lies over it. -->
			<aside class="wa-dock min-h-0 max-lg:contents lg:ml-[3px] lg:flex lg:flex-col lg:overflow-hidden lg:rounded-[10px] lg:bg-panel" aria-label="Agent and details">
				<div class="flex shrink-0 items-center gap-px px-1.5 pt-1.5 max-lg:hidden" role="group" aria-label="Dock">
					<button type="button" class="shell-tab agent" aria-pressed={dockTab === 'agent'} onclick={() => (dockTab = 'agent')}>Agent</button>
					<button type="button" class="tg" aria-pressed={dockTab === 'details'} onclick={() => (dockTab = 'details')}>Details</button>
				</div>
				<div class={dockTab === 'agent' ? 'min-h-0 max-lg:contents lg:grow' : 'lg:hidden max-lg:contents'}>
					<AgentChat bind:open={ui.chatOpen} projectTitle={ui.activeProjectTitle} project={activeProject} />
				</div>
				<!-- The selected shot's details are drawn here by the Shots workspace. -->
				<div bind:this={detailsHost} class={['min-h-0 grow overflow-y-auto max-lg:hidden', dockTab !== 'details' && 'hidden']}>
					{#if canvasOpen && activeProject}<ShotBrief project={activeProject} card={briefCard} code={briefCard ? (activeProject.review_room?.shots[briefCard.card_id]?.code ?? null) : null} onUpdated={(project) => adoptProject(project, layout)} />{/if}
				</div>
			</aside>
		{/if}
	</div>

	<!-- The Next line (24px): what is waiting on the operator. Stages and gates stay with their runs. -->
	<footer class="cp flex min-w-0 items-center gap-4 overflow-hidden px-3.5 text-ink-3">
		<span class="min-w-0 truncate"><b class="font-normal text-ink-2">Next</b> · {next}</span>
		{#if activeProject?.creative_room}
			<span class="hidden shrink-0 sm:inline">
				Room {activeProject.creative_room.status}
				{#if activeProject.voices.length > 0}
					· {activeProject.voices.filter((v) => v.raw_text).length}/{activeProject.voices.length} replies
				{/if}
			</span>
		{/if}
		<span class="grow"></span>
		<span aria-live="polite" class={['hidden shrink-0 transition-opacity sm:inline', savingLayout ? 'opacity-100' : 'opacity-0']}>Saving canvas…</span>
	</footer>
</div>

<style>
	/* A shot on the board shows an arrow (click to select, drag to move); the closed hand only while it moves. */
	:global(.svelte-flow .svelte-flow__node.draggable) { cursor: default; }
	:global(.svelte-flow .svelte-flow__node.draggable.dragging) { cursor: grabbing; }
	.layer-row { display: grid; grid-template-columns: 6px 1fr auto; align-items: center; gap: 8px; padding: 6px 7px; background: #151519; color: #8d9ca1; }
	.layer-row > span { width: 6px; height: 6px; }
	.layer-row b { font-size: 11px; font-weight: 500; }
	.layer-row small { font: 9px var(--font-mono); color: #626b70; }
	.wordmark { color: var(--color-teal); letter-spacing: 0.24em; }
	.project-name { color: #8f9ca1; font-size: 12px; font-weight: 500; }
	.bar-key { display: inline-flex; align-items: center; gap: 6px; height: 26px; border: 1px solid #262c31; border-radius: 2px; background: transparent; padding: 0 10px; color: #8a969e; font: 600 10px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; transition: border-color 140ms ease, color 140ms ease; }
	.bar-key:hover:not(:disabled) { border-color: #44505a; color: #c4d0d6; }
	.bar-key:disabled { opacity: 0.4; }
	.bar-key.agent { border-color: rgba(78, 232, 210, 0.4); color: #9eeee3; }
	.publish-pop { position: absolute; top: calc(100% + 8px); right: 0; z-index: 40; display: grid; width: min(340px, calc(100vw - 24px)); gap: 10px; border: 1px solid var(--color-nr-line); border-radius: 3px; background: var(--color-nr-deep); padding: 12px; box-shadow: 0 12px 32px rgb(0 0 0 / 0.5); }
	.publish-cap { color: var(--color-nr-accent); font: 600 10px var(--font-sans); letter-spacing: 0.16em; text-transform: uppercase; }
	.publish-note { color: var(--color-nr-muted); font-size: 12px; line-height: 1.55; }
	.publish-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--color-nr-text); font-size: 12px; }
	.publish-ok { color: var(--color-nr-text); font-size: 12px; line-height: 1.55; }
	.publish-ok a { color: var(--color-nr-accent); }
	.publish-err { color: var(--color-nr-danger-text); font-size: 12px; }
	.seq-bar { position: absolute; bottom: 12px; left: 50%; z-index: 10; display: flex; max-width: calc(100% - 120px); align-items: center; gap: 6px; transform: translateX(-50%); border: 1px solid var(--color-nr-line); border-radius: 3px; background: color-mix(in srgb, var(--color-nr-deep) 95%, transparent); padding: 5px 6px 5px 10px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.45); }
	.sel-bar { position: absolute; top: 12px; left: 50%; z-index: 10; display: flex; align-items: center; gap: 6px; transform: translateX(-50%); border: 1px solid color-mix(in srgb, var(--color-nr-accent) 35%, var(--color-nr-line)); border-radius: 3px; background: color-mix(in srgb, var(--color-nr-deep) 95%, transparent); padding: 5px 6px 5px 10px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.45); }
	.sel-bar .bar-key { height: 22px; padding: 0 8px; font-size: 9px; }
	.asm-add { position: relative; }
	.asm-menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 20; display: grid; min-width: 220px; max-height: 280px; overflow-y: auto; margin: 0; padding: 4px; list-style: none; border: 1px solid color-mix(in srgb, var(--color-nr-accent) 35%, var(--color-nr-line)); border-radius: 3px; background: var(--color-nr-deep); box-shadow: 0 10px 28px rgb(0 0 0 / 0.55); }
	.asm-menu button { display: flex; width: 100%; align-items: baseline; justify-content: space-between; gap: 12px; border: 0; border-radius: 2px; background: transparent; padding: 6px 8px; color: var(--color-nr-muted); font: 11px var(--font-sans); text-align: left; cursor: pointer; }
	.asm-menu button:hover, .asm-menu button:focus-visible { background: color-mix(in srgb, var(--color-nr-accent) 14%, transparent); color: var(--color-nr-text, #e6f4f5); outline: none; }
	.asm-menu small { color: var(--color-nr-dim, #5b6b70); font: 10px var(--font-mono); }
	.asm-menu .new { color: var(--color-nr-accent); }
	.seq-bar .bar-key { height: 22px; padding: 0 8px; font-size: 9px; }
	.seq-cap { margin-right: 4px; color: var(--color-nr-accent); font: 600 9px var(--font-sans); letter-spacing: 0.16em; text-transform: uppercase; }
	.seq-item { display: inline-flex; min-width: 0; max-width: 180px; align-items: center; gap: 5px; overflow: hidden; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; padding: 0 6px; color: var(--color-nr-muted); font: 10px/20px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
	.seq-item b { color: var(--color-nr-accent); font-weight: 500; }
	.rail { overflow: hidden; }
	.rail-resize { position: absolute; top: 0; right: -3px; bottom: 0; z-index: 30; width: 7px; cursor: col-resize; touch-action: none; }
	.rail-resize::after { content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 1px; background: transparent; transition: background 120ms ease; }
	.rail-resize:hover::after, .rail-resize.active::after, .rail-resize:focus-visible::after { background: #4ee8d2; }
	.rail-resize:focus-visible { outline: none; }
	.rail-collapse { margin: 0 8px 8px; border: 0; border-top: 1px solid #1d2226; background: transparent; padding: 8px 4px 2px; color: #55626a; font: 600 9px var(--font-sans); letter-spacing: 0.14em; text-align: left; text-transform: uppercase; }
	.rail-collapse:hover { color: #9eeee3; }
	.rail-handle { position: absolute; left: 0; bottom: 156px; z-index: 40; display: inline-flex; flex-direction: column; align-items: center; gap: 8px; width: 26px; padding: 9px 4px 8px; border: 1px solid #22282d; border-left: 0; border-radius: 0 3px 3px 0; background: rgba(17, 17, 19, 0.92); color: #7b878f; }
	.rail-handle:hover, .rail-handle:focus-visible { color: #dce7ea; outline: none; }
	.rail-handle-mark { width: 3px; height: 24px; border-radius: 999px; background: #4ee8d2; box-shadow: 0 0 10px rgba(78, 232, 210, 0.55); }
	.rail-handle-label { writing-mode: vertical-rl; transform: rotate(180deg); font: 700 9px var(--font-sans); letter-spacing: 0.14em; text-transform: uppercase; }
	.group-row { display: flex; min-width: 0; align-items: stretch; color: #8d9ca1; }
	.group-row.active { background: linear-gradient(90deg, rgba(78, 232, 210, 0.1), rgba(74, 184, 255, 0.04)); color: #c9f3ee; }
	.group-row.droppable { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-nr-accent) 25%, transparent); }
	.group-row.drop { background: color-mix(in srgb, var(--color-nr-accent) 16%, transparent); color: var(--color-nr-ink); box-shadow: inset 0 0 0 1px var(--color-nr-accent); }
	.group-pick { display: flex; flex: 1; min-width: 0; align-items: center; gap: 6px; border: 0; background: transparent; padding: 5px 7px; color: inherit; text-align: left; }
	.group-pick:hover { background: #151a1d; }
	.group-pick b { font-size: 11px; font-weight: 500; }
	.group-pick small { color: #5b6b70; font: 10px var(--font-mono); }
	.group-move { border: 0; background: transparent; padding: 0 7px; color: #4ee8d2; font: 600 11px var(--font-mono); }
	.group-move:hover { background: #14232a; }
	.group-add { border: 0; background: transparent; padding: 0 2px; color: #55747c; font: 600 9px var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; }
	.group-add:hover { color: #84cbd0; }
	.group-name { margin-top: 4px; width: 100%; border: 1px solid #22282d; border-radius: 2px; background: #0a0c0e; padding: 3px 6px; color: #cfe9ea; font: 11px var(--font-sans); outline: none; }
	.group-name:focus { border-color: rgba(78, 232, 210, 0.5); }
	.bin-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
	.bin-tile { position: relative; }
	.bin-jump { position: relative; display: block; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; border: 1px solid #22262b; border-radius: 6px; background: #151519; padding: 0; cursor: pointer; }
	.bin-jump:hover { border-color: #3d6a74; }
	.bin-tile.active .bin-jump { border-color: #84cbd0; box-shadow: 0 0 0 1px #84cbd0; }
	.bin-jump video, .bin-jump img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
	/* No take yet: a slate stripe, never black (black reads as a fade). */
	.bin-empty { position: absolute; inset: 0; display: grid; place-items: center; background: repeating-linear-gradient(135deg, #1d2a33 0 6px, #18222a 6px 12px); color: #6f93a0; font: 600 8px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
	.bin-num { position: absolute; left: 4px; top: 3px; padding: 0 3px; border-radius: 3px; background: rgb(10 12 14 / .7); color: #9fb4ba; font: 600 8px var(--font-mono); }
	.bin-title { position: absolute; inset: auto 0 0 0; padding: 10px 5px 3px; background: linear-gradient(transparent, rgb(8 9 11 / .9)); color: #e6eef0; font-size: 9px; line-height: 1.2; text-align: left; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
	.bin-back { position: absolute; right: 3px; top: 3px; border: 0; border-radius: 3px; background: rgb(10 12 14 / .78); padding: 1px 4px; color: #84cbd0; font: 600 8px var(--font-mono); text-transform: uppercase; opacity: 0; transition: opacity .12s; }
	.bin-tile:hover .bin-back, .bin-back:focus-visible { opacity: 1; }
	.bin-back:hover { background: #14232a; color: #bfeff1; }
</style>
