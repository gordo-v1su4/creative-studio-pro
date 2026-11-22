import { expect, test } from 'bun:test';
import { productionStateSchema } from '../../src/lib/domain/schemas';
import { appendPlannedShots, reconcileMomentEdits } from '../../src/lib/domain/story-plan';
import { applyAddTake } from '../../src/lib/domain/media';
import { emptyState, referenceSpecSchema } from '../../src/lib/domain/prep';
import { joeyPrerequisites, joeyPromptIssues } from '../../src/lib/domain/joey-prep';
import { applyRecordGeneration, applySettleGeneration } from '../../src/lib/domain/animate';
import { generationSchema } from '../../src/lib/domain/schemas';
import { characterSheetInputsSchema } from '../../src/lib/domain/character-sheet';

test('only approved moments append shots; repeats preserve existing boards, media and picks', () => {
	const original = productionStateSchema.parse({ story_plan: { title: 'Trailer', sections: [{ id: 'act-1', title: 'Act 1', summary: '', moments: [{ id: 'moment-1', title: 'Cornered', beat: 'Kai chooses an escape route.', duration_s: 6, characters: ['Kai'], location: 'Roof', approved: false, shots: [{ id: 'shot-1', title: 'The gap', beat: 'Kai looks across the gap.', duration_s: 6 }] }] }] } });
	expect(appendPlannedShots(original, '2026-11-15T12:00:00Z')).toEqual(original);
	original.story_plan!.sections[0].moments[0].approved = true;
	const withPlan = appendPlannedShots(original, '2026-11-15T12:00:00Z');
	expect(withPlan.cards).toHaveLength(1);
	expect(withPlan.cards[0]).toMatchObject({ benched: true, identity_tags: { characters: [{key:'character:Kai',name:'Kai'}], location: {key:'location:Roof',name:'Roof'} } });
	const take = applyAddTake(withPlan, withPlan.cards[0].card_id, { asset_id: 'take-1', kind: 'video', name: 'render.mp4', mime_type: 'video/mp4', url: '/clip.mp4', created_at: '2026-11-15T12:00:00Z' });
	if (!take.ok) throw new Error(take.message);
	expect(take.production.assets[0].identity_tags).toEqual(withPlan.cards[0].identity_tags);
	const again = appendPlannedShots(take.production, '2026-11-15T12:01:00Z');
	expect(again).toEqual(take.production);
	expect(again.cards[0].pick_take_id).toBe('take-1');
	const queued = applyRecordGeneration(again, generationSchema.parse({request_id:'job1',card_id:again.cards[0].card_id,provider:'higgsfield',model:'seedance',prompt:'test',duration_s:6,resolution:'1080p',estimate_credits:1,status:'queued',submitted_at:'2026-11-15T12:00:00Z'}));
	if (!queued.ok) throw new Error(queued.message);
	const changed = structuredClone(queued.production);
	changed.cards[0].identity_tags!.characters[0].name='Someone else';
	const landed=applySettleGeneration(changed,'job1',{status:'completed',take:{asset_id:'take2',kind:'video',name:'new.mp4',mime_type:'video/mp4',url:'/new.mp4',created_at:'2026-11-15T12:01:00Z'}},'2026-11-15T12:01:00Z');
	if (!landed.ok) throw new Error(landed.message);
	expect(landed.production.assets.at(-1)?.identity_tags?.characters[0].name).toBe('Kai');
	const edited = structuredClone(original.story_plan!);
	edited.sections[0].moments[0].beat = 'A different event needs different coverage.';
	const reconciled = reconcileMomentEdits(original.story_plan, edited);
	expect(reconciled.sections[0].moments[0]).toMatchObject({approved:false,shots:[]});
	expect(appendPlannedShots({...again,story_plan:reconciled},'2026-11-15')).toEqual({...again,story_plan:reconciled});
});

