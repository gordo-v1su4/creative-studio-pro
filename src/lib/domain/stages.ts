/**
 * The four stages a project moves through (CONTEXT.md: Stage), and the views inside each.
 * A view is one of the workspace tabs the app already had; a stage groups them.
 */

export type WorkspaceTab = 'story' | 'prep' | 'beats' | 'canvas' | 'cuts' | 'sound' | 'export';
export type StageId = 'story' | 'prep' | 'shots' | 'cut';
export type StageView = { tab: WorkspaceTab; label: string };
export type Stage = { id: StageId; label: string; views: StageView[] };

export const STAGES: Stage[] = [
	{ id: 'story', label: 'Story', views: [{ tab: 'story', label: 'Story' }] },
	{ id: 'prep', label: 'Prep', views: [{ tab: 'prep', label: 'Prep' }] },
	{ id: 'shots', label: 'Shots', views: [{ tab: 'beats', label: 'Grid' }, { tab: 'canvas', label: 'Canvas' }] },
	{ id: 'cut', label: 'Cut', views: [{ tab: 'cuts', label: 'Picture' }, { tab: 'sound', label: 'Sound' }, { tab: 'export', label: 'Export' }] }
];

const ALL_TABS = STAGES.flatMap((stage) => stage.views.map((view) => view.tab));

/** Tab names saved by earlier layouts, and the word links use for the canvas. */
const EARLIER_NAMES: Record<string, WorkspaceTab> = { board: 'canvas', shots: 'beats', cards: 'beats', media: 'beats', preview: 'cuts' };

export function stageOfTab(tab: WorkspaceTab): StageId {
	return STAGES.find((stage) => stage.views.some((view) => view.tab === tab))!.id;
}

export function viewsOfStage(stage: StageId): StageView[] {
	return STAGES.find((item) => item.id === stage)!.views;
}

/** The view a stage opens on: the one last used there, else its first. */
export function tabForStage(stage: StageId, lastUsed: Partial<Record<StageId, WorkspaceTab>>): WorkspaceTab {
	const views = viewsOfStage(stage);
	const remembered = lastUsed[stage];
	return views.some((view) => view.tab === remembered) ? remembered! : views[0].tab;
}

/** A tab name read from storage or a link, as a tab that exists today; null when it names nothing. */
export function restoreTab(saved: string | null | undefined): WorkspaceTab | null {
	if (!saved) return null;
	if (saved in EARLIER_NAMES) return EARLIER_NAMES[saved];
	return ALL_TABS.find((tab) => tab === saved) ?? null;
}
