import { expect, test } from 'bun:test';
import {
	applyLevelApproval, approveLabel, assignSceneCodes, assignShotNumbers, canApprove, keepFixedNames, levelCounts, levelNextLine, levelOpen, levelStates, levelSummary, levelsOf, lockNotice, lockViolations,
	nextLevel, placedGroups, planNames, sceneCodeFor, sceneCodeOfGroup, sceneLabel, shotCodeOf, shotListAsItStands, storyNextLine, STORY_LEVELS, type LevelApprovals
} from '../../src/lib/domain/story-levels';
import { projectSchema, type Project } from '../../src/lib/domain/schemas';

const counts = (over: Partial<Record<(typeof STORY_LEVELS)[number], number>> = {}) => ({ brief: 1, acts: 3, scenes: 4, beats: 9, shots: 20, ...over });
const NOW = '2026-11-23T00:00:00.000Z';

test('the story plan has five levels, in the order they are approved', () => {
	expect([...STORY_LEVELS]).toEqual(['brief', 'acts', 'scenes', 'beats', 'shots']);
});

test('a level is empty until it holds something, proposed until approved', () => {
	expect(levelStates(counts({ scenes: 0, beats: 0, shots: 0 }), { brief: NOW })).toEqual({ brief: 'approved', acts: 'proposed', scenes: 'empty', beats: 'empty', shots: 'empty' });
});

test('an approval of something that is no longer there does not count', () => {
	expect(levelStates(counts({ acts: 0 }), { brief: NOW, acts: NOW }).acts).toBe('empty');
});

test('something added to an approved level waits for approval again', () => {
	const approvals = { brief: NOW, acts: NOW, scenes: NOW };
	expect(levelStates(counts(), approvals, { scenes: 1 }).scenes).toBe('proposed');
	expect(levelStates(counts(), approvals, { scenes: 0 }).scenes).toBe('approved');
});

test('the next level to deal with is the first one not approved', () => {
	expect(nextLevel(levelStates(counts(), {}))).toBe('brief');
	expect(nextLevel(levelStates(counts(), { brief: NOW, acts: NOW }))).toBe('scenes');
	expect(nextLevel(levelStates(counts(), { brief: NOW, acts: NOW, scenes: NOW, beats: NOW, shots: NOW }))).toBeNull();
});

test('a level is approved in order, and only when it holds something', () => {
	const states = levelStates(counts({ beats: 0 }), { brief: NOW });
	expect(canApprove('acts', states)).toEqual({ ok: true });
	expect(canApprove('scenes', states)).toEqual({ ok: false, why: 'Approve the acts first' });
	expect(canApprove('beats', levelStates(counts({ beats: 0 }), { brief: NOW, acts: NOW, scenes: NOW }))).toEqual({ ok: false, why: 'There are no story beats to approve yet' });
	expect(canApprove('brief', states)).toEqual({ ok: false, why: 'The brief is already approved' });
	expect(canApprove('acts', levelStates(counts(), { brief: NOW, acts: NOW }))).toEqual({ ok: false, why: 'The acts are already approved' });
});

test('before a level is approved, it says which names will be fixed', () => {
	expect(lockNotice('brief')).toBe('Approving the brief fixes the show code and the project code. Titles can still change.');
	expect(lockNotice('scenes')).toBe('Approving the scenes fixes each scene code. Titles can still change.');
	expect(lockNotice('shots')).toBe('Approving the shot list fixes each shot code. Titles can still change.');
	expect(lockNotice('acts')).toBe('Approving the acts fixes no names.');
	expect(lockNotice('beats')).toBe('Approving the story beats fixes no names.');
});

