# Board assemblies and cut views

Status: decided 2026-11-21 (grilling session); cut view built, assemblies planned.
Terms: [CONTEXT.md](../../CONTEXT.md) → Scene, Selection, Assembly, Cut view, Cut, Push.

## Why

A trailer like TR110 is improvised: its scenes (TR110 01–10) already hold their shots, and the edit is found by
combining scenes and trying shots together, not from a planned outline. The board showed one group at a time, so
shots from different scenes could never be seen, selected and played together without moving them out of their
scene, which would break their Review Room scene folders (`010 DRP`…).

## Decisions

1. **Assembly** (new term, not "composite": the glossary reserves "comp" against cut). It is a saved, named,
   ordered set of scenes laid out together on the board. Pushing a selection of its shots makes a cut.
2. **The TR110 chunks are scenes**, including in a trailer, where a scene may cross places.
3. **Assemblies are saved on the project**: named, listed, and opened again from any device.
4. **The cut view stays.** It goes back from a cut to the board, while an assembly goes forward from scenes to a cut.
5. **A selection plays in reading order** (rows top to bottom, left to right), not click order. The code already
   did this; the glossary now says so.
6. **Inside a scene frame, shots are in story order** (the spine). Benched shots show greyed and are skipped.
7. Neither an assembly nor a cut view ever moves a shot out of its scene. Their canvas positions are computed, never
   saved over a shot's place in its own scene.

## Cut view (built)

- The Groups panel lists **Cuts** (edits of more than one clip, newest first) under the groups, as `✂ <cut name>`.
- Opening one shows the cut's shots, each once, at its first appearance, in a grid in play order. Select all, then
  "play in order", and the edit opens in the sequence player; "Push to cut" saves a new cut.
- A cut view does not save positions or put dropped files into it (they go to Main).
- Code: `cutShots`, `cutViews`, `isCutView` in `src/lib/domain/groups.ts`; board wiring in `src/routes/+page.svelte`.

## Assembly (to build)

Defaults below were not individually confirmed; change any before building.

- **Data** *(default)*: `production.assemblies: [{ assembly_id, name, scene_ids: string[], created_at }]`, changed only
  by board commands `create_assembly`, `update_assembly` (rename, reorder or add/remove scenes) and `remove_assembly`,
  each a ledger event. A scene appears at most once per assembly and can be in any number of assemblies.
- **Making one** *(default)*: Ctrl/⌘-click scenes in the Groups panel, then "+ assembly". It is named after its
  scenes ("TR110 01 + 02"), which can be renamed by double-click as groups are.
- **Listing** *(default)*: an **Assemblies** section in the Groups panel, between the groups and the cuts.
- **Canvas** *(default)*: each scene is a Svelte Flow parent node (a labelled frame), and its shot cards are child
  nodes inside it, five per row, in story order. Frames stack top to bottom in assembly order, so reading order over
  "select all" gives scene 1's shots, then scene 2's. Dragging a frame above or below another reorders the assembly
  (`update_assembly`); shots inside a frame keep story order and are not draggable out.
- **Playing and pushing** use the existing selection, sequence player and push flow, so nothing new is needed there.
- **Out of scope**: assemblies are not sent to Review Room. The cuts pushed from them reach `_Deliverables` through
  Export.

## Build order

1. Domain: assembly schema plus `applyCreateAssembly` / `applyUpdateAssembly` / `applyRemoveAssembly`, with tests
   (order, once per scene, unknown scene refused, scene removal drops it from assemblies).
2. Gateway + board route commands + ledger event types.
3. Board: Assemblies list, multi-select scenes then "+ assembly", the assembly view with frame (parent) nodes, and
   reorder by frame drag.
4. Browser test in the dev preview on a throwaway project, then release to the App VM origin.
