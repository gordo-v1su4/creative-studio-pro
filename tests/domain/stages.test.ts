import { expect, test } from 'bun:test';
import { STAGES, restoreTab, stageOfTab, tabForStage, viewsOfStage } from '../../src/lib/domain/stages';

test('there are four stages, in order', () => {
	expect(STAGES.map((stage) => stage.label)).toEqual(['Story', 'Prep', 'Shots', 'Cut']);
});

test('every old workspace tab belongs to one stage', () => {
	expect(stageOfTab('story')).toBe('story');
	expect(stageOfTab('prep')).toBe('prep');
	expect(stageOfTab('beats')).toBe('shots');
	expect(stageOfTab('canvas')).toBe('shots');
	expect(stageOfTab('cuts')).toBe('cut');
	expect(stageOfTab('sound')).toBe('cut');
	expect(stageOfTab('export')).toBe('cut');
});

test('Shots has a grid and a canvas; Cut has picture, sound and export', () => {
	expect(viewsOfStage('shots').map((view) => view.label)).toEqual(['Grid', 'Canvas']);
	expect(viewsOfStage('cut').map((view) => view.label)).toEqual(['Picture', 'Sound', 'Export']);
	expect(viewsOfStage('story')).toHaveLength(1);
});

test('a stage opens on the view last used there, or its first view', () => {
	expect(tabForStage('shots', {})).toBe('beats');
	expect(tabForStage('shots', { shots: 'canvas' })).toBe('canvas');
	expect(tabForStage('cut', { shots: 'canvas' })).toBe('cuts');
	// A remembered view that is not one of the stage's own is ignored.
	expect(tabForStage('cut', { cut: 'canvas' })).toBe('cuts');
});

test('a saved tab from any earlier layout is restored to a tab that exists', () => {
	expect(restoreTab('sound')).toBe('sound');
	expect(restoreTab('board')).toBe('canvas');
	expect(restoreTab('shots')).toBe('beats');
	expect(restoreTab('cards')).toBe('beats');
	expect(restoreTab('media')).toBe('beats');
	expect(restoreTab('preview')).toBe('cuts');
	expect(restoreTab('nonsense')).toBeNull();
	expect(restoreTab(null)).toBeNull();
});