test('each level says where it stands in a word or two, and its button says what approving covers', () => {
	expect(levelSummary('scenes', 'empty', 0)).toBe('');
	expect(levelSummary('scenes', 'proposed', 5)).toBe('5 proposed');
	expect(levelSummary('acts', 'approved', 3)).toBe('3 approved');
	expect(levelSummary('brief', 'proposed', 1)).toBe('Proposed');
	expect(levelSummary('brief', 'approved', 1)).toBe('Approved');
	expect(levelSummary('scenes', 'proposed', 6, 1, true)).toBe('1 new');
	expect(approveLabel('brief', 1)).toBe('Approve brief');
	expect(approveLabel('scenes', 5)).toBe('Approve 5 scenes');
	expect(approveLabel('beats', 1)).toBe('Approve 1 story beat');
	expect(approveLabel('shots', 20)).toBe('Approve 20 shots');
	expect(approveLabel('beats', 0)).toBe('Approve story beats');
	expect(approveLabel('scenes', 6, 1, true)).toBe('Approve 1 new scene');
	expect(approveLabel('shots', 22, 2, true)).toBe('Approve 2 new shots');
});

test('the Next line follows the levels until all five are approved', () => {
	expect(levelNextLine(levelStates(counts({ brief: 0 }), {}))).toBe('Say the idea, and the Agent drafts the brief');
	expect(levelNextLine(levelStates(counts(), {}))).toBe('Approve the brief, then acts');
	expect(levelNextLine(levelStates(counts(), { brief: NOW, acts: NOW }))).toBe('Approve the scenes, then story beats');
	expect(levelNextLine(levelStates(counts({ beats: 0, shots: 0 }), { brief: NOW, acts: NOW, scenes: NOW }))).toBe('Propose the story beats');
	expect(levelNextLine(levelStates(counts(), { brief: NOW, acts: NOW, scenes: NOW, beats: NOW }))).toBe('Approve the shot list');
	expect(levelNextLine(levelStates(counts(), { brief: NOW, acts: NOW, scenes: NOW, beats: NOW, shots: NOW }))).toBeNull();
});

test('a scene code is three capitals made from its title, and each scene gets its own', () => {
	expect(sceneCodeFor('Video Haven, 2:47 AM', [])).toBe('VHA');
	expect(sceneCodeFor('Campus', [])).toBe('CMP');
	// Two words: two letters of the first, one of the second, as show codes are made (Blood Rush → BLR).
	expect(sceneCodeFor('The rooftop leap', [])).toBe('RFL');
	expect(sceneCodeFor('Campus', ['CMP'])).not.toBe('CMP');
	expect(sceneCodeFor('Campus', ['CMP'])).toMatch(/^[A-Z]{3}$/);
	expect(sceneCodeFor('—', [])).toMatch(/^[A-Z]{3}$/);
});

test('approving the scenes gives every uncoded scene a code and never touches one already given', () => {
	const coded = assignSceneCodes([{ id: 's1', title: 'Video Haven', scene_code: 'VHS' }, { id: 's2', title: 'Campus' }, { id: 's3', title: 'Campus at night' }]);
	expect(coded[0].scene_code).toBe('VHS');
	expect(coded[1].scene_code).toBe('CMP');
	expect(coded[2].scene_code).toMatch(/^[A-Z]{3}$/);
	expect(new Set(coded.map((scene) => scene.scene_code)).size).toBe(3);
	// A code that already names something elsewhere (a Review Room folder) is not handed out.
	expect(assignSceneCodes([{ id: 's2', title: 'Campus' }], ['CMP'])[0].scene_code).not.toBe('CMP');
});

test('approving the shot list numbers each scene in tens, keeping numbers already given and never reusing one', () => {
	const numbered = assignShotNumbers([
		{ id: 'a', scene: 's1' }, { id: 'b', scene: 's1', number: 20 }, { id: 'c', scene: 's1' },
		{ id: 'd', scene: 's2' }, { id: 'e', scene: 's2' }
	]);
	expect(numbered).toEqual({ a: 10, b: 20, c: 30, d: 10, e: 20 });
	// A shot added between two numbered ones takes a number between them, as on a real shot list.
	expect(assignShotNumbers([{ id: 'a', scene: 's1', number: 10 }, { id: 'x', scene: 's1' }, { id: 'b', scene: 's1', number: 20 }])).toEqual({ a: 10, x: 15, b: 20 });
	// With no room left between two numbers, it goes after the last one.
	expect(assignShotNumbers([{ id: 'a', scene: 's1', number: 10 }, { id: 'x', scene: 's1' }, { id: 'b', scene: 's1', number: 11 }])).toEqual({ a: 10, x: 20, b: 11 });
	// A number a shot once had (it was removed, or moved to another scene) is never given again.
	expect(assignShotNumbers([{ id: 'a', scene: 's1', number: 10 }, { id: 'x', scene: 's1' }], { s1: [20] })).toEqual({ a: 10, x: 30 });
	expect(assignShotNumbers([{ id: 'x', scene: 's1' }, { id: 'b', scene: 's1', number: 20 }], { s1: [10] })).toEqual({ x: 15, b: 20 });
});

