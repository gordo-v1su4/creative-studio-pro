import { expect, test } from 'bun:test';
import { shotCardFacts, shortName, shotCode, takeName } from '../../src/lib/domain/shot-card';
import { projectSchema, type Project } from '../../src/lib/domain/schemas';

const card = (over: Record<string, unknown> = {}) => ({ card_id: 'c', order: 2, title: 'Mara on the floor', duration_ms: 5000, ...over });
const take = (id: string, over: Record<string, unknown> = {}) => ({ asset_id: id, card_id: 'c', kind: 'video' as const, name: `${id}.mp4`, ...over });

test('a shot with no take says so and shows no takes', () => {
	const facts = shotCardFacts(card(), [], null);
	expect(facts.status).toBe('missing');
	expect(facts.statusLabel).toBe('No take');
	expect(facts.takes).toEqual([]);
	expect(facts.takesLabel).toBe('');
	expect(facts.version).toBe('');
});

test('the number is the shot number when it has one, else its place in the order', () => {
	expect(shotCardFacts(card({ shot_number: 30 }), [], null).number).toBe('0030');
	expect(shotCardFacts(card(), [], null).number).toBe('03');
});

test('length reads in seconds, to one decimal at most', () => {
	expect(shotCardFacts(card({ duration_ms: 5000 }), [], null).length).toBe('5s');
	expect(shotCardFacts(card({ duration_ms: 625 }), [], null).length).toBe('0.6s');
	expect(shotCardFacts(card({ duration_ms: 20050 }), [], null).length).toBe('20.1s');
});

test('takes keep their order; the pick and excluded takes are marked; sound is not a take', () => {
	const assets = [
		take('a', { rejected: true, review_room: { version: 1 } }),
		take('b', { review_room: { version: 2 } }),
		take('s', { kind: 'audio' as const }),
		take('d')
	];
	const facts = shotCardFacts(card(), assets, 'b');
	expect(facts.takes.map((t) => [t.id, t.label, t.pick, t.excluded])).toEqual([
		['a', 'v001', false, true],
		['b', 'v002', true, false],
		['d', 'Take 3', false, false]
	]);
	expect(facts.takesLabel).toBe('3 takes');
	expect(facts.version).toBe('v002');
});

test('one take reads in the singular, and a pick not yet stored has no version', () => {
	const facts = shotCardFacts(card(), [take('a')], 'a');
	expect(facts.takesLabel).toBe('1 take');
	expect(facts.version).toBe('');
	expect(facts.statusLabel).toBe('Awaiting review');
});

test("the status label follows the shot's review status", () => {
	expect(shotCardFacts(card(), [take('a', { review_status: 'approved' })], 'a').statusLabel).toBe('Approved');
	expect(shotCardFacts(card(), [take('a', { review_status: 'needs_changes' })], 'a').statusLabel).toBe('Needs changes');
	expect(shotCardFacts(card(), [take('a', { review_status: 'in_progress' })], 'a').statusLabel).toBe('In progress');
});

// --- What a shot and a take are called (CONTEXT.md: Shot code) -------------------------------------------------

const NOW = '2026-11-23T00:00:00.000Z';
function coded(over: { room?: unknown; levels?: unknown; cards?: unknown[] } = {}): Project {
	return projectSchema.parse({
		schema_version: 1, project_id: 'p1', title: 'TR130', created_at: NOW, updated_at: NOW, version: 1,
		stage: { id: 'S0', state: 'BLOCKED', confidence: null },
		seed: { seed_id: 's1', title: 'TR130', brief: 'x', creative_focus: 'full room', created_by: 'test' },
		...(over.room ? { review_room: over.room } : {}),
		production: { ...(over.levels ? { story_levels: over.levels } : {}), groups: [], cards: over.cards ?? [] }
	});
}
const boardCard = (card_id: string, order: number, over: Record<string, unknown> = {}) => ({ card_id, order, title: card_id, beat: 'x', purpose: 'x', duration_ms: 3000, image_prompt: 'x', video_prompt: 'x', ...over });
const room = { project_id: 'r', folder_id: 'f', code: 'TR130', show_code: 'BLR', scenes: {}, shots: { c1: { code: 'BLR_TR130_DRP_0010', folder_id: 'f' } } };

test("a shot is called by Review Room's code when it has one there, even when the card itself holds none", () => {
	const project = coded({ room, cards: [boardCard('c1', 0)] });
	expect(shotCode(project, project.production.cards[0])).toBe('BLR_TR130_DRP_0010');
});

test('a shot not in Review Room is called by the code built from the codes the app holds', () => {
	const project = coded({ levels: { approved: {}, show_code: 'BLR', project_code: 'TR100' }, cards: [boardCard('c2', 1, { scene_code: 'VHS', shot_number: 20 })] });
	expect(shotCode(project, project.production.cards[0])).toBe('BLR_TR100_VHS_0020');
});

test('a shot with no code at all keeps its short number', () => {
	const project = coded({ cards: [boardCard('c3', 2), boardCard('c4', 3, { shot_number: 30 })] });
	expect(shotCode(project, project.production.cards[0])).toBe('03');
	expect(shotCode(project, project.production.cards[1])).toBe('0030');
	expect(shotCode(project, project.production.cards[0], '0030')).toBe('0030');
});

test('the short form of a code is the part after the trailer or episode; a short number stays as it is', () => {
	expect(shortName('BLR_TR130_DRP_0010')).toBe('DRP_0010');
	expect(shortName('BLR_TR130_DRP_0010_v001')).toBe('DRP_0010_v001');
	expect(shortName('BLR_EP101_PAR_0020')).toBe('PAR_0020');
	expect(shortName('03')).toBe('03');
});

test("a take stored in Review Room is the shot's code and its version; one not stored there keeps its take label", () => {
	expect(takeName('BLR_TR130_DRP_0010', { review_room: { version: 1, code: 'BLR_TR130_DRP_0010' } }, 0)).toBe('BLR_TR130_DRP_0010_v001');
	expect(takeName('BLR_TR130_DRP_0010', { review_room: { version: 12 } }, 0)).toBe('BLR_TR130_DRP_0010_v012');
	expect(takeName('BLR_TR130_DRP_0010', {}, 2)).toBe('BLR_TR130_DRP_0010 Take 3');
	expect(takeName('03', {}, 0)).toBe('03 Take 1');
});

test("the card's facts carry the shot's code, its short form, and each take's name beside its file name", () => {
	const facts = shotCardFacts(card(), [take('a', { review_room: { version: 1, code: 'BLR_TR130_DRP_0010' } }), take('b')], 'a', 'BLR_TR130_DRP_0010');
	expect(facts.code).toBe('BLR_TR130_DRP_0010');
	expect(facts.short).toBe('DRP_0010');
	expect(facts.takes.map((t) => [t.label, t.name, t.file])).toEqual([['v001', 'BLR_TR130_DRP_0010_v001', 'a.mp4'], ['Take 2', 'BLR_TR130_DRP_0010 Take 2', 'b.mp4']]);
	// Without a code the facts are named by the short number, as before.
	const plain = shotCardFacts(card(), [take('a')], 'a');
	expect([plain.code, plain.short, plain.takes[0].name]).toEqual(['03', '03', '03 Take 1']);
});