test('a planned shot linked to an existing board shot adds no card or group; the rest still append', () => {
	const production = productionStateSchema.parse({
		groups: [{ group_id: 'seq-08', name: 'TR110 08 · Red', created_at: '2026-11-21T00:00:00Z' }],
		cards: [{ card_id: 'rush', group_id: 'seq-08', order: 0, title: 'TR110-08-02 · Restraint slips', beat: 'Kai takes the Rush.', purpose: 'x', duration_ms: 6000, image_prompt: 'x', video_prompt: 'x', status: 'draft' }],
		story_plan: { title: 'Trailer', sections: [{ id: 'act-3', title: 'Act 3', summary: '', moments: [{ id: 'red', title: 'Red and the watcher', beat: 'Kai takes the Rush.', duration_s: 12, approved: true,
			shots: [{ id: 'take-rush', title: 'The Rush', beat: 'He drinks.', duration_s: 6, card_id: 'rush' }, { id: 'watcher', title: 'The watcher', beat: 'Someone films.', duration_s: 6 }] }] }] }
	});
	const next = appendPlannedShots(production, '2026-11-22T00:00:00Z');
	expect(next.cards.map(card => card.card_id)).toEqual(['rush', 'plan-shot-watcher']);
	expect(next.groups?.map(group => group.group_id)).toEqual(['seq-08', 'plan-section-act-3']);
	const covered = structuredClone(production);
	covered.story_plan!.sections[0].moments[0].shots[1].card_id = 'rush';
	expect(appendPlannedShots(covered, '2026-11-22T00:00:00Z')).toEqual(covered);
});

test('story beats land in their scene: an existing board group or a new scene group; the schema guards codes and links', () => {
	const production = productionStateSchema.parse({
		groups: [{ group_id: 'seq-08', name: 'TR110 08 · Red', created_at: '2026-11-21T00:00:00Z' }],
		story_plan: { title: 'TR110', sections: [{ id: 'act-3', title: 'Act 3', summary: '',
			scenes: [{ id: 'pck', title: 'Red and the pickup deadline', group_id: 'seq-08' }, { id: 'drk', title: 'The darkness takes Mara', scene_code: 'DRK' }],
			moments: [
				{ id: 'red', title: 'Red and the watcher', beat: 'x', duration_s: 6, approved: true, scene_id: 'pck', shots: [{ id: 'watcher', title: 'The watcher', beat: 'x', duration_s: 6 }] },
				{ id: 'dark', title: 'The darkness takes Mara', beat: 'x', duration_s: 4, approved: true, scene_id: 'drk', shots: [{ id: 'pull', title: 'Pulled into the building', beat: 'x', duration_s: 4 }] }
			] }] }
	});
	const next = appendPlannedShots(production, '2026-11-22T00:00:00Z');
	expect(next.cards.map(card => [card.card_id, card.group_id])).toEqual([['plan-shot-watcher', 'seq-08'], ['plan-shot-pull', 'plan-scene-drk']]);
	expect(next.groups?.map(group => group.name)).toEqual(['TR110 08 · Red', 'TR110 · The darkness takes Mara']);
	const section = (extra: object) => ({ story_plan: { title: 'T', sections: [{ id: 'a', title: 'A', summary: '', moments: [], ...extra }] } });
	expect(() => productionStateSchema.parse(section({ scenes: [{ id: 's1', title: 'One', scene_code: 'RED' }, { id: 's2', title: 'Two', scene_code: 'RED' }] }))).toThrow('scene code');
	expect(() => productionStateSchema.parse(section({ scenes: [{ id: 's1', title: 'One', scene_code: 'red' }] }))).toThrow('three capital letters');
	expect(() => productionStateSchema.parse(section({ scenes: [{ id: 's1', title: 'One', group_id: 'g' }, { id: 's2', title: 'Two', group_id: 'g' }] }))).toThrow('share one board group');
	expect(() => productionStateSchema.parse(section({ moments: [{ id: 'm', title: 'Lost', beat: 'x', duration_s: 1, scene_id: 'nowhere' }] }))).toThrow('outside');
});

test('Joey workflows require reviewed facts and the correct predecessor without old sheet QC', () => {
	const state = emptyState();
	state.workflow = {builder:'castkit-v1',stage:'sheet',approved_source_url:null,confirmed:false};
	expect(joeyPrerequisites(state)).toContain('Choose the subject reference for the sheet');
	state.spec = referenceSpecSchema.parse({name:'Kai',kind:'character',template:'T1',notes:'Approved outfit'});
	state.sources = [{name:'outfit.png',file:'outfit.png',url:'/outfit.png',added_at:'2026-11-15'}];
	state.workflow.approved_source_url = '/outfit.png';
	state.sheet_inputs = characterSheetInputsSchema.parse({coverage_confirmed:true});
	expect(joeyPrerequisites(state)).toEqual([]);
	expect(joeyPromptIssues('18% neutral gray shadowless LEFT PANEL headless CENTER PANEL RIGHT PANEL', state)).toContain('Confirm the pre-prompt check first');
	state.workflow.confirmed = true;
	expect(joeyPromptIssues('18% neutral gray shadowless LEFT PANEL headless CENTER PANEL RIGHT PANEL', state)).toEqual([]);
});