const approvals: LevelApprovals = { brief: NOW, acts: NOW, scenes: NOW };

test('once its level is approved a code cannot change; a title can', () => {
	const before = { show: 'BLR', project: 'TR130', scenes: { s1: 'VHS', s2: 'CMP' }, shots: { a: 'VHS_0010' } };
	expect(lockViolations(approvals, before, { ...before })).toEqual([]);
	expect(lockViolations(approvals, before, { ...before, show: 'XYZ' })).toEqual(['The show code is fixed at BLR']);
	expect(lockViolations(approvals, before, { ...before, project: 'TR131' })).toEqual(['The project code is fixed at TR130']);
	expect(lockViolations(approvals, before, { ...before, scenes: { s1: 'VHX', s2: 'CMP' } })).toEqual(['Scene code VHS is fixed']);
	expect(lockViolations(approvals, before, { ...before, scenes: { s1: null, s2: 'CMP' } })).toEqual(['Scene code VHS is fixed']);
	expect(lockViolations(approvals, before, { ...before, scenes: { s2: 'CMP', s9: 'VHS' } })).toEqual(['Scene code VHS belongs to another scene and cannot be given again']);
});

test('a level that is not approved yet can still change its codes, and new things can always be added', () => {
	const before = { show: 'BLR', project: 'TR130', scenes: { s1: 'VHS' }, shots: { a: 'VHS_0010' } };
	// The shot list is not approved: shot codes may still move.
	expect(lockViolations(approvals, before, { ...before, shots: { a: 'VHS_0020' } })).toEqual([]);
	expect(lockViolations({ ...approvals, shots: NOW }, before, { ...before, shots: { a: 'VHS_0020' } })).toEqual(['Shot code VHS_0010 is fixed']);
	// A new scene or shot is not a change to a fixed one.
	expect(lockViolations({ ...approvals, shots: NOW }, before, { ...before, scenes: { s1: 'VHS', s2: 'NEW' }, shots: { a: 'VHS_0010', b: 'VHS_0020' } })).toEqual([]);
	// A removed scene takes its code with it; the code is not handed to another scene.
	expect(lockViolations(approvals, before, { ...before, scenes: {} })).toEqual([]);
	// Before the brief is approved the show and project codes are still open.
	expect(lockViolations({}, before, { ...before, show: 'XYZ', project: 'TR131', scenes: { s1: 'ABC' } })).toEqual([]);
});

// --- On a project ---------------------------------------------------------------------------------------------

const brief = { brief_id: 'b1', version: 1, title: 'Blood Rush', slug: 'blood-rush', logline: 'Kai breaks blood law.', format: { type: 'Teaser', runtime: '30s', aspect: '16:9', platform: 'Web' }, tone_visual_rules: 'Night.', must_haves: ['Kai'], must_nots: ['Daylight'], success_criteria: ['It plays'], content_hash: 'a'.repeat(64), created_at: NOW };
const card = (card_id: string, group_id: string, order: number, over: Record<string, unknown> = {}) => ({ card_id, group_id, order, title: card_id, beat: 'x', purpose: 'x', duration_ms: 3000, image_prompt: 'x', video_prompt: 'x', ...over });

