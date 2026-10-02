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
	import SpineEdge from '$lib/ui/edges/SpineEdge.svelte';
	import SequencePlayer from '$lib/ui/SequencePlayer.svelte';
	import { reviewSequence } from '$lib/ui/review-sequence.svelte';
	import ProductionWorkspace from '$lib/ui/ProductionWorkspace.svelte';
	import CapabilityChip from '$lib/ui/CapabilityChip.svelte';
	import type { ProductionTab } from '$lib/ui/ProductionWorkspace.svelte';
	import { ui } from '$lib/ui/app-state.svelte';
	import { stageName } from '$lib/domain/gates';
	import { voiceStatusColor, voiceSurfaceStatus } from '$lib/ui/voice-display';
	import { pickFor, takesFor } from '$lib/domain/takes';
	import { benchedBeats } from '$lib/domain/bench';
	import { mediaKind } from '$lib/domain/media';
	import { pendingGenerations } from '$lib/domain/animate';
	import AnimatePanel from '$lib/ui/AnimatePanel.svelte';
	import FinalizePanel from '$lib/ui/FinalizePanel.svelte';
	import { groupOf, groupsOf, MAIN_GROUP } from '$lib/domain/groups';
	import { readingOrder } from '$lib/domain/board-order';
	import Pick from '$lib/ui/controls/Pick.svelte';
	import { CLOSING_MS, draftsClosingSoon, finalizingIds, timeLeft } from '$lib/domain/finalize';
	import { clock } from '$lib/ui/clock.svelte';
	import { SEED, connect, deriveSpine, disconnect, linksOf, spineOf, type SpineLink } from '$lib/domain/spine';
	import type { Project, ProjectSummary, CanvasLayout } from '$lib/domain/schemas';

	const nodeTypes = { seed: SeedNode, voice: VoiceNode, story_card: StoryCardNode };
	const edgeTypes = { spine: SpineEdge };

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
	// The board has no permanent right panel (V1S-132): the brief lives in Story; the inspector opens on demand.
	let inspectorOpen = $state(false);
	// The left panel collapses inward to a slim tab on the edge (remembered).
	let railCollapsed = $state(false);
	$effect(() => { try { railCollapsed = localStorage.getItem('csp.rail-collapsed') === '1'; } catch { /* private mode */ } });
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
	// Tabs follow the flow: write the story, review on the board, work the beats, cut, sound, finish.
	const workspaceTabs: Array<{ label: string; tab: 'canvas' | ProductionTab }> = [
		{ label: 'Story', tab: 'story' }, { label: 'Board', tab: 'canvas' }, { label: 'Beats', tab: 'beats' },
		{ label: 'Cuts', tab: 'cuts' }, { label: 'Sound', tab: 'sound' }, { label: 'Export', tab: 'export' }
	];
	// Tabs saved before the Narrate flow land on their nearest successor.
	const legacyTabs: Record<string, 'canvas' | ProductionTab> = { cards: 'beats', media: 'beats', preview: 'cuts' };
	const secondaryNav = [
		{ label: 'Series', href: '/series', hint: 'Series from Notion: connect a show, check it, import episodes as projects' },
		{ label: 'Library', href: '/library', hint: 'Every project, its files and media' },
		{ label: 'Runs', href: '/runs', hint: 'Agent and generation runs, with their cost and results' },
		{ label: 'Settings', href: '/settings', hint: 'App settings: the Agent\'s model, video generation (Higgsfield), the sound-effects folder' }
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
			? project.production.cards.filter((card) => groupOf(card) === activeGroup).map((card) => ({ id: card.card_id, card }))
			: Array.from({ length: 6 }, (_, order) => ({ id: `story-placeholder-${order}`, card: null }));
		const chain = spineOf(project.production).chain.map((card) => card.card_id);
		const storyNodes: Node[] = cardRecords.map(({ id, card }, index) => {
			const savedNode = saved?.nodes.find((n) => n.node_id === id);
			const takes = card ? takesFor(project.production, card.card_id, true) : [];
			const pick = card ? pickFor(project.production, card) : null;
			const spineIndex = card ? chain.indexOf(card.card_id) : index;
			return {
				id,
				type: 'story_card',
				position: { x: savedNode?.x ?? 760 + (index % 5) * 260, y: savedNode?.y ?? Math.floor(index / 5) * 300 },
				data: {
					card, order: index, spineIndex: spineIndex < 0 ? null : spineIndex, takes, pickId: pick?.asset_id ?? null,
					onPick: (takeId: string) => card && pickTake(card.card_id, takeId),
					onReject: (takeId: string) => sendBoardCommand({ command: 'reject_take', take_id: takeId }),
					onRestore: (takeId: string) => sendBoardCommand({ command: 'restore_take', take_id: takeId }),
					onBench: (benched: boolean) => card && benchBeat(card.card_id, benched),
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
		return [seedNode, ...voiceNodes, ...storyNodes];
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
		// Only spine connectors can be deleted from the board; beats, seed and voices stay.
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
				const result = (await (await send(project)).json()) as ({ ok: true; data: Project } | { ok: false; error: { message: string } }) & Record<string, unknown>;
				if (!result.ok) throw new Error(result.error.message);
				adopted?.(result);
				if (activeProject?.project_id === project.project_id) adoptProject(withPendingPicks(result.data));
			} catch (e) {
				loadError = e instanceof Error ? e.message : 'Board update failed';
				await openProject(project.project_id);
			}
		});
	}

	function sendBoardCommand(body: Record<string, unknown>) {
		for (const [cardId, pending] of pendingPicks) if (cardId !== body.card_id) flushPick(cardId, pending);
		enqueueBoard((project) => fetch(`/api/projects/${project.project_id}/board`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...body, expected_version: project.version })
		}));
	}

	// --- Animate: the panel for one beat, and polling while any generation is still running.
	let animateCardId = $state<string | null>(null);

	// --- Board groups (V1S-131): which set of beats the board shows (remembered per project).
	let activeGroup = $state<string>(MAIN_GROUP);
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
		const known = groupsOf(project.production).some((g) => g.group_id === saved);
		if (known && saved !== activeGroup) { activeGroup = saved!; adoptProject(project); }
	});

	function showGroup(groupId: string) {
		activeGroup = groupId;
		try { if (activeProject) localStorage.setItem(groupKey(activeProject.project_id), groupId); } catch { /* private mode */ }
		selectedNodeId = null;
		if (activeProject) adoptProject(activeProject);
	}

	// Beats picked on the board (click, or shift-drag a box over several), in reading order.
	const selectedBeats = $derived(readingOrder(nodes.filter((node) => node.selected && isBeat(node.id)).map((node) => ({ id: node.id, x: node.position.x, y: node.position.y }))).map((item) => item.id));
	const beatTitle = (cardId: string) => activeProject?.production.cards.find((card) => card.card_id === cardId)?.title ?? 'the beat';
	const groupName = (groupId: string) => (activeProject ? groupsOf(activeProject.production).find((g) => g.group_id === groupId)?.name : null) ?? 'that group';
	const beatsLabel = (ids: string[]) => (ids.length === 1 ? beatTitle(ids[0]) : `${ids.length} beats`);

	function clearSelection() {
		nodes = nodes.map((node) => (node.selected ? { ...node, selected: false } : node));
		selectedNodeId = null;
	}

	/** A new group; with beats selected, they move into it (it's how a row becomes "Teaser 20s"). */
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

	function moveSelectedTo(groupId: string, ids: string[] = selectedBeats) {
		const moving = ids.filter((id) => { const card = activeProject?.production.cards.find((c) => c.card_id === id); return card && groupOf(card) !== groupId; });
		if (!moving.length) return;
		sendBoardCommand({ command: 'move_beats', group_id: groupId, card_ids: moving });
		notify(`Moved ${beatsLabel(moving)} to ${groupName(groupId)}.`);
		clearSelection();
	}

	// Drag beats from the board onto a group in the left panel to move them there. The cards go
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
		const target = draggingBeats ? groupUnder(event) : null;
		dropGroup = null;
		draggingBeats = false;
		autoPanDrag = true;
		if (target && dragViewport) viewport = dragViewport;
		dragViewport = null;
		const beats = dragged.filter((node) => isBeat(node.id)).map((node) => node.id);
		if (target && beats.length) {
			nodes = nodes.map((node) => { const from = dragStart.get(node.id); return from ? { ...node, position: from } : node; });
			moveSelectedTo(target, readingOrder(dragged.filter((node) => isBeat(node.id)).map((node) => ({ id: node.id, ...(dragStart.get(node.id) ?? node.position) }))).map((item) => item.id));
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

	/** Play the selected beats' picks in reading order (benched beats and stills are skipped). */
	function playSelection() {
		const project = activeProject;
		if (!project) return;
		const items = selectedBeats.flatMap((id) => {
			const card = project.production.cards.find((c) => c.card_id === id);
			const pick = card && !card.benched ? pickFor(project.production, card) : null;
			return card && pick?.kind === 'video' ? [{ id: card.card_id, title: card.title, src: pick.url, assetId: pick.asset_id }] : [];
		});
		if (!items.length) { notify('None of the selected beats has a video pick to play.'); return; }
		reviewSequence.items = items;
		reviewSequence.playing = true;
	}

	/** Split a video take into shots through the splitter: a new group of shot beats, then show it. */
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
			notify(`Split into ${result.shots} shots: a new group, one beat per shot. A better take of a shot is just another take on its beat.`);
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
						const title = result.data.production.cards.find((card) => card.card_id === generation.card_id)?.title ?? 'a beat';
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

	// --- Drag and drop: a file on a beat becomes its new take (and pick); on empty canvas, a new benched beat there.
	let dropNotice = $state<string | null>(null);
	let dropNoticeTimer: ReturnType<typeof setTimeout> | null = null;

	function notify(message: string) {
		dropNotice = message;
		if (dropNoticeTimer) clearTimeout(dropNoticeTimer);
		dropNoticeTimer = setTimeout(() => (dropNotice = null), 9000);
	}

	function boardDragOver(event: DragEvent) {
		if (!activeProject || !event.dataTransfer?.types.includes('Files')) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'copy';
	}

	function boardDrop(event: DragEvent) {
		const files = [...(event.dataTransfer?.files ?? [])];
		if (!activeProject || files.length === 0) return;
		event.preventDefault();
		for (const [cardId, pending] of pendingPicks) flushPick(cardId, pending);
		const nodeId = (event.target as Element | null)?.closest('.svelte-flow__node')?.getAttribute('data-id');
		const cardId = nodeId && activeProject.production.cards.some((card) => card.card_id === nodeId) ? nodeId : null;
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const at = { x: (event.clientX - box.left - viewport.x) / viewport.zoom, y: (event.clientY - box.top - viewport.y) / viewport.zoom };
		const refused = files.filter((file) => !mediaKind(file.name)).map((file) => file.name);
		const flagged: string[] = [];
		const report = () => {
			const lines = [
				refused.length ? `Not an image or video, left out: ${refused.join(', ')}` : '',
				flagged.length ? `Under 2K on the long edge, flagged: ${flagged.join(', ')}` : ''
			].filter(Boolean);
			if (lines.length) notify(lines.join(' · '));
		};
		files.filter((file) => mediaKind(file.name)).forEach((file, index) => {
			const params = new URLSearchParams({ name: file.name });
			if (cardId) params.set('card_id', cardId);
			else { params.set('x', String(Math.round(at.x + index * 40))); params.set('y', String(Math.round(at.y + index * 40))); params.set('group_id', activeGroup); }
			enqueueBoard(
				(project) => {
					params.set('expected_version', String(project.version));
					return fetch(`/api/projects/${project.project_id}/media?${params}`, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file });
				},
				(result) => {
					const take = result.take as { under_2k?: boolean; name: string; width?: number; height?: number };
					if (take.under_2k) flagged.push(`${take.name} (${take.width}×${take.height})`);
					if (!cardId && layout) {
						// The server placed the new beat at the drop point; mirror it so the board doesn't jump.
						layout = { ...layout, nodes: [...layout.nodes, { node_id: String(result.beat_id), type: 'story_card', lane: 'storyboard', x: Number(params.get('x')), y: Number(params.get('y')), width: 320, height: 400 }] };
					}
					report();
				}
			);
		});
		if (refused.length && refused.length === files.length) report();
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

	function benchBeat(cardId: string, benched: boolean) {
		sendBoardCommand({ command: benched ? 'bench_beat' : 'unbench_beat', card_id: cardId });
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
				// The board shows one group at a time: keep the saved places of beats in other groups.
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
		const restored = savedWorkspace && (legacyTabs[savedWorkspace] ?? workspaceTabs.find((item) => item.tab === savedWorkspace)?.tab);
		if (restored) {
			openWorkspace(restored);
		}
		ui.activeProjectUpdater = (project) => adoptProject(project, layout);
		ui.pageActions = [
			{ id: 'new-project', label: 'new project', hint: 'seed · s0', run: () => void createProject() },
			{ id: 'toggle-inspector', label: 'toggle inspector', hint: 'panel', run: () => (inspectorOpen = !inspectorOpen) }
		];
		void loadProjects().then(() => {
			// ?project=<id> opens that project (the Series page links imported episodes this way); else the newest.
			const params = new URLSearchParams(location.search);
			const wanted = params.get('project');
			const tab = workspaceTabs.find((item) => item.tab === params.get('tab'))?.tab;
			if (tab) openWorkspace(tab);
			if (projects.length > 0) void openProject(wanted && projects.some((p) => p.project_id === wanted) ? wanted : projects[0].project_id);
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

<svelte:head><title>{activeProject ? `${activeProject.title} — Creative Studio Pro` : 'Creative Studio Pro'}</title></svelte:head>

<div class="grid h-full min-w-0 overflow-x-hidden" style="grid-template-rows: 48px minmax(0,1fr) 42px">
	<!-- The one navigation bar: product, project, the flow's tabs, then app-level links (48px). -->
	<div class="flex min-w-0 items-center gap-2 border-b border-border-default bg-surface-base px-3">
		<span class="flex shrink-0 items-center gap-2" aria-label="Creative Studio Pro">
			<span class="block h-2 w-2 rounded-[1px] bg-voice-1 shadow-[0_0_8px_color-mix(in_srgb,var(--color-voice-1)_45%,transparent)]"></span>
			<span class="brand">Creative Studio Pro</span>
		</span>
		<span class="h-4 w-px shrink-0 bg-border-default"></span>
		<b class="project-name min-w-0 max-w-[260px] truncate" title={activeProject?.title}>{activeProject?.title ?? 'No project open'}</b>
		{#if activeProject}
			<span class="meta-label shrink-0 text-text-dim">v{activeProject.version}</span>
		{/if}
		<nav class="ml-2 hidden min-w-0 items-center gap-0.5 overflow-x-auto lg:flex" aria-label="Project">
			{#each workspaceTabs as item (item.label)}
				{@const active = item.tab === 'canvas' ? canvasOpen : !canvasOpen && productionTab === item.tab}
				<button type="button" class={['flow-tab', active && 'active']} aria-current={active ? 'page' : undefined} onclick={() => openWorkspace(item.tab)}>{item.label}</button>
			{/each}
		</nav>
		<span class="grow"></span>
		<button type="button" class="bar-key agent" disabled={!activeProject} title="The Agent: your assistant for this project. It drafts the brief, beats and prompts, suggests effects, and makes judgment calls inside your rules. Measurable work (lint, trims, levels) is done in code, not by the Agent." onclick={() => { ui.chatMode = 'focus'; ui.chatOpen = !ui.chatOpen; }}>
			<span class="charm-gradient-text">✦</span> Agent
		</button>
		<button type="button" class="bar-key" onclick={() => void createProject()} disabled={creating} title="Start a new project from a rough idea">
			<span class="sm:hidden">{creating ? '…' : '+ New'}</span>
			<span class="hidden sm:inline">{creating ? 'Creating…' : '+ New project'}</span>
		</button>
		<nav class="hidden items-center gap-0.5 xl:flex" aria-label="App">
			{#each secondaryNav as item (item.href)}
				<a href={item.href} class="flow-tab" title={item.hint}>{item.label}</a>
			{/each}
		</nav>
		<button type="button" class="bar-key hidden sm:flex" onclick={() => (ui.paletteOpen = true)} title="Command palette: jump to any action by typing">⌘K</button>
		<CapabilityChip />
		<button
			type="button"
			class="bar-key"
			onclick={() => (inspectorOpen = !inspectorOpen)}
			title={inspectorOpen ? 'Hide the seed and voice details' : 'Show the seed and voice details'}
			aria-pressed={inspectorOpen}
		>
			{inspectorOpen ? '▸' : '◂'}
		</button>
	</div>

	<!-- Work area: lane rail + canvas + inspector -->
	<div
		class="work-area relative grid min-h-0 min-w-0 transition-[grid-template-columns] duration-300 ease-out"
		style={`--inspector-width: ${inspectorOpen ? '300px' : '0px'}; --rail-width: ${canvasOpen && !railCollapsed ? '184px' : '0px'}`}
	>
		<aside class={['rail hidden bg-surface-raised md:flex md:flex-col', canvasOpen && !railCollapsed ? 'border-r border-border-default' : '']} aria-label="Canvas layers" aria-hidden={!canvasOpen || railCollapsed}>
			{#if canvasOpen && !railCollapsed}
			<div class="min-h-0 grow overflow-y-auto p-3">
				<div class="meta-label">Canvas layers</div>
				<div class="mt-3 grid gap-1.5">
					<div class="layer-row"><span class="bg-voice-1"></span><b>Seed</b><small>1</small></div>
					<div class="layer-row"><span class="bg-[#4ab8ff]"></span><b>Voices</b><small>{activeProject?.voices.length ?? 0}</small></div>
					<div class="layer-row"><span class="bg-[#5cffbe]"></span><b>Beats</b><small>{activeProject?.production.cards.length || 6}</small></div>
					<div class="layer-row"><span class="bg-[#8174e8]"></span><b>Takes</b><small>{activeProject?.production.assets.length ?? 0}</small></div>
				</div>
				<p class="mt-4 font-mono text-[9px] leading-4 text-text-dim">Drag cards to arrange the production. Cycle a beat's takes; the one showing is its pick.</p>
				{#if activeProject}
					{@const groups = groupsOf(activeProject.production)}
					<div class="meta-label mt-5 flex items-center">Groups<span class="grow"></span><button type="button" class="group-add" onclick={() => (newGroupName = '')} aria-label="New group">+ new</button></div>
					<ul class="mt-2 grid gap-px" aria-label="Board groups">
						{#each groups as group (group.group_id)}
							<li class={['group-row', group.group_id === activeGroup && 'active', draggingBeats && group.group_id !== activeGroup && 'droppable', dropGroup === group.group_id && 'drop']} data-group-id={group.group_id}>
								{#if renaming?.group_id === group.group_id}
									<!-- svelte-ignore a11y_autofocus -->
									<input class="group-name m-0" bind:value={renaming.name} aria-label={`Rename ${group.name}`} autofocus onkeydown={(event) => { if (event.key === 'Enter') renameGroup(); else if (event.key === 'Escape') renaming = null; }} onblur={renameGroup} />
								{:else}
									<button type="button" class="group-pick" onclick={() => showGroup(group.group_id)} ondblclick={() => { if (group.group_id !== MAIN_GROUP) renaming = { group_id: group.group_id, name: group.name }; }} aria-pressed={group.group_id === activeGroup} title={group.group_id === MAIN_GROUP ? 'Main: every beat not in a group' : 'Show this group · double-click to rename'}>
										<b class="min-w-0 grow truncate">{group.name}</b>
										<small>{group.count}</small>
									</button>
								{/if}
								{#if selectedBeats.length && group.group_id !== activeGroup}
									<button type="button" class="group-move" onclick={() => moveSelectedTo(group.group_id)} title={`Move ${beatsLabel(selectedBeats)} here`} aria-label={`Move ${beatsLabel(selectedBeats)} to ${group.name}`}>→</button>
								{/if}
							</li>
						{/each}
					</ul>
					{#if newGroupName !== null}
						<input class="group-name" bind:this={groupInput} bind:value={newGroupName} placeholder={selectedBeats.length ? `Name for ${beatsLabel(selectedBeats)}` : 'Group name'} aria-label="New group name" onkeydown={(event) => { if (event.key === 'Enter') createGroup(); else if (event.key === 'Escape') newGroupName = null; }} onblur={() => (newGroupName?.trim() ? createGroup() : (newGroupName = null))} />
					{/if}
					<p class="mt-2 font-mono text-[9px] leading-4 text-text-dim">{draggingBeats ? 'Drop on a group to move the beats there.' : selectedBeats.length ? `Click → on a group to move ${beatsLabel(selectedBeats)} there, or + new to make one from them.` : 'Pick a group to show its beats. Drag a beat onto a group to move it. Shift-drag a box over beats to select a row, then group it. Double-click a group to rename it.'}</p>
					{@const bin = benchedBeats(activeProject.production)}
					<div class="meta-label mt-5 flex items-center">Bin<span class="grow"></span><small class="font-mono text-[10px] text-text-dim">{bin.length}</small></div>
					{#if bin.length === 0}
						<p class="mt-2 font-mono text-[9px] leading-4 text-text-dim">Benched beats land here. They keep their place and are skipped when the story plays.</p>
					{:else}
						<ul class="mt-2 grid gap-1" aria-label="Benched beats">
							{#each bin as card (card.card_id)}
								<li class="bin-row">
									<span class="font-mono text-[9px] text-text-dim">{String(card.order + 1).padStart(2, '0')}</span>
									<b class="min-w-0 grow truncate" title={card.title}>{card.title}</b>
									<button type="button" onclick={() => benchBeat(card.card_id, false)} aria-label={`Restore ${card.title} from the bin`}>Restore</button>
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

		<main class="relative min-w-0">
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
						maxZoom={2}
						fitView={false}
						nodesConnectable={(activeProject?.production.cards.length ?? 0) > 0}
						isValidConnection={validSpineConnection}
						onconnect={onSpineConnect}
						onreconnect={onSpineReconnect}
						onreconnectend={onSpineReconnectEnd}
						onbeforedelete={beforeBoardDelete}
						selectionKey="Shift"
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
					</SvelteFlow>
					{#if selectedBeats.length > 1 && activeProject}
						{@const moveTargets = groupsOf(activeProject.production).filter((g) => g.group_id !== activeGroup)}
						<div class="sel-bar" role="group" aria-label="Selected beats">
							<span class="seq-cap">{selectedBeats.length} beats</span>
							<button type="button" class="bar-key agent" onclick={playSelection} title="Play their picks in reading order: row by row, left to right">▶ Play in order</button>
							<button type="button" class="bar-key" onclick={groupSelection} title="Name a new group and move these beats into it">New group…</button>
							{#if moveTargets.length}<Pick label="Move the selected beats to a group" placeholder="Move to…" options={moveTargets.map((g) => ({ value: g.group_id, label: g.name, hint: String(g.count) }))} onchange={(groupId) => moveSelectedTo(groupId)} />{/if}
							<button type="button" class="bar-key" onclick={clearSelection}>Clear</button>
						</div>
					{/if}
					{#if reviewSequence.items.length}
						<div class="seq-bar" role="group" aria-label="Selected sequence">
							<span class="seq-cap">Sequence</span>
							{#each reviewSequence.items as item, i (item.id)}<span class="seq-item"><b>{i + 1}</b>{item.title.split(' — ')[0]}</span>{/each}
							<button type="button" class="bar-key agent" onclick={() => (reviewSequence.playing = true)} title="Play the selected beats in order">▶ Play</button>
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
	.brand { color: #b8c4c8; font: 600 12px var(--font-sans); letter-spacing: 0.22em; text-transform: uppercase; }
	.project-name { color: #8f9ca1; font-size: 12px; font-weight: 500; }
	.flow-tab { padding: 3px 9px; border-radius: 2px; color: #66737a; font: 600 10px var(--font-sans); letter-spacing: 0.14em; text-transform: uppercase; transition: color 140ms ease, background 140ms ease; }
	.flow-tab:hover { color: #a9b6bd; }
	.flow-tab.active { color: #9eeee3; background: rgba(78, 232, 210, 0.07); box-shadow: inset 0 -1px 0 rgba(78, 232, 210, 0.6); }
	.bar-key { display: inline-flex; align-items: center; gap: 6px; height: 26px; border: 1px solid #262c31; border-radius: 2px; background: transparent; padding: 0 10px; color: #8a969e; font: 600 10px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; transition: border-color 140ms ease, color 140ms ease; }
	.bar-key:hover:not(:disabled) { border-color: #44505a; color: #c4d0d6; }
	.bar-key:disabled { opacity: 0.4; }
	.bar-key.agent { border-color: rgba(78, 232, 210, 0.4); color: #9eeee3; }
	.seq-bar { position: absolute; bottom: 12px; left: 50%; z-index: 10; display: flex; max-width: calc(100% - 120px); align-items: center; gap: 6px; transform: translateX(-50%); border: 1px solid var(--color-nr-line); border-radius: 3px; background: color-mix(in srgb, var(--color-nr-deep) 95%, transparent); padding: 5px 6px 5px 10px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.45); }
	.sel-bar { position: absolute; top: 12px; left: 50%; z-index: 10; display: flex; align-items: center; gap: 6px; transform: translateX(-50%); border: 1px solid color-mix(in srgb, var(--color-nr-accent) 35%, var(--color-nr-line)); border-radius: 3px; background: color-mix(in srgb, var(--color-nr-deep) 95%, transparent); padding: 5px 6px 5px 10px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.45); }
	.sel-bar .bar-key { height: 22px; padding: 0 8px; font-size: 9px; }
	.seq-bar .bar-key { height: 22px; padding: 0 8px; font-size: 9px; }
	.seq-cap { margin-right: 4px; color: var(--color-nr-accent); font: 600 9px var(--font-sans); letter-spacing: 0.16em; text-transform: uppercase; }
	.seq-item { display: inline-flex; min-width: 0; max-width: 180px; align-items: center; gap: 5px; overflow: hidden; border: 1px solid var(--color-nr-line-soft); border-radius: 2px; padding: 0 6px; color: var(--color-nr-muted); font: 10px/20px var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
	.seq-item b { color: var(--color-nr-accent); font-weight: 500; }
	.rail { overflow: hidden; }
	.rail-collapse { margin: 0 8px 8px; border: 0; border-top: 1px solid #1d2226; background: transparent; padding: 8px 4px 2px; color: #55626a; font: 600 9px var(--font-sans); letter-spacing: 0.14em; text-align: left; text-transform: uppercase; }
	.rail-collapse:hover { color: #9eeee3; }
	.rail-handle { position: absolute; left: 0; bottom: 64px; z-index: 40; display: inline-flex; flex-direction: column; align-items: center; gap: 8px; width: 26px; padding: 9px 4px 8px; border: 1px solid #22282d; border-left: 0; border-radius: 0 3px 3px 0; background: rgba(17, 17, 19, 0.92); color: #7b878f; }
	.rail-handle:hover, .rail-handle:focus-visible { color: #dce7ea; outline: none; }
	.rail-handle-mark { width: 3px; height: 24px; border-radius: 999px; background: #4ee8d2; box-shadow: 0 0 10px rgba(78, 232, 210, 0.55); }
	.rail-handle-label { writing-mode: vertical-rl; transform: rotate(180deg); font: 700 9px var(--font-sans); letter-spacing: 0.14em; text-transform: uppercase; }
	.group-row { display: flex; align-items: stretch; color: #8d9ca1; }
	.group-row.active { background: linear-gradient(90deg, rgba(78, 232, 210, 0.1), rgba(74, 184, 255, 0.04)); color: #c9f3ee; box-shadow: inset 2px 0 0 #4ee8d2; }
	.group-row.droppable { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-nr-accent) 25%, transparent); }
	.group-row.drop { background: color-mix(in srgb, var(--color-nr-accent) 16%, transparent); color: var(--color-nr-ink); box-shadow: inset 0 0 0 1px var(--color-nr-accent), inset 3px 0 0 var(--color-nr-accent); }
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
	.bin-row { display: flex; align-items: center; gap: 6px; padding: 5px 7px; background: #151519; color: #8d9ca1; }
	.bin-row b { font-size: 11px; font-weight: 500; }
	.bin-row button { border: 0; background: transparent; padding: 2px 4px; color: #55747c; font: 600 9px var(--font-mono); text-transform: uppercase; }
	.bin-row button:hover { background: #14232a; color: #84cbd0; }
</style>
