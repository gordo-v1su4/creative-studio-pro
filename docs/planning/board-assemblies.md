# Board assemblies and cut views

Status: decided and built 2026-11-21 (grilling session, then operator direction during the build).
Terms: [CONTEXT.md](../../CONTEXT.md) → Scene, Selection, Assembly, Cut view, Cut, Push.

## Why

A trailer like TR110 is improvised. Its scenes (TR110 01–10) already hold their shots, and the edit is found by
combining scenes and trying shots together, not from a planned outline. The board showed one group at a time, so
shots from different scenes could never be seen, selected and played together without moving them out of their
scene, which would break their Review Room scene folders (`010 DRP`…).

## Decisions

1. **Assembly** is the new term, not "composite", because the glossary reserves "comp" against cut. An assembly
   is a saved, named canvas of scenes.
2. **The TR110 chunks are scenes**, including in a trailer, where a scene may cross places.
3. **Assemblies are saved on the project**: named, listed, and opened again from any device.
4. **The cut view stays.** It goes back from a cut to the board, while an assembly goes forward from scenes to a cut.
5. **A selection plays in reading order** (rows top to bottom, left to right), not click order.
6. **A scene plays in story order.** Benched shots are skipped; on the scene node they are counted ("2 benched").
7. **Each scene is one node** (operator, during the build). Drag a scene from Groups onto the assembly canvas and it
   lands as one big node with four glimpses: its first, early-middle, late-middle and last shots, each a hover-to-play
   clip. This replaced the planned frames holding every shot card.
8. Neither an assembly nor a cut view ever moves a shot out of its scene, or saves positions over a shot's place in
   its own scene.

## Cut view

- The Groups panel lists **Cuts** (edits of more than one clip, newest first) as `✂ <cut name>`.
- Opening one shows the cut's shots, each once at its first appearance, in a grid in play order. Select them all,
  then "play in order", and "Push to cut" saves a new cut.
- A cut view saves no positions. Files dropped while it is open go to Main.

## Assembly

- **Data**: `production.assemblies: [{ assembly_id, name, created_at, scenes: [{ group_id, x, y }] }]`. It changes
  only through the board commands `create_assembly`, `update_assembly` (rename, or the scenes and where they sit)
  and `remove_assembly`, logged as `project.group_changed.v1`. A scene is in an assembly at most once, and can be in
  any number of assemblies.
- **Panel**: an Assemblies section between Groups and Cuts, as `▦ <name>` with its scene count. **+ new** makes
  "Assembly N" and opens it. Double-click renames it; × deletes it, but its scenes and shots stay.
- **Canvas**: with an assembly open, scenes in the Groups list can be dragged onto the canvas. Each scene node shows
  its name, its playing shots and running time (pick trims), the benched count, **open** (shows the scene) and
  **×** (takes it out of the assembly). Moving nodes saves their places.
- **Play**: select scene nodes (Ctrl/⌘-click, or draw a box) and the bar reads "N scenes · M shots ▶ Play in order".
  It plays the scenes in reading order, each scene's shots in story order. The sequence player's "Push to cut" saves
  the cut.
- **Not in scope**: assemblies are not sent to Review Room. The cuts pushed from them reach `_Deliverables`
  through Export.

## Code

- Domain: `src/lib/domain/groups.ts`. Cut views use `cutShots` and `cutViews`; assemblies use `assemblyViews`,
  `assemblyPlay`, `sceneShots`, `sceneGlimpse` and `applyCreate/Update/RemoveAssembly`. Tests are in
  `tests/domain/assemblies.test.ts`.
- Commands: `groupCommandSchema` in `schemas.ts`; `ProjectCommandGateway.changeGroups`; the board route.
- UI: the scene node is `src/lib/ui/nodes/SceneNode.svelte`; the board wiring is in `src/routes/+page.svelte`.
