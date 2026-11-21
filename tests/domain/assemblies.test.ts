import { expect, test } from 'bun:test';
import { applyCreateAssembly, applyRemoveAssembly, applyUpdateAssembly, assemblyPlay, assemblyViews, sceneGlimpse } from '../../src/lib/domain/groups';
import type { ProductionState } from '../../src/lib/domain/schemas';

const now = '2026-11-21T00:00:00.000Z';
const card = (card_id: string, group_id: string, order: number, benched = false) => ({ card_id, group_id, order, benched, title: card_id }) as never;
const production = {
	groups: [{ group_id: 's1', name: 'TR110 01', created_at: now }, { group_id: 's2', name: 'TR110 02', created_at: now }],
	cards: [card('b', 's1', 1), card('a', 's1', 0), card('c', 's1', 2, true), card('d', 's2', 3), card('e', 's2', 4)],
	assets: []
} as unknown as ProductionState;

test('an assembly is made empty, takes scenes with their places, and plays them scene by scene', () => {
	const made = applyCreateAssembly(production, { assembly_id: 'x', name: ' Act 1 ' }, now);
	if (!made.ok) throw new Error(made.message);
	expect(made.production.assemblies).toEqual([{ assembly_id: 'x', name: 'Act 1', created_at: now, scenes: [] }]);
	const placed = applyUpdateAssembly(made.production, { assembly_id: 'x', scenes: [{ group_id: 's2', x: 0, y: 0 }, { group_id: 's1', x: 600, y: 0 }] });
	if (!placed.ok) throw new Error(placed.message);
	expect(assemblyViews(placed.production)).toEqual([{ group_id: 'asm:x', name: 'Act 1', count: 2 }]);
	// Scene order is the caller's (reading order of the nodes); shots in story order, benched "c" skipped.
	expect(assemblyPlay(placed.production, [{ kind: 'scene', id: 's1' }, { kind: 'scene', id: 's2' }])).toEqual(['a', 'b', 'd', 'e']);
	expect(assemblyPlay(placed.production, [{ kind: 'scene', id: 's2' }, { kind: 'scene', id: 's1' }])).toEqual(['d', 'e', 'a', 'b']);
});

test('a scene is in an assembly once, must exist, and names stay unique', () => {
	const made = applyCreateAssembly(production, { assembly_id: 'x', name: 'Act 1' }, now);
	if (!made.ok) throw new Error(made.message);
	expect(applyUpdateAssembly(made.production, { assembly_id: 'x', scenes: [{ group_id: 's1', x: 0, y: 0 }, { group_id: 's1', x: 1, y: 1 }] })).toMatchObject({ ok: false, message: 'A scene can be in an assembly only once' });
	expect(applyUpdateAssembly(made.production, { assembly_id: 'x', scenes: [{ group_id: 'nope', x: 0, y: 0 }] })).toMatchObject({ ok: false });
	expect(applyCreateAssembly(made.production, { assembly_id: 'y', name: 'act 1' }, now)).toMatchObject({ ok: false });
	const removed = applyRemoveAssembly(made.production, 'x');
	expect(removed.ok && removed.production.assemblies).toEqual([]);
});

test('a scene glimpse spreads over the scene, first and last included', () => {
	expect(sceneGlimpse([1, 2, 3])).toEqual([1, 2, 3]);
	expect(sceneGlimpse([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([1, 4, 7, 10]);
});

test("single shots sit in an assembly by reference: once each, real shots only, played as picked", () => {
	const made = applyCreateAssembly(production, { assembly_id: "x", name: "Swim club" }, now);
	if (!made.ok) throw new Error(made.message);
	const placed = applyUpdateAssembly(made.production, { assembly_id: "x", shots: [{ card_id: "d", x: 0, y: 0 }, { card_id: "c", x: 300, y: 0 }] });
	if (!placed.ok) throw new Error(placed.message);
	expect(placed.production.cards.find((c) => c.card_id === "d")?.group_id).toBe("s2");
	expect(assemblyViews(placed.production)[0].count).toBe(2);
	expect(assemblyPlay(placed.production, [{ kind: "shot", id: "c" }, { kind: "scene", id: "s2" }])).toEqual(["c", "d", "e"]);
	expect(applyUpdateAssembly(made.production, { assembly_id: "x", shots: [{ card_id: "d", x: 0, y: 0 }, { card_id: "d", x: 1, y: 1 }] })).toMatchObject({ ok: false });
	expect(applyUpdateAssembly(made.production, { assembly_id: "x", shots: [{ card_id: "nope", x: 0, y: 0 }] })).toMatchObject({ ok: false });
});