function project(over: { levels?: unknown; brief?: boolean; plan?: unknown; cards?: unknown[]; groups?: unknown[]; room?: unknown } = {}): Project {
	return projectSchema.parse({
		schema_version: 1, project_id: 'p1', title: 'Blood Rush · Teaser', created_at: NOW, updated_at: NOW, version: 3,
		stage: { id: 'S0', state: 'BLOCKED', confidence: null },
		seed: { seed_id: 's1', title: 'Blood Rush · Teaser', brief: 'A vampire thing in a video store.', creative_focus: 'full room', created_by: 'test' },
		...(over.brief === false ? {} : { brief_state: { versions: [brief], current_version: 1 } }),
		...(over.room ? { review_room: over.room } : {}),
		production: {
			...(over.levels ? { story_levels: over.levels } : {}),
			groups: over.groups ?? [],
			cards: over.cards ?? [],
			story_plan: over.plan ?? {
				title: 'Blood Rush · Teaser',
				sections: [
					{ id: 'act1', title: 'Act 1 · Cold open', summary: '', scenes: [{ id: 'vh', title: 'Video Haven, 2:47 AM' }], moments: [
						{ id: 'm1', title: 'The floor', beat: 'Mara on the floor.', duration_s: 8, scene_id: 'vh', approved: false, shots: [{ id: 'sh1', title: 'Wide', beat: 'The store, dark.', duration_s: 4 }, { id: 'sh2', title: 'Mara', beat: 'Her face.', duration_s: 4 }] }
					] },
					{ id: 'act2', title: 'Act 2 · The rule', summary: '', scenes: [{ id: 'cmp', title: 'Campus' }], moments: [
						{ id: 'm2', title: 'The walk', beat: 'Kai walks.', duration_s: 6, scene_id: 'cmp', approved: false, shots: [{ id: 'sh3', title: 'Kai walks', beat: 'Kai crosses the quad.', duration_s: 6 }] }
					] }
				]
			}
		}
	});
}

test('what each level holds is read from the project', () => {
	expect(levelCounts(project())).toEqual({ brief: 1, acts: 2, scenes: 2, beats: 2, shots: 3 });
	expect(levelCounts(project({ brief: false }))).toMatchObject({ brief: 0 });
	// What still waits in each level: scenes with no code, story beats not approved, shots with no shot code.
	expect(levelOpen(project())).toEqual({ scenes: 2, beats: 2, shots: 3 });
	expect(levelsOf(project())).toEqual({ brief: 'proposed', acts: 'proposed', scenes: 'proposed', beats: 'proposed', shots: 'proposed' });
});

test('approving the brief fixes the show code and the project code, suggested from the title or as given', () => {
	const approved = applyLevelApproval(project(), 'brief', NOW);
	expect(approved.production.story_levels).toEqual({ approved: { brief: NOW }, show_code: 'BLR', project_code: 'TR100' });
	expect(applyLevelApproval(project(), 'brief', NOW, { show_code: 'BRH', project_code: 'TR130' }).production.story_levels).toMatchObject({ show_code: 'BRH', project_code: 'TR130' });
	expect(() => applyLevelApproval(project(), 'brief', NOW, { show_code: 'blr' })).toThrow('A show code is three capital letters');
	expect(() => applyLevelApproval(project(), 'brief', NOW, { project_code: 'T1' })).toThrow('A project code is TR or EP and three digits, like TR100');
	expect(() => applyLevelApproval(approved, 'brief', NOW)).toThrow('The brief is already approved');
	expect(() => applyLevelApproval(project({ brief: false }), 'brief', NOW)).toThrow('There is no brief to approve yet');
});

test('a project already in Review Room keeps the codes it has there', () => {
	const room = { project_id: 'room', folder_id: 'folder', code: 'TR130', show_code: 'BLR', shots: {} };
	expect(applyLevelApproval(project({ room }), 'brief', NOW).production.story_levels).toMatchObject({ show_code: 'BLR', project_code: 'TR130' });
	expect(() => applyLevelApproval(project({ room }), 'brief', NOW, { show_code: 'XYZ' })).toThrow('Review Room already knows this project as BLR TR130');
});

test('levels are approved in order', () => {
	expect(() => applyLevelApproval(project(), 'scenes', NOW)).toThrow('Approve the brief first');
});

function approvedThrough(level: 'acts' | 'scenes' | 'beats' | 'shots', start = project()): Project {
	let next = start;
	for (const step of STORY_LEVELS.slice(0, STORY_LEVELS.indexOf(level) + 1)) next = applyLevelApproval(next, step, NOW);
	return next;
}

