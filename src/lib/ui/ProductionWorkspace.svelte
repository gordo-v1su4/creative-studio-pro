<script lang="ts">
	import { untrack } from 'svelte';
	import { loadClipMetadata, proxyUrl } from '$lib/media/gpu/clipBanks';
	import ClipHoverPlayer from '$lib/ui/ClipHoverPlayer.svelte';
	import type { Project, ProductionAsset, ProductionState, StoryCard } from '$lib/domain/schemas';
	import { pickFor } from '$lib/domain/takes';
	import { cutLength } from '$lib/domain/cuts';
	import SequencePlayer from '$lib/ui/SequencePlayer.svelte';
	import CutStage from '$lib/ui/cut/CutStage.svelte';
	import { cutView } from '$lib/ui/cut/cut-view.svelte';
	import BriefSheet from '$lib/ui/story/BriefSheet.svelte';
	import Pitch from '$lib/ui/story/Pitch.svelte';
	import EpisodeOutline from '$lib/ui/EpisodeOutline.svelte';
	import PrepWorkspace from '$lib/ui/PrepWorkspace.svelte';
	import SeasonStructure from '$lib/ui/SeasonStructure.svelte';
	import StageGatePanel from '$lib/ui/StageGatePanel.svelte';
	import { droppedFiles, pickedFiles } from '$lib/ui/dropped-files';
	import HiggsfieldImport from '$lib/ui/HiggsfieldImport.svelte';
	import TakeReview from '$lib/ui/TakeReview.svelte';
	import StoryPlan from '$lib/ui/StoryPlan.svelte';
	import ShotCard from '$lib/ui/shots/ShotCard.svelte';
	import TakesBand from '$lib/ui/shots/TakesBand.svelte';
	import SelectionStrip from '$lib/ui/shots/SelectionStrip.svelte';
	import { roomState } from '$lib/ui/review-room-state.svelte';
	import { page } from '$app/state';
	import { shotRoomLink } from '$lib/domain/review-room-links';
	import { mergeProduction } from '$lib/domain/merge-production';
	import PromptSections from '$lib/ui/shots/PromptSections.svelte';
	import MakeTake from '$lib/ui/shots/MakeTake.svelte';
	import { ghostSections, imageSections, withGhostSection, withImageSection, type PromptSection } from '$lib/domain/prompt-sections';
	import { SIZE_WORDS } from '$lib/domain/shot-spec';
	import { reviewSequence } from '$lib/ui/review-sequence.svelte';
	import { selectionEntries } from '$lib/domain/selection';
	import { playItemFor } from '$lib/domain/slate';
	import { nextCutName } from '$lib/domain/cuts';
	import { dropLabel, dropMeaning, type DropContext, type DropTarget } from '$lib/domain/drops';
	import { groupOf, nextGroupName } from '$lib/domain/groups';
	import { mediaKind } from '$lib/domain/media';
	import Viewer from '$lib/ui/shots/Viewer.svelte';
	import type { ReviewStatus } from '$lib/domain/viewer-keys';
	import { shotCardFacts } from '$lib/domain/shot-card';
	import { takesFor } from '$lib/domain/takes';

	export type ProductionTab = 'story' | 'prep' | 'beats' | 'cuts' | 'sound' | 'export';
	let { project, onUpdated, onAddFiles, onImportRenders, onOpenBoard, tab = $bindable('story'), detailsHost = null, onOpenDetails, onOpenAgent }: {
		project: Project; onUpdated: (project: Project) => void;
		/** Files dropped or picked on the Shots tab: each becomes a new shot (off the spine, not benched). */
		onAddFiles?: (files: File[], place?: { cardId?: string }) => void;
		/** Higgsfield renders picked on the Shots tab (job ids, in the order to add): each becomes a new shot. */
		onImportRenders?: (jobIds: string[]) => void;
		onOpenBoard?: (groupId?: string) => void;
		tab?: ProductionTab;
		/** Where the selected shot's details are shown: the Details tab of the shell's dock. */
		detailsHost?: HTMLElement | null;
		/** Asked to bring the Details tab forward. */
		onOpenDetails?: () => void;
		/** Asked to bring the dock's Agent tab forward (Cut → Sound's effects pass answers there). */
		onOpenAgent?: () => void;
	} = $props();

	let higgsfieldOpen = $state(false);
	const importedJobs = $derived(new Set(project.production.assets.flatMap((asset) => (asset.job_id ? [asset.job_id] : []))));

	// --- Bench (keep it, but leave it out of plays and the Agent's cut) and remove (gone, with one undo).
	let shotBusy = $state<string | null>(null);
	let shotNotice = $state<{ text: string; undo?: { production: ProductionState; version: number } } | null>(null);

	async function boardCommand(body: Record<string, unknown>): Promise<Project> {
		const result = (await (await fetch(`/api/projects/${project.project_id}/board`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, expected_version: project.version }) })).json()) as ({ ok: true; data: Project } | { ok: false; error: { message: string } }) & Record<string, unknown>;
		if (!result.ok) throw new Error(result.error.message);
		roomState.keepPick(result);
		onUpdated(result.data);
		return result.data;
	}

	async function setBenched(card: StoryCard, benched: boolean) {
		shotBusy = card.card_id; shotNotice = null;
		try { await boardCommand({ command: benched ? 'bench_beat' : 'unbench_beat', card_id: card.card_id }); }
		catch (cause) { shotNotice = { text: cause instanceof Error ? cause.message : 'Benching failed' }; }
		finally { shotBusy = null; }
	}

	async function removeShot(card: StoryCard) {
		shotBusy = card.card_id; shotNotice = null;
		const before = cloneProduction(project.production);
		try {
			const after = await boardCommand({ command: 'remove_beats', card_ids: [card.card_id] });
			shotNotice = { text: `Removed ${card.title}.`, undo: { production: before, version: after.version } };
		} catch (cause) { shotNotice = { text: cause instanceof Error ? cause.message : 'Removing failed' }; }
		finally { shotBusy = null; }
	}

	/** Put the removed shot back: the production as it was, if nothing else changed since. */
	async function undoRemove() {
		const undo = shotNotice?.undo;
		if (!undo || undo.version !== project.version) { shotNotice = { text: 'The project changed since; the removal can no longer be undone here.' }; return; }
		shotBusy = 'undo';
		try { await request({ mode: 'save', expected_version: project.version, production: undo.production }); shotNotice = { text: 'Put back.' }; }
		catch (cause) { shotNotice = { text: cause instanceof Error ? cause.message : 'Undo failed' }; }
		finally { shotBusy = null; }
	}

	// --- The score: the song the first cut is made to, analysed by Essentia (beats, energy, sections).
	const score = $derived(project.production.score ?? null);
	let scoreBusy = $state<'upload' | 'remove' | 'cutting' | 'analysing' | null>(null);
	let scoreError = $state<string | null>(null);
	const clockOf = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

	async function uploadScore(file: File | undefined) {
		if (!file) return;
		scoreBusy = 'upload'; scoreError = null;
		try {
			const query = new URLSearchParams({ name: file.name, expected_version: String(project.version) });
			const body = (await (await fetch(`/api/projects/${project.project_id}/cuts/music?${query}`, { method: 'POST', headers: { 'content-type': file.type || 'audio/*' }, body: file })).json()) as { ok: true; data: Project } | { ok: false; error: { message: string } };
			if (!body.ok) throw new Error(body.error.message);
			onUpdated(body.data);
		} catch (cause) { scoreError = cause instanceof Error ? cause.message : 'Adding the score failed'; }
		finally { scoreBusy = null; }
	}

	async function removeScore() {
		scoreBusy = 'remove'; scoreError = null;
		try {
			const body = (await (await fetch(`/api/projects/${project.project_id}/cuts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'set_score', expected_version: project.version, music: null }) })).json()) as { ok: true; data: Project } | { ok: false; error: { message: string } };
			if (!body.ok) throw new Error(body.error.message);
			onUpdated(body.data);
		} catch (cause) { scoreError = cause instanceof Error ? cause.message : 'Removing the score failed'; }
		finally { scoreBusy = null; }
	}

	async function scoreCall(method: 'POST' | 'GET') {
		const body = (await (await fetch(`/api/projects/${project.project_id}/score/analysis`, { method })).json()) as { ok: true; data: Project; analysis?: NonNullable<Project['production']['score']>['analysis'] } | { ok: false; error: { message: string } };
		if (!body.ok) throw new Error(body.error.message);
		onUpdated(body.data);
		return body.analysis;
	}

	/** Send the score to Essentia, then check on it every few seconds until it is done or fails. */
	async function analyseScore() {
		scoreBusy = 'analysing'; scoreError = null;
		try {
			let analysis = await scoreCall('POST');
			while (analysis?.status === 'running') {
				await new Promise((done) => setTimeout(done, 4000));
				analysis = await scoreCall('GET');
			}
			if (analysis?.status === 'failed') scoreError = analysis.error ?? 'Essentia could not analyse the score';
		} catch (cause) { scoreError = cause instanceof Error ? cause.message : 'Essentia could not analyse the score'; }
		finally { scoreBusy = null; }
	}

	// --- Shot tags: each shot's pick captioned and its motion measured, one at a time.
	const untaggedPicks = $derived(project.production.cards.flatMap((card) => { const pick = pickFor(project.production, card); return pick && !pick.tags ? [pick.asset_id] : []; }));
	let tagging = $state<{ done: number; total: number; failed: number; stop: boolean } | null>(null);
	/** Set by the stop button; the workers check it between takes. */
	let stopTagging = false;

	/**
	 * Two takes in flight: while one is on the caption gateway's GPU (which takes one at a time), the next one's
	 * frames are being measured. Three failures in a row stop the run instead of grinding through every shot.
	 */
	async function tagShots() {
		const queue = [...untaggedPicks];
		const run = { done: 0, total: queue.length, failed: 0, stop: false };
		tagging = { ...run };
		stopTagging = false;
		let inARow = 0;
		const worker = async () => {
			for (let takeId = queue.shift(); takeId && !run.stop && !stopTagging; takeId = queue.shift()) {
				try {
					const body = (await (await fetch(`/api/projects/${project.project_id}/tags`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ take_id: takeId }) })).json()) as { ok: true; data: Project } | { ok: false; error: { message: string } };
					if (!body.ok) throw new Error(body.error.message);
					inARow = 0;
					onUpdated(body.data);
				} catch (cause) {
					run.failed += 1;
					scoreError = `Tagging: ${cause instanceof Error ? cause.message : 'failed'}`;
					if (++inARow >= 3) { run.stop = true; scoreError += ' (stopped after three failures in a row)'; }
				}
				run.done += 1;
				if (tagging) tagging = { ...run };
			}
		};
		await Promise.all([worker(), worker()]);
		tagging = null;
	}

	/** The title-card flag by hand, for when the caption missed it (or saw one that isn't). */
	async function setTitleCard(takeId: string, titleCard: boolean) {
		const take = project.production.assets.find((asset) => asset.asset_id === takeId);
		if (!take?.tags) return;
		shotBusy = takeId;
		try { await boardCommand({ command: 'set_take_tags', take_id: takeId, tags: { ...take.tags, title_card: titleCard } }); }
		catch (cause) { shotNotice = { text: cause instanceof Error ? cause.message : 'Saving the tag failed' }; }
		finally { shotBusy = null; }
	}

	/** The first cut to the score, planned in code from the tags and the score's sections: a new cut, opened in the Cuts tab. */
	async function cutToScore() {
		scoreBusy = 'cutting'; scoreError = null;
		try {
			const body = (await (await fetch(`/api/projects/${project.project_id}/cuts/assemble`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expected_version: project.version }) })).json()) as { ok: true; data: Project; cut_id: string | null; notes: string[] } | { ok: false; error: { message: string } };
			if (!body.ok) throw new Error(body.error.message);
			onUpdated(body.data);
			const cut = body.data.production.cuts?.find((entry) => entry.cut_id === body.cut_id);
			cutNotice = cut ? [`"${cut.name}": ${cut.entries.length} entries, ${cutLength(cut).toFixed(1)}s.`, ...body.notes].join(' · ') : null;
			if (body.cut_id) cutView.open(body.cut_id);
			tab = 'cuts';
		} catch (cause) { scoreError = cause instanceof Error ? cause.message : 'The first cut failed'; }
		finally { scoreBusy = null; }
	}

	// Drops on the Shots grid go through the one resolver (domain/drops): files on a shot are new takes of it,
	// files on open space are new shots.
	const dropContext = $derived<DropContext>({
		groupOf: (cardId) => { const card = draft.cards.find((entry) => entry.card_id === cardId); return card ? groupOf(card) : null; },
		playable: (cardId) => { const card = draft.cards.find((entry) => entry.card_id === cardId); return !!card && !!playItemFor({ ...project, production: draft }, card); }
	});
	/** What letting go would do while files are held over the grid (null when nothing is held), and the shot under them. */
	let dropHint = $state<string | null>(null);
	let dropCard = $state<string | null>(null);
	const dropping = $derived(dropHint !== null);
	const gridTarget = (event: DragEvent): DropTarget => {
		const cardId = (event.target as Element | null)?.closest('[data-shot]')?.getAttribute('data-shot');
		return cardId ? { kind: 'shot', cardId } : { kind: 'space', groupId: 'main' };
	};
	function shotsDragOver(event: DragEvent) {
		if (!onAddFiles || !event.dataTransfer?.types.includes('Files')) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'copy';
		const target = gridTarget(event);
		dropCard = target.kind === 'shot' ? target.cardId : null;
		dropHint = dropLabel(dropMeaning({ kind: 'files' }, target, dropContext), { shot: draft.cards.find((card) => card.card_id === dropCard)?.title });
	}
	function shotsDrop(event: DragEvent) {
		const target = gridTarget(event);
		dropHint = null; dropCard = null;
		if (!onAddFiles || !event.dataTransfer?.types.includes('Files')) return;
		event.preventDefault();
		void droppedFiles(event.dataTransfer).then((files) => {
			const meaning = dropMeaning({ kind: 'files', media: files.map((file) => mediaKind(file.name) ?? 'other') }, target, dropContext);
			if (meaning.kind === 'new-take') onAddFiles?.(files, { cardId: meaning.cardId });
			else if (meaning.kind === 'new-shots') onAddFiles?.(files);
			else if (meaning.kind === 'nothing') shotNotice = { text: meaning.why };
		});
	}
	function shotsPicked(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = pickedFiles(input.files);
		input.value = '';
		onAddFiles?.(files);
	}

	let busy = $state(false);
	/** V1S-378: the cut whose Score prompt panel is open. */
	let saving = $state(false);
	let error = $state<string | null>(null);
	let draft = $state<ProductionState>({ status: 'empty', title: '', logline: '', premise: '', theme: '', cards: [], assets: [], updated_at: null });
	let loadedVersion = $state(-1);
	const unsaved = $derived(JSON.stringify(draft) !== JSON.stringify(project.production));
	const cloneProduction = (value: ProductionState): ProductionState => JSON.parse(JSON.stringify(value)) as ProductionState;

	/** The production the draft was last loaded from: what an unsaved edit is measured against. */
	let loadedProduction: ProductionState | null = null;
	$effect(() => {
		if (project.version !== loadedVersion || (draft.cards.length === 0 && project.production.cards.length > 0)) {
			const incoming = cloneProduction(project.production);
			// A change can arrive (from Review Room, every few seconds) while a shot is being edited: the edits are
			// kept and everything else is taken from what arrived (domain/merge-production).
			const sameProject = loadedProduction !== null && loadedVersion >= 0 && untrack(() => loadedProjectId) === project.project_id;
			draft = sameProject ? untrack(() => mergeProduction(loadedProduction!, draft, incoming)) : incoming;
			loadedVersion = project.version;
			loadedProduction = incoming;
			loadedProjectId = project.project_id;
		}
	});
	let loadedProjectId = '';

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
		if (project.production.story_plan) { error = 'Review the proposed story beats and draft their shots in the trailer plan above.'; return; }
		busy = true; error = null;
		try { const next = await request({ mode: 'generate', expected_version: project.version }); if (next.production.cards.length) tab = 'beats'; }
		catch (cause) { error = cause instanceof Error ? cause.message : 'Story build failed'; }
		finally { busy = false; }
	}

	/** Give a project from before the story plan an empty one, so it can be planned level by level. */
	async function beginPlan() {
		busy = true; error = null;
		try {
			const response = await fetch(`/api/projects/${project.project_id}/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'begin', expected_version: project.version }) });
			const result = (await response.json()) as { ok: true; data: Project } | { ok: false; error: { message: string } };
			if (!result.ok) throw new Error(result.error.message);
			onUpdated(result.data);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'The story plan could not be started'; }
		finally { busy = false; }
	}

	async function save() {
		saving = true; error = null;
		try { await request({ mode: 'save', expected_version: project.version, production: draft }); }
		catch (cause) { error = cause instanceof Error ? cause.message : 'Production save failed'; }
		finally { saving = false; }
	}
	// The selected shot: the grid marks it, the band shows its takes, the dock's Details tab edits it.
	let selectedShotId = $state('');
	let pickBusy = $state(false);
	const selectedShot = $derived(draft.cards.find((card) => card.card_id === selectedShotId) ?? null);
	const selectedPick = $derived(selectedShot ? pickFor(draft, selectedShot) : null);
	const selectedFacts = $derived(selectedShot ? shotCardFacts(selectedShot, draft.assets, selectedPick?.asset_id ?? null) : null);

	// Details: the selected shot's spec and prompts in the sections of the skill that wrote them.
	const specRows = $derived.by((): PromptSection[] => {
		const spec = selectedShot?.fit?.spec;
		if (!spec) return [];
		return [
			{ key: 'shot', label: 'Shot', text: `${SIZE_WORDS[spec.size]}, ${spec.angle}` },
			{ key: 'who', label: 'Who', text: spec.subjects.join(', ') },
			{ key: 'action', label: 'Action', text: spec.action },
			{ key: 'says', label: 'Says', text: spec.dialogue },
			{ key: 'where', label: 'Where', text: spec.location },
			{ key: 'light', label: 'Light', text: spec.light },
			{ key: 'camera', label: 'Camera', text: spec.camera_move },
			{ key: 'length', label: 'Length', text: `${spec.duration_s}s` }
		];
	});
	const videoRows = $derived(selectedShot ? (ghostSections(selectedShot.video_prompt) ?? [{ key: 'all', label: 'Prompt', text: selectedShot.video_prompt }]) : []);
	const imageRows = $derived(selectedShot ? (imageSections(selectedShot.image_prompt) ?? [{ key: 'all', label: 'Prompt', text: selectedShot.image_prompt }]) : []);
	/** Ghost's check on the video prompt as last written; an edit since then is checked again when the shot is sent. */
	const videoCheck = $derived.by(() => {
		const card = selectedShot;
		if (!card) return null;
		if (!ghostSections(card.video_prompt)) return { label: "Not in Ghost's sections", tone: 'note' as const };
		const saved = project.production.cards.find((entry) => entry.card_id === card.card_id);
		if (saved && saved.video_prompt !== card.video_prompt) return { label: 'Edited · checked on send', tone: 'note' as const };
		const found = card.fit?.qc;
		if (!found) return { label: 'Checked on send', tone: 'note' as const };
		return found.length ? { label: `${found.length} to fix`, tone: 'fix' as const, lines: found } : { label: 'Check clean', tone: 'clean' as const };
	});
	function editVideoPrompt(card: StoryCard, key: string, text: string) {
		const next = key === 'all' ? text : withGhostSection(card.video_prompt, key, text);
		updateCard(card.card_id, { video_prompt: next, ...(card.fit ? { fit: { ...card.fit, prompt_edited: true } } : {}) });
	}
	function editImagePrompt(card: StoryCard, key: string, text: string) {
		updateCard(card.card_id, { image_prompt: key === 'all' ? text : withImageSection(card.image_prompt, key, text) });
	}

	/** The viewer is open over the grid (Space, or a double-click on a shot). */
	let viewerOpen = $state(false);
	// Selecting a shot fetches its pick's proxy, so the viewer has it by the time Space is pressed.
	$effect(() => { if (selectedPick?.kind === 'video') void fetch(proxyUrl(selectedPick.url)).catch(() => null); });

	async function makePick(cardId: string, takeId: string) {
		if (pickBusy) return;
		pickBusy = true; error = null;
		try { await boardCommand({ command: 'set_pick', card_id: cardId, take_id: takeId }); }
		catch (cause) { error = cause instanceof Error ? cause.message : 'Could not change the pick'; }
		finally { pickBusy = false; }
	}

	/** A review decision made in the viewer: the shot's status, or excluding one take. Sent to Review Room at once. */
	async function reviewTake(take: ProductionAsset, change: { status?: ReviewStatus; excluded?: boolean }) {
		if (pickBusy || !take.card_id) return;
		pickBusy = true; error = null;
		// Sent at once; when Review Room cannot be reached it is kept, marked on the shot and tried again (ADR 0008).
		const result = await roomState.send(project, { take_id: take.asset_id, card_id: take.card_id, ...change });
		if (result.ok) onUpdated(result.project);
		else if (!result.kept) error = result.message;
		pickBusy = false;
	}

	// The selection (CONTEXT.md): shots gathered in the strip under the grid, played in order, pushed to a cut.
	/** The project as the grid shows it, unsaved edits included. */
	const live = $derived<Project>({ ...project, production: draft });
	let pushNote = $state('');
	/** Lengths read from the files, for takes that arrived before lengths were recorded (seconds by take id). */
	let readLengths = $state<Record<string, number>>({});
	$effect(() => {
		for (const item of reviewSequence.items) {
			const take = draft.assets.find((asset) => asset.asset_id === item.assetId);
			if (!take || take.out_s !== undefined || take.duration_s !== undefined || untrack(() => item.assetId in readLengths)) continue;
			void loadClipMetadata(take.url).then((clip) => { readLengths[item.assetId] = clip.duration; }).catch(() => null);
		}
	});

	/** Shift-click on a shot adds it to the selection, or takes it out. */
	function toggleInSelection(card: StoryCard) {
		const position = reviewSequence.position(card.card_id);
		const item = playItemFor(live, card);
		if (position) reviewSequence.remove(card.card_id);
		else if (item) reviewSequence.toggle(item);
		else pushNote = 'A still pick does not play in a selection';
	}

	// An entry follows its shot: a new pick replaces it unless a take is auditioned there; a benched or removed shot leaves.
	$effect(() => {
		const usable = new Set(draft.assets.filter((asset) => asset.kind === 'video' && !asset.rejected).map((asset) => asset.asset_id));
		const wanted = reviewSequence.items.map((item) => {
			const card = draft.cards.find((entry) => entry.card_id === item.id);
			return { id: item.id, item: card ? playItemFor(live, card) : null };
		});
		untrack(() => { for (const { id, item } of wanted) reviewSequence.sync(id, item, (assetId) => usable.has(assetId)); });
	});

	/** One button: the selection's order, takes, trims and ramps become a new cut named "Cut N". */
	async function pushSelection() {
		if (pickBusy) return;
		const built = selectionEntries(project, reviewSequence.items, readLengths);
		if (!built.ok) { pushNote = `Still reading ${built.unknown.length} ${built.unknown.length === 1 ? 'take' : 'takes'}; try again`; return; }
		pickBusy = true; error = null; pushNote = '';
		const name = nextCutName(project.production);
		try {
			const response = await fetch(`/api/projects/${project.project_id}/cuts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'push_cut', expected_version: project.version, name, entries: built.entries }) });
			const body = await response.json();
			if (!body.ok) throw new Error(body.error?.message ?? 'Push failed');
			onUpdated(body.data);
			pushNote = `Pushed as ${name}`;
		} catch (cause) { pushNote = cause instanceof Error ? cause.message : 'Push failed'; }
		finally { pickBusy = false; }
	}

	/** The notes reviewers left on a take's shot in Review Room; none when it is not stored there or cannot be read. */
	async function notesFor(take: { asset_id: string }) {
		const response = await fetch(`/api/projects/${project.project_id}/review-room`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'notes', take_id: take.asset_id }) });
		const body = (await response.json().catch(() => null)) as { ok?: boolean; notes?: import('$lib/domain/review-notes').ReviewNote[] } | null;
		return body?.ok ? (body.notes ?? []) : [];
	}

	function openViewer(cardId?: string) {
		const target = cardId ?? selectedShotId ?? draft.cards[0]?.card_id;
		if (!target) return;
		selectedShotId = target;
		viewerOpen = true;
		onOpenDetails?.();
	}

	/** Space on the Shots grid opens the viewer on the selected shot. */
	function gridKey(event: KeyboardEvent) {
		const group = event.key === 'g' || event.key === 'G';
		if (tab !== 'beats' || viewerOpen || reviewSequence.playing || (event.key !== ' ' && !group) || event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|A)$/.test(target.tagName) || (!group && target.tagName === 'BUTTON'))) return;
		if (group) { event.preventDefault(); void groupGathered(); return; }
		if (!selectedShotId && !draft.cards.length) return;
		event.preventDefault();
		openViewer(selectedShotId || draft.cards[0].card_id);
	}

	/** G: the gathered shots (the selection, else the selected shot) become a new group named "Group N", with no dialog. */
	async function groupGathered() {
		const ids = reviewSequence.items.length ? reviewSequence.items.map((item) => item.id) : selectedShotId ? [selectedShotId] : [];
		if (!ids.length || pickBusy) return;
		if (unsaved) { pushNote = 'Save the workspace before grouping'; return; }
		pickBusy = true; error = null;
		const name = nextGroupName(project.production);
		const groupId = crypto.randomUUID();
		try {
			await boardCommand({ command: 'create_group', group_id: groupId, name });
			await boardCommand({ command: 'move_beats', group_id: groupId, card_ids: ids });
			pushNote = `${ids.length === 1 ? '1 shot is' : `${ids.length} shots are`} now ${name}`;
		} catch (cause) { pushNote = cause instanceof Error ? cause.message : 'Grouping failed'; }
		finally { pickBusy = false; }
	}

	/** Shows a node inside another element of the page (the dock), keeping it part of this component. */
	function portal(node: HTMLElement, target: HTMLElement | null) {
		const place = (host: HTMLElement | null) => { if (host && node.parentNode !== host) host.appendChild(node); };
		place(target);
		return { update: place, destroy: () => node.remove() };
	}

	function updateCard(cardId: string, patch: Partial<StoryCard>) {
		draft.cards = draft.cards.map((card) => card.card_id === cardId ? { ...card, ...patch } : card);
	}

	function downloadManifest() {
		const payload = { schema: 'csp-production-manifest.v1', exported_at: new Date().toISOString(), project_id: project.project_id, project_version: project.version, production: draft };
		const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
		const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-production.json`; anchor.click();
		URL.revokeObjectURL(url);
	}

	const totalDuration = $derived(draft.cards.reduce((sum, card) => sum + card.duration_ms, 0));

	// Cuts are stored state, read from the project (not the draft) and changed only by cut commands.
	/** What the first cut to the score did, said on the Cut stage. */
	let cutNotice = $state<string | null>(null);
	const onCutStage = $derived(tab === 'cuts' || tab === 'sound' || tab === 'export');
</script>

<svelte:window onkeydown={gridKey} />

<section class={['h-full', onCutStage ? 'overflow-hidden' : 'overflow-y-auto bg-[#0b0d11]']} aria-label="Production workspace">
	<!-- The story plan carries its own bar (levels, Save, Approve); every other view keeps the workspace strip. -->
	{#if !(tab === 'story' && project.production.story_plan) && !onCutStage}
	<div class="sticky top-0 z-10 flex min-w-max items-center justify-end gap-3 border-b border-[#26333a] bg-[#10141a]/95 px-4 py-2 backdrop-blur">
		<span class="meta-label text-[#63838c]">{draft.cards.length} shots · {(totalDuration / 1000).toFixed(0)}s</span>
		<button type="button" class="btn btn-accent" onclick={() => void save()} disabled={saving || busy}>{saving ? 'Saving…' : 'Save workspace'}</button>
	</div>
	{/if}

	{#if error}<div class="mx-4 mt-3 border border-gate-failed/50 bg-gate-failed/5 px-3 py-2 text-gate-failed" role="alert">{error}</div>{/if}

	{#if tab === 'story'}
		{#if project.production.story_plan}
			<!-- A project with a story plan: the plan is the whole Story stage (brief, acts, scenes, story beats, shot list). -->
			<StoryPlan {project} {onUpdated} />
		{:else}
		<!-- An episode imported from a series, or a project from before the story plan: its own outline and notes. -->
		<div class="mx-auto max-w-4xl p-5">
			{#if project.series}
				<SeasonStructure {project} />
			<div class="mb-12"><EpisodeOutline {project} cards={draft.cards} {onUpdated} /></div>
			{:else}
				<p class="mb-6 flex flex-wrap items-center gap-3 text-[12px] text-ink-3"><button type="button" class="key go" disabled={busy} onclick={() => void beginPlan()}>Start a story plan</button>Plan this project level by level: brief, acts, scenes, story beats, shot list. Nothing on the board changes.</p>
			{/if}
			{#if !project.series}<div class="mb-8"><Pitch {project} {onUpdated} /></div>{/if}
			<details open>
				<summary class="mb-5 cursor-pointer text-sm text-[#80aeb9]">Brief and working story notes</summary>
			<div class="mb-12">
				<BriefSheet {project} {onUpdated} />
				<details class="mt-4">
					<summary class="cursor-pointer font-mono text-[10px] uppercase tracking-[.14em] text-[#5b6b70]">Stage gate · {project.stage.id} (optional)</summary>
					<div class="mt-2 max-w-md"><StageGatePanel {project} {onUpdated} /></div>
				</details>
			</div>
			<div class="flex items-start gap-4">
				<div class="grow">
					<div class="meta-label text-[#59d9cf]">{project.production.story_plan ? 'WORKING STORY NOTES' : 'DRAFT STORY SPINE'}</div>
					<h2 class="mt-2 text-xl font-semibold text-[#c7eef0]">{draft.title || project.title}</h2>
					<p class="mt-2 max-w-3xl text-[13px] leading-6 text-[#80aeb9]">{draft.logline || 'Generate the first story draft from the seed, interview evidence, and selected creative voice.'}</p>
				</div>
				{#if !project.production.story_plan}<button type="button" class="btn btn-accent" onclick={() => void generate()} disabled={busy}>{busy ? 'The Agent is building…' : draft.cards.length ? 'Rebuild story' : 'Build story draft'}</button>{/if}
			</div>
			<div class="mt-5 grid gap-4 md:grid-cols-2">
				<label class="workspace-field"><span>Premise</span><textarea bind:value={draft.premise} rows="9" placeholder="The complete dramatic premise…"></textarea></label>
				<label class="workspace-field"><span>Theme / dramatic question</span><textarea bind:value={draft.theme} rows="9" placeholder="What the story is really testing…"></textarea></label>
			</div>
			</details>
		</div>
		{/if}
	{:else if tab === 'prep'}
		<PrepWorkspace {project} {onUpdated} onContinue={() => tab = 'story'} />
	{:else if tab === 'beats'}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="relative min-h-full" ondragover={shotsDragOver} ondragleave={(event) => { if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) { dropHint = null; dropCard = null; } }} ondrop={shotsDrop}>
		{#if onAddFiles}
			<div class="flex flex-wrap items-center gap-2 border-b border-[#223039] px-4 py-2.5">
				<span class="meta-label text-[#59d9cf]">{draft.cards.length} {draft.cards.length === 1 ? 'shot' : 'shots'}</span>
				<span class="text-[11.5px] text-[#668d98]">Drop images, videos or whole folders anywhere here; each file becomes a new shot, in file-name order.</span>
				<span class="grow"></span>
				<label class="btn cursor-pointer">Add files…<input type="file" multiple accept="image/*,video/*" class="sr-only" onchange={shotsPicked} /></label>
				<label class="btn cursor-pointer">Add folder…<input type="file" multiple webkitdirectory class="sr-only" onchange={shotsPicked} /></label>
				{#if onImportRenders}<button type="button" class="btn" onclick={() => (higgsfieldOpen = true)}>From Higgsfield…</button>{/if}
			</div>
			<div class="flex flex-wrap items-center gap-2 border-b border-[#223039] px-4 py-2.5" aria-label="Score">
				<span class="meta-label text-[#59d9cf]">Score</span>
				{#if score}
					<span class="max-w-[320px] truncate text-[12px] text-[#9fc9cf]" title={score.name}>♪ {score.name}</span>
					<span class="meta-label text-[#63838c]">{clockOf(score.duration_s)}{score.bpm ? ` · ${score.bpm} BPM` : ''} · {score.beats.length} beats</span>
					{#if score.analysis?.source === 'essentia' && score.analysis.status === 'done' && score.sections?.length}
						<span class="meta-label text-[#63838c]" title={score.sections.map((s) => `${clockOf(s.start)}–${clockOf(s.end)} ${s.label} (energy ${s.energy})`).join('\n')}>Essentia · {score.sections.map((s) => s.label).join(' · ')}</span>
					{:else if score.analysis?.status === 'failed'}
						<span class="meta-label text-gate-failed" title={score.analysis.error}>Essentia failed</span>
					{/if}
					<button type="button" class="agent-mini" onclick={() => void analyseScore()} disabled={scoreBusy !== null} title="Send the score to your Essentia service for its beats, energy and sections (verse, chorus…); the first cut follows them">{scoreBusy === 'analysing' ? 'analysing…' : score.analysis?.status === 'done' ? 're-analyse' : 'analyse'}</button>
					<label class={['agent-mini cursor-pointer', scoreBusy && 'opacity-50']}>{scoreBusy === 'upload' ? 'adding…' : 'replace'}<input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.aif,.aiff" class="sr-only" disabled={scoreBusy !== null} onchange={(event) => { void uploadScore(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label>
					<button type="button" class="agent-mini" onclick={() => void removeScore()} disabled={scoreBusy !== null}>remove</button>
				{:else}
					<span class="text-[11.5px] text-[#668d98]">Add the song or score; the first cut of these shots is made to it.</span>
				{/if}
				<span class="grow"></span>
				{#if !score}
					<label class={['btn cursor-pointer', scoreBusy && 'opacity-50']}>{scoreBusy === 'upload' ? 'Adding…' : 'Add score…'}<input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.aif,.aiff" class="sr-only" disabled={scoreBusy !== null} onchange={(event) => { void uploadScore(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label>
				{/if}
				{#if tagging}
					<span class="meta-label text-[#9fc9cf]">tagging {tagging.done + 1 > tagging.total ? tagging.total : tagging.done + 1} of {tagging.total}{tagging.failed ? ` · ${tagging.failed} failed` : ''}</span>
					<button type="button" class="agent-mini" onclick={() => (stopTagging = true)}>stop</button>
				{:else if untaggedPicks.length}
					<button type="button" class="btn" onclick={() => void tagShots()} disabled={scoreBusy !== null} title="Caption each shot's pick (your caption gateway, else the Agent's model) and measure its motion, one shot at a time; the first cut is planned from these tags">Tag shots ({untaggedPicks.length})</button>
				{/if}
				<button type="button" class="btn btn-accent" onclick={() => void cutToScore()} disabled={!score || scoreBusy !== null || tagging !== null || draft.cards.length === 0} title="Plan a first cut in code from the shots' tags and the score's sections: calm shots held in quiet parts, moving shots cut fast in loud ones, every cut on a beat, the whole score covered, ending on the title card. Shots and the board are not changed.">{scoreBusy === 'cutting' ? 'Cutting…' : 'First cut to score'}</button>
			</div>
			{#if scoreError}<p class="border-b border-[#223039] px-4 py-2 text-[12px] text-gate-failed" role="alert">{scoreError}</p>{/if}
		{/if}
		{#if shotNotice}
			<p class="flex items-center gap-2 border-b border-[#223039] bg-[#0d1418] px-4 py-2 text-[12px] text-[#9fc9cf]" role="status">
				<span class="grow">{shotNotice.text}</span>
				{#if shotNotice.undo && shotNotice.undo.version === project.version}<button type="button" class="agent-mini" onclick={() => void undoRemove()} disabled={shotBusy !== null}>undo</button>{/if}
				<button type="button" class="agent-mini" onclick={() => (shotNotice = null)}>dismiss</button>
			</p>
		{/if}
		{#if higgsfieldOpen && onImportRenders}<HiggsfieldImport have={importedJobs} onImport={onImportRenders} onclose={() => (higgsfieldOpen = false)} />{/if}
		<div class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-0.5 px-2 pb-2 pt-1">
			{#each draft.cards as card (card.card_id)}
				{@const pick = pickFor(draft, card)}
				<ShotCard {card} {pick} takes={takesFor(draft, card.card_id, true)} pickBusy={pickBusy || unsaved || shotBusy !== null} onpick={(takeId) => void makePick(card.card_id, takeId)} facts={shotCardFacts(card, draft.assets, pick?.asset_id ?? null)} selected={card.card_id === selectedShotId} dropTarget={card.card_id === dropCard} position={reviewSequence.position(card.card_id)} tag={roomState.waiting(card.card_id) ? { text: 'Not sent', tone: 'bad', title: `This review has not reached Review Room yet (${roomState.waiting(card.card_id)}); it is tried again every few seconds` } : roomState.marked(card.card_id) ? { text: 'Review Room', tone: 'warn', title: 'Changed in Review Room a moment ago' } : null} onselect={(gather) => { selectedShotId = card.card_id; if (gather) toggleInSelection(card); }} onopen={() => openViewer(card.card_id)} />
			{/each}
			{#if draft.cards.length === 0}<button type="button" class="empty-action" onclick={() => void generate()} disabled={busy}>Build the story draft to create ordered cards</button>{/if}
		</div>
		{#if dropping}<div class="shots-drop-hint cp" aria-hidden="true">{dropHint}</div>{/if}
		<!-- The takes band stays put under the grid, so selecting a shot never moves the page. -->
		<div class="bands-area sticky bottom-0 z-[5] bg-panel p-1"><div class="bands">
			<TakesBand title={selectedShot?.title ?? null} facts={selectedFacts} takes={selectedShot ? takesFor(draft, selectedShot.card_id, true) : []} busy={pickBusy || unsaved || shotBusy !== null} onpick={(takeId) => selectedShot && void makePick(selectedShot.card_id, takeId)} onopen={() => onOpenDetails?.()} />
			<SelectionStrip project={live} selectedId={selectedShotId} read={readLengths} busy={pickBusy || unsaved || shotBusy !== null} note={pushNote} onselect={(cardId) => (selectedShotId = cardId)} onplay={() => { pushNote = ''; reviewSequence.playing = true; }} onpush={() => void pushSelection()} />
		</div></div>
		{#if reviewSequence.playing}<SequencePlayer {project} {onUpdated} />{/if}
		</div>
	{:else}
		<!-- The Cut stage: Picture, Sound and Export (slice 7). -->
		<CutStage {project} bind:tab {detailsHost} {onUpdated} onAgent={onOpenAgent} onManifest={draft.cards.length ? downloadManifest : undefined} notice={cutNotice} />
	{/if}
	{#if viewerOpen && tab === 'beats'}
		<Viewer production={draft} cards={draft.cards} {notesFor} notesStamp={roomState.marks[selectedShotId] ?? 0} roomHref={(cardId, take) => shotRoomLink(page.data.reviewRoomUrl, project, cardId, take)} bind:shotId={selectedShotId} busy={pickBusy || unsaved || shotBusy !== null} reviewHost={detailsHost} onclose={() => (viewerOpen = false)} onpick={(cardId, takeId) => void makePick(cardId, takeId)} onreview={(take, change) => void reviewTake(take, change)} />
	{/if}
	{#if detailsHost && !onCutStage}
		<div class="shot-details" use:portal={detailsHost}>
			{#if tab !== 'beats' || !selectedShot || !selectedFacts}
				<p class="cp none">Select a shot in the Shots grid to see its details</p>
			{:else}
				{@const card = selectedShot}
				{@const tagged = selectedPick}
				{@const roomHref = shotRoomLink(page.data.reviewRoomUrl, project, card.card_id, selectedPick)}
				<p class="cp head"><b>{selectedFacts.number}</b><span data-status={selectedFacts.status}>{selectedFacts.statusLabel}</span><span>{selectedFacts.length}</span>{#if roomHref}<a class="room" href={roomHref} target="_blank" rel="noopener" title="Open this in Review Room, where clients review">Review Room</a>{/if}</p>
				<label class="cp" for="detail-title">Title</label>
				<input id="detail-title" value={card.title} oninput={(event) => updateCard(card.card_id, { title: event.currentTarget.value })} />
				<label class="cp" for="detail-beat">Story beat</label>
				<textarea id="detail-beat" value={card.beat} oninput={(event) => updateCard(card.card_id, { beat: event.currentTarget.value })} rows="4"></textarea>
				<p class="cp">Purpose</p>
				<p class="text">{card.purpose}</p>
				{#if tagged?.tags}
					<p class="cp">Seen in the pick</p>
					<p class="text" title={[tagged.tags.place && `Place: ${tagged.tags.place}`, tagged.tags.subjects.length ? `Who: ${tagged.tags.subjects.join(', ')}` : '', tagged.tags.shot_size && `Shot: ${tagged.tags.shot_size}`, `Motion ${tagged.tags.motion}${tagged.tags.cuts ? ` · ${tagged.tags.cuts} cuts inside` : ''}`, `Tagged by ${tagged.tags.source}`].filter(Boolean).join('\n')}>{tagged.tags.caption}{tagged.tags.cuts > 3 ? ' (already an edit)' : ''}</p>
				{/if}
				{#if specRows.length}<PromptSections title="Shot spec" skill="Ghost" sections={specRows} scope={card.card_id} readonly />{/if}
				<PromptSections title="Image prompt" skill="ONE SHOT" sections={imageRows} scope={card.card_id} onedit={(key, text) => editImagePrompt(card, key, text)} />
				<PromptSections title="Video prompt" skill="Ghost" sections={videoRows} scope={card.card_id} check={videoCheck} onedit={(key, text) => editVideoPrompt(card, key, text)} />
				<MakeTake {project} {card} pick={selectedPick} {unsaved} {onUpdated} />
				<div class="actions">
					<button type="button" class="key" onclick={() => updateCard(card.card_id, { status: card.status === 'approved' ? 'draft' : 'approved' })} title="Whether this shot's writing is approved">{card.status === 'approved' ? 'Approved' : 'Draft'}</button>
					{#if tagged?.tags}<button type="button" class={['key', tagged.tags.title_card && 'on']} onclick={() => void setTitleCard(tagged.asset_id, !tagged.tags?.title_card)} disabled={shotBusy !== null} title="The title card closes the first cut as its end tag, after the music">Title card</button>{/if}
					<button type="button" class="key" onclick={() => void setBenched(card, !card.benched)} disabled={shotBusy !== null} title={card.benched ? 'Use this shot again in plays and the Agent\'s cut' : 'Keep this shot, but leave it out of plays and the Agent\'s first cut'}>{card.benched ? 'Unbench' : 'Bench'}</button>
					<button type="button" class="key danger" onclick={() => void removeShot(card)} disabled={shotBusy !== null} title="Remove this shot and its takes from the project (you can undo right after; a shot a cut uses can't be removed)">{shotBusy === card.card_id ? '…' : 'Remove'}</button>
				</div>
				<TakeReview {project} cardId={card.card_id} {onUpdated} disabled={unsaved} />
			{/if}
		</div>
	{/if}
</section>

<style>
	/* Takes and the selection sit side by side when there is room and stack when there is not; neither depends on what is selected. */
	.bands-area { container-type: inline-size; }
	.bands { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: 3px; }
	@container (max-width: 720px) { .bands { grid-template-columns: minmax(0, 1fr); } }
	.bands > :global(*) { min-width: 0; }
	.shot-details { display: flex; flex-direction: column; gap: 6px; padding: 12px; color: var(--color-ink-2); font-size: 12.5px; }
	.shot-details .cp { margin: 6px 0 0; color: var(--color-ink-3); }
	.shot-details .none { margin: 0; white-space: normal; line-height: 1.6; }
	.shot-details .head { display: flex; gap: 10px; margin: 0; }
	.shot-details .head b { font-weight: 400; color: var(--color-teal); }
	.shot-details .head .room { margin-left: auto; color: var(--color-amber); }
	.shot-details .head .room:hover { color: var(--color-ink); }
	.shot-details .head [data-status='approved'] { color: var(--color-teal); }
	.shot-details .head [data-status='awaiting'] { color: var(--color-amber); }
	.shot-details .head [data-status='changes'] { color: #ff7a6b; }
	.shot-details .head [data-status='progress'] { color: #7fb2ff; }
	.shot-details input, .shot-details textarea { width: 100%; border: 0; border-radius: 6px; background: var(--color-raised); padding: 6px 8px; color: var(--color-ink); font: 12.5px/1.5 var(--font-sans); outline: none; resize: vertical; }
	.shot-details input:focus-visible, .shot-details textarea:focus-visible { background: var(--color-control); }
	.shot-details .text { margin: 0; color: #c8c8ce; line-height: 1.5; }
	.shot-details .actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
	.shot-details .key.on { background: var(--color-teal-deep); color: var(--color-teal-ink); }
	.shot-details .key.danger { color: #ff7a6b; }
	.workspace-field { display: grid; gap: 7px; color: #63d9d0; font: 600 10px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
	.workspace-field textarea { width: 100%; border: 1px solid #26383f; background: #0d1116; color: #a8cbd2; padding: 10px; outline: none; font: 12px/1.6 var(--font-mono); }
	.workspace-field textarea:focus { border-color: #4ee8d2; }
	.agent-mini { border: 1px solid #31565d; background: #101b20; color: #71c9cf; padding: 5px 8px; font: 600 9px var(--font-mono); text-transform: uppercase; }
	.empty-action { min-height: 240px; border: 1px dashed #31565d; color: #6ca1a8; }
	/* What letting go will do, said in one line above the bands; the shot under the pointer is tinted by its card. */
	.shots-drop-hint { position: sticky; bottom: 128px; z-index: 6; width: fit-content; margin: 0 auto; border-radius: 6px; background: var(--color-selected); padding: 5px 10px; color: var(--color-teal-ink); pointer-events: none; }
</style>
