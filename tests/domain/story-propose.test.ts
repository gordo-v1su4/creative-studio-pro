import { expect, test } from 'bun:test';
import { applyProposedActs, applyProposedBeats, applyProposedScenes, applyProposedShots, fitDurations, proposeBlocked } from '../../src/lib/domain/story-propose';
import { storyPlanSchema, type StoryPlan } from '../../src/lib/domain/story-plan';

const plan = (sections: unknown[]): StoryPlan => storyPlanSchema.parse({ title: 'Late Fees', sections });
const act = (id: string, over: Record<string, unknown> = {}) => ({ id, title: id, summary: '', scenes: [], moments: [], ...over });
const beat = (id: string, scene_id: string, over: Record<string, unknown> = {}) => ({ id, title: id, beat: 'x', duration_s: 6, scene_id, ...over });

test('proposed acts replace the starting acts only while those are empty', () => {
	const fresh = plan([act('a1'), act('a2'), act('a3')]);
	const done = applyProposedActs(fresh, [{ title: 'Cold open', summary: 'The aftermath.' }, { title: 'The rule', summary: 'Why it matters.' }]);
	if (!done.ok) throw new Error(done.why);
	expect(done.added).toBe(2);
	expect(done.plan.sections.map((section) => [section.title, section.summary])).toEqual([['Cold open', 'The aftermath.'], ['The rule', 'Why it matters.']]);
	const started = plan([act('a1', { scenes: [{ id: 's1', title: 'Video Haven' }] })]);
	expect(applyProposedActs(started, [{ title: 'New', summary: '' }])).toEqual({ ok: false, why: 'The acts already hold scenes or story beats; change them by hand, or tell the Agent what to change' });
});

test('proposed scenes fill the acts that have none and leave the others exactly as they were', () => {
	const mine = { id: 's1', title: 'Video Haven, 2:47 AM', scene_code: 'VHA' };
	const start = plan([act('a1', { scenes: [mine] }), act('a2'), act('a3')]);
	const done = applyProposedScenes(start, [{ act_id: 'a1', title: 'Should not land' }, { act_id: 'a2', title: 'Campus' }, { act_id: 'a2', title: 'Class' }, { act_id: 'nope', title: 'Lost' }]);
	if (!done.ok) throw new Error(done.why);
	expect(done.added).toBe(2);
	expect(done.plan.sections[0].scenes).toEqual([mine]);
	expect(done.plan.sections[1].scenes.map((scene) => scene.title)).toEqual(['Campus', 'Class']);
	expect(done.plan.sections[1].scenes.every((scene) => !scene.scene_code)).toBe(true);
	expect(done.plan.sections[2].scenes).toEqual([]);
	expect(proposeBlocked(plan([act('a1', { scenes: [mine] })]), 'scenes')).toBe('Every act already has scenes');
});

test('proposed story beats fill the scenes that have none, arrive proposed, and keep an approved beat approved', () => {
	const kept = beat('b1', 's1', { approved: true, shots: [{ id: 'sh1', title: 'Wide', beat: 'x', duration_s: 6 }] });
	const start = plan([act('a1', { scenes: [{ id: 's1', title: 'One' }, { id: 's2', title: 'Two' }], moments: [kept] })]);
	const done = applyProposedBeats(start, [
		{ scene_id: 's1', title: 'Should not land', beat: 'x', duration_s: 4, characters: [], location: '' },
		{ scene_id: 's2', title: 'The walk', beat: 'Kai walks.', duration_s: 5, characters: ['Kai'], location: 'Campus' }
	]);
	if (!done.ok) throw new Error(done.why);
	expect(done.added).toBe(1);
	const moments = done.plan.sections[0].moments;
	expect(moments[0]).toMatchObject({ id: 'b1', approved: true });
	expect(moments[0].shots).toHaveLength(1);
	expect(moments[1]).toMatchObject({ title: 'The walk', scene_id: 's2', approved: false, shots: [], characters: ['Kai'] });
	expect(proposeBlocked(plan([act('a1')]), 'beats')).toBe('Add or propose scenes first');
});

test('proposed shots fill the story beats that have none', () => {
	const start = plan([act('a1', { scenes: [{ id: 's1', title: 'One' }], moments: [beat('b1', 's1', { shots: [{ id: 'sh1', title: 'Mine', beat: 'x', duration_s: 6 }] }), beat('b2', 's1')] })]);
	const done = applyProposedShots(start, [{ beat_id: 'b1', title: 'No', beat: 'x', duration_s: 6 }, { beat_id: 'b2', title: 'Kai', beat: 'His face.', duration_s: 3 }, { beat_id: 'b2', title: 'Door', beat: 'The door.', duration_s: 3 }]);
	if (!done.ok) throw new Error(done.why);
	expect(done.plan.sections[0].moments[0].shots.map((shot) => shot.title)).toEqual(['Mine']);
	expect(done.plan.sections[0].moments[1].shots.map((shot) => shot.title)).toEqual(['Kai', 'Door']);
	expect(proposeBlocked(done.plan, 'shots')).toBe('Every story beat already has shots');
	expect(proposeBlocked(plan([act('a1')]), 'shots')).toBe('Add or propose story beats first');
});

test('lengths a little off their total are nudged onto it; far off, they are refused', () => {
	expect(fitDurations([{ duration_s: 10 }, { duration_s: 10 }, { duration_s: 11 }], 30)?.reduce((sum, item) => sum + item.duration_s, 0)).toBe(30);
	expect(fitDurations([{ duration_s: 3 }, { duration_s: 3 }], 6)).toEqual([{ duration_s: 3 }, { duration_s: 3 }]);
	expect(fitDurations([{ duration_s: 10 }, { duration_s: 10 }], 30)).toBeNull();
	expect(fitDurations([], 30)).toBeNull();
});