test('approving the scenes gives each scene its code, once', () => {
	const approved = approvedThrough('scenes');
	const scenes = approved.production.story_plan!.sections.flatMap((section) => section.scenes);
	expect(scenes.map((scene) => scene.scene_code)).toEqual(['VHA', 'CMP']);
	expect(levelsOf(approved).scenes).toBe('approved');
	// A scene added afterwards waits; approving again names only the new one.
	const more = structuredClone(approved);
	more.production.story_plan!.sections[1].scenes.push({ id: 'cls', title: 'Kai and Malachi in class' });
	expect(levelsOf(more).scenes).toBe('proposed');
	const again = applyLevelApproval(more, 'scenes', '2026-11-24T00:00:00.000Z');
	expect(again.production.story_plan!.sections.flatMap((section) => section.scenes).map((scene) => scene.scene_code)).toEqual(['VHA', 'CMP', 'KMC']);
});

test('approving the story beats approves each one', () => {
	const approved = approvedThrough('beats');
	expect(approved.production.story_plan!.sections.flatMap((section) => section.moments).every((moment) => moment.approved)).toBe(true);
});

test('approving the shot list puts the planned shots on the board and gives each its code, once', () => {
	const approved = approvedThrough('shots');
	expect(approved.production.cards.map((entry) => [entry.title, entry.scene_code, entry.shot_number])).toEqual([['Wide', 'VHA', 10], ['Mara', 'VHA', 20], ['Kai walks', 'CMP', 10]]);
	expect(approved.production.cards.map((entry) => shotCodeOf(approved, entry))).toEqual(['BLR_TR100_VHA_0010', 'BLR_TR100_VHA_0020', 'BLR_TR100_CMP_0010']);
	expect(levelsOf(approved)).toEqual({ brief: 'approved', acts: 'approved', scenes: 'approved', beats: 'approved', shots: 'approved' });
	expect(nextLevel(levelsOf(approved))).toBeNull();
	// A shot planned afterwards waits, and takes a number of its own when the list is approved again.
	const more = structuredClone(approved);
	more.production.story_plan!.sections[0].moments[0].shots.push({ id: 'sh4', title: 'The door', beat: 'Malachi in the doorway.', duration_s: 2 });
	expect(levelsOf(more).shots).toBe('proposed');
	const again = applyLevelApproval(more, 'shots', '2026-11-24T00:00:00.000Z');
	expect(again.production.cards.map((entry) => [entry.title, entry.scene_code, entry.shot_number])).toEqual([['Wide', 'VHA', 10], ['Mara', 'VHA', 20], ['Kai walks', 'CMP', 10], ['The door', 'VHA', 30]]);
});

test('a shot moved to another scene keeps its code, and its old number is not given again', () => {
	const approved = approvedThrough('shots');
	const moved = structuredClone(approved);
	const mara = moved.production.cards.find((entry) => entry.title === 'Mara')!;
	mara.group_id = moved.production.cards.find((entry) => entry.title === 'Kai walks')!.group_id;
	expect(shotCodeOf(moved, mara)).toBe('BLR_TR100_VHA_0020');
	moved.production.story_plan!.sections[0].moments[0].shots.push({ id: 'sh4', title: 'The door', beat: 'x', duration_s: 2 });
	const again = applyLevelApproval(moved, 'shots', NOW);
	expect(again.production.cards.find((entry) => entry.title === 'The door')).toMatchObject({ scene_code: 'VHA', shot_number: 30 });
});

