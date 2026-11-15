import { expect, test } from 'bun:test';
import { productionStateSchema } from '../../src/lib/domain/schemas';
import { appendPlannedShots, reconcileMomentEdits } from '../../src/lib/domain/story-plan';
import { applyAddTake } from '../../src/lib/domain/media';
import { emptyState, referenceSpecSchema } from '../../src/lib/domain/prep';
import { joeyPrerequisites, joeyPromptIssues } from '../../src/lib/domain/joey-prep';
import { applyRecordGeneration, applySettleGeneration } from '../../src/lib/domain/animate';
import { generationSchema } from '../../src/lib/domain/schemas';

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

test('Joey workflows require reviewed facts and the correct predecessor without old sheet QC', () => {
	const state = emptyState();
	state.workflow = {builder:'castkit-v1',stage:'sheet',approved_source_url:null,confirmed:false};
	expect(joeyPrerequisites(state)).toContain('Choose an approved outfit image');
	state.spec = referenceSpecSchema.parse({name:'Kai',kind:'character',template:'T1',notes:'Approved outfit'});
	state.sources = [{name:'outfit.png',file:'outfit.png',url:'/outfit.png',added_at:'2026-11-15'}];
	state.workflow.approved_source_url = '/outfit.png';
	expect(joeyPrerequisites(state)).toEqual([]);
	expect(joeyPromptIssues('18% neutral gray shadowless LEFT PANEL headless CENTER PANEL RIGHT PANEL', state)).toContain('Confirm the pre-prompt check first');
	state.workflow.confirmed = true;
	expect(joeyPromptIssues('18% neutral gray shadowless LEFT PANEL headless CENTER PANEL RIGHT PANEL', state)).toEqual([]);
});