test('the names a project holds, and the scene code of a board group', () => {
	const approved = approvedThrough('shots');
	const names = planNames(approved);
	expect(names).toMatchObject({ show: 'BLR', project: 'TR100', scenes: { vh: 'VHA', cmp: 'CMP' } });
	expect(Object.values(names.shots)).toEqual(['VHA_0010', 'VHA_0020', 'CMP_0010']);
	expect(sceneCodeOfGroup(approved, 'plan-scene-vh')).toBe('VHA');
	expect(sceneCodeOfGroup(approved, 'some-pool')).toBeNull();
	// Review Room's own scene folders count too (a trailer set up before the story plan had scenes).
	const room = { project_id: 'room', folder_id: 'folder', code: 'TR130', show_code: 'BLR', shots: { c1: { code: 'BLR_TR130_MRN_0020', folder_id: 'f' } }, scenes: { 'seq-1': { code: 'MRN', folder_id: 'f' } } };
	const stored = project({ room, groups: [{ group_id: 'seq-1', name: 'Morning', created_at: NOW }], cards: [card('c1', 'seq-1', 0)] });
	expect(sceneCodeOfGroup(stored, 'seq-1')).toBe('MRN');
	expect(shotCodeOf(stored, stored.production.cards[0])).toBe('BLR_TR130_MRN_0020');
	expect(planNames(stored).shots).toEqual({ c1: 'MRN_0020' });
});

test('a save that comes back without a fixed code gets it put back; nobody else may write approvals', () => {
	const approved = approvedThrough('shots');
	const stale = structuredClone(approved.production);
	stale.story_levels = { approved: {} };
	stale.cards[0].shot_number = undefined; stale.cards[0].scene_code = undefined;
	stale.story_plan!.sections[0].scenes[0].scene_code = undefined;
	stale.cards[1].title = 'Mara, closer';
	const kept = keepFixedNames(approved.production, stale);
	expect(kept.story_levels).toEqual(approved.production.story_levels);
	expect(kept.cards[0]).toMatchObject({ scene_code: 'VHA', shot_number: 10 });
	expect(kept.cards[1]).toMatchObject({ title: 'Mara, closer', scene_code: 'VHA', shot_number: 20 });
	expect(kept.story_plan!.sections[0].scenes[0].scene_code).toBe('VHA');
	// A different code is not put back: it is refused by the lock.
	const changed = structuredClone(approved.production);
	changed.cards[0].shot_number = 40;
	const after = { ...approved, production: keepFixedNames(approved.production, changed) };
	expect(lockViolations(approved.production.story_levels!.approved, planNames(approved), planNames(after))).toEqual(['Shot code VHA_0010 is fixed']);
});

test('the Next line comes from the story plan while a project is being planned here', () => {
	expect(storyNextLine(project())).toBe('Approve the brief, then acts');
	expect(storyNextLine(approvedThrough('shots'))).toBeNull();
	// A project whose shots came another way, with nothing approved, keeps the line about its shots.
	expect(storyNextLine(project({ groups: [{ group_id: 'pool', name: 'Pool', created_at: NOW }], cards: [card('c1', 'pool', 0)] }))).toBeNull();
});

test('the outline lists scenes with their codes in story order, then the groups that are not scenes', () => {
	const approved = approvedThrough('shots');
	const groups = [{ group_id: '', name: 'Main' }, { group_id: 'pool', name: 'Clips from the shoot' }, { group_id: 'plan-scene-cmp', name: 'Campus' }, { group_id: 'plan-scene-vh', name: 'Video Haven' }];
	const placed = placedGroups(approved, groups);
	expect(placed.scenes.map((group) => [group.code, group.title])).toEqual([['VHA', 'Video Haven, 2:47 AM'], ['CMP', 'Campus']]);
	expect(placed.unplaced.map((group) => group.name)).toEqual(['Main', 'Clips from the shoot']);
});

test('a project still called by its first sentence takes the brief\'s title when the brief is approved', () => {
	const fresh = { ...project(), title: 'A vampire thing in a video store' };
	fresh.seed = { ...fresh.seed, brief: 'A vampire thing in a video store.' };
	const approved = applyLevelApproval(fresh, 'brief', NOW);
	expect(approved.title).toBe('Blood Rush');
	expect(approved.production.story_plan!.title).toBe('Blood Rush');
	// A project the operator named keeps its name.
	expect(applyLevelApproval(project(), 'brief', NOW).title).toBe('Blood Rush · Teaser');
});

test('the shot list as it stands: plan shots where the plan has them, else the board shots of each scene, in board order', () => {
	const room = { project_id: 'room', folder_id: 'f', code: 'TR130', show_code: 'BLR', scenes: { 'g-cmp': { code: 'CMP', folder_id: 'f' } }, shots: { c2: { code: 'BLR_TR130_CMP_0020', folder_id: 'f' }, c3: { code: 'BLR_TR130_CMP_0010', folder_id: 'f' } } };
	const plan = {
		title: 'TR130',
		sections: [
			{ id: 'act1', title: 'Act 1', summary: '', scenes: [{ id: 'vh', title: 'Video Haven', group_id: 'g-vh', scene_code: 'VHA' }], moments: [
				{ id: 'm1', title: 'The floor', beat: 'x', duration_s: 4, scene_id: 'vh', approved: true, shots: [{ id: 'sh1', title: 'Wide', beat: 'x', duration_s: 4, card_id: 'c1' }, { id: 'sh2', title: 'Close', beat: 'x', duration_s: 2 }] }
			] },
			{ id: 'act2', title: 'Act 2', summary: '', scenes: [{ id: 'cmp', title: 'Campus', group_id: 'g-cmp', scene_code: 'CMP' }, { id: 'empty', title: 'Nowhere', group_id: 'g-none' }], moments: [] }
		]
	};
	const p = project({ room, plan, cards: [card('c1', 'g-vh', 0, { title: 'Wide', scene_code: 'VHA', shot_number: 10 }), card('c2', 'g-cmp', 3, { title: 'Kai' }), card('c3', 'g-cmp', 2, { title: 'Quad' }), card('c4', undefined as unknown as string, 4, { title: 'Loose', group_id: undefined })] });
	const list = shotListAsItStands(p);
	expect(list.acts.map((act) => [act.title, act.scenes.map((scene) => [scene.code, scene.title, scene.from, scene.shots.map((shot) => [shot.code, shot.title, shot.planned])])])).toEqual([
		['Act 1', [['VHA', 'Video Haven', 'plan', [['BLR_TR130_VHA_0010', 'Wide', false], [null, 'Close', true]]]]],
		['Act 2', [['CMP', 'Campus', 'board', [['BLR_TR130_CMP_0010', 'Quad', false], ['BLR_TR130_CMP_0020', 'Kai', false]]], [null, 'Nowhere', 'board', []]]]
	]);
	expect(list.acts[1].scenes[0].shots[0]).toMatchObject({ id: 'c3', card_id: 'c3', duration_s: 3 });
	// Board shots in no scene of the plan are listed after, as they are.
	expect(list.unplaced.map((shot) => [shot.code, shot.title])).toEqual([[null, 'Loose']]);
	expect(list.count).toBe(5);
});

test('a board group that is a plan scene is called by its scene code and title; any other group keeps its name', () => {
	const plan = { title: 'TR130', sections: [{ id: 'a1', title: 'Act 1', summary: '', scenes: [{ id: 's1', title: 'The sealed drop and the hood', group_id: 'g1', scene_code: 'DRP' }, { id: 's2', title: 'No code yet', group_id: 'g2' }], moments: [] }] };
	const room = { project_id: 'r', folder_id: 'f', code: 'TR130', show_code: 'BLR', scenes: { g1: { code: 'DRP', folder_id: 'f' } }, shots: {} };
	const p = project({ plan, room, groups: [{ group_id: 'g1', name: 'TR130 01 · The sealed drop and the hood', created_at: NOW }, { group_id: 'g2', name: 'TR130 02 · Old', created_at: NOW }] });
	expect(sceneLabel(p, { group_id: 'g1', name: 'TR130 01 · The sealed drop and the hood' })).toBe('DRP · The sealed drop and the hood');
	expect(sceneLabel(p, { group_id: 'g2', name: 'TR130 02 · Old' })).toBe('No code yet');
	expect(sceneLabel(p, { group_id: 'main', name: 'Main' })).toBe('Main');
	// The outline reads the scene's own title beside its code, whatever the group was called.
	expect(placedGroups(p, [{ group_id: 'g1', name: 'TR130 01 · The sealed drop and the hood' }]).scenes.map((group) => [group.code, group.title])).toEqual([['DRP', 'The sealed drop and the hood']]);
});
