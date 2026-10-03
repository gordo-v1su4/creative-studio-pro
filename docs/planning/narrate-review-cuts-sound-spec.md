# Spec — Narrate: board review, cuts, sound and export

Vocabulary follows the root `CONTEXT.md` glossary (Beat, Take, Pick, Spine, Benched, Selection, Cut, Push, Trim, Speed ramp, Locked cut, Hold, Animate, Draft, Finalize, Agent, Model provider, Raycast bridge).

## Problem Statement

The operator generates many short draft takes (Seedance 480p) and stills for a story, and needs to turn them into a finished piece — a trailer, a promo — without leaving the app. Today they can see one take per beat on the board, hover-play it, shift-select beats and preview them back to back with trims and speed ramps. But:

- Only the newest take on a beat is visible; alternates are hidden, and there is no way to choose a different pick.
- The story order is drawn automatically from card order; connectors can't be unhooked or rewired, and there is no way to switch a beat off without deleting it.
- A shift-selection disappears on reload; there is no saved, named edit, so a "trailer" and a "15 s promo" can't coexist.
- There is no way to freeze picture, lay sound against it, or produce a finished file.
- Stills (a title card) can't become video takes, and new files can't be dropped onto the board.
- The Agent is hard-wired to one model provider; the operator wants cheap, vision-capable open models (via Hyper) or their personal Raycast bridge.
- The 480p drafts can be finalized to 1080p from the same render only for seven days, and nothing tells the operator.

## Solution

One flow, mirrored in the project tabs: **Story → Board → Beats → Cuts → Sound → Export**, branded **Narrate**.

On the **Board**, each beat shows its takes as "Take 2 of 3" with clean previous/next controls; the take showing is the pick. Connectors can be unhooked and rehooked to reorder the spine. A beat can be benched in place (dimmed, skipped) and is also listed in a bin. Files dropped on a beat become a new take and pick; files dropped on empty canvas become a new benched beat. Any beat with a still can make a **Hold** (local, free) or **Animate** (Seedance, Agent-drafted prompt, cost shown, confirm or YOLO within a session spend cap).

A shift-selection is previewed in the timeline player; **Push** snapshots it into a named **Cut**. Cuts are edited in the **Cuts** tab — trims, speed ramps, order, swapping or dropping takes, Agent "Suggest trims", and **Match to music** (waveform alignment to a song, keeping the operator's order). Board changes never reach an existing cut. **Lock** freezes a cut's picture as a version.

The **Sound** stage builds four layers on a locked cut — take audio (crossfaded, cut-offs repaired), ambience bed, music, added effects — and auto-mixes them. Sped-up sections time-stretch take audio up to 1.5× and mute it above that.

**Export** renders an MP4 and writes a DaVinci Resolve timeline with speed ramps baked into intermediate files. Draft takes can be **Finalized** to 1080p per take or per cut. The seven-day window is shown prominently — a countdown badge on every draft take (red in the last 48 hours) and a project banner listing drafts about to close; nothing is ever deleted when it closes.

The **Agent** (one name for the assistant) runs on the operator's chosen **Model provider**: Hyper (one key, live model list, vision-capable models only), a custom OpenAI-compatible endpoint, or the Raycast bridge when connected. Measurable work (detection, alignment, mixing, checks) is code, never the model.

## User Stories

### Board: takes and picks
1. As the operator, I want each beat to show "Take N of M", so that I know when a beat has alternates.
2. As the operator, I want previous/next controls on a beat to cycle its takes, so that I can compare alternates in place.
3. As the operator, I want the take I leave showing to become the pick, so that what I see is what plays everywhere.
4. As the operator, I want single-take beats to show no take controls, so that simple cards stay clean.
5. As the operator, I want to reject a take, so that bad generations stop appearing in cycling and selections without being deleted.
6. As the operator, I want to reveal rejected takes on demand, so that I can recover one I rejected by mistake.
7. As the operator, I want hover playback to use the pick's trim and speed ramp, so that the board previews match my edits.

### Board: spine and benching
8. As the operator, I want to unhook a connector between two beats and hook it elsewhere, so that I can reorder the story by rewiring.
9. As the operator, I want the spine order recomputed from the connected chain, so that the board is the single source of story order.
10. As the operator, I want to bench a beat with one control, so that it is skipped without rewiring anything.
11. As the operator, I want a benched beat to stay in place and look dimmed, so that I always know where it goes back.
12. As the operator, I want a bin listing every benched beat, so that I can find and restore them quickly.
13. As the operator, I want benched beats skipped in spine playback and in new selections, so that switched-off material never sneaks in.
14. As the operator, I want benching to never change existing cuts, so that my edits stay as I pushed them.

### Board: bringing media in
15. As the operator, I want to drop an image or video onto a beat, so that it becomes a new take and the pick.
16. As the operator, I want to drop a file on empty canvas, so that it becomes a new benched beat without changing the story order.
17. As the operator, I want dropped files copied into the project folder, so that the project is self-contained.
18. As the operator, I want a reference or still under 2K flagged on drop, so that low-resolution material never reaches a generator unnoticed.

### Stills to video
19. As the operator, I want to make a Hold from a still at a chosen length, so that a title card can sit in a cut.
20. As the operator, I want optional slow push-in and fade on a Hold, so that stills feel alive.
21. As the operator, I want a Hold to be a new take on the same beat, so that the still remains available.
22. As the operator, I want to Animate a still through Seedance, so that a beat without video gets one.
23. As the operator, I want the Agent to draft the Animate prompt from the beat and the project rules, so that I don't start from a blank prompt.
24. As the operator, I want to edit the drafted prompt before sending, so that I keep creative control.
25. As the operator, I want the prompt linter and the 2K reference check to run before any send, so that rule-breaking prompts never spend credits.
26. As the operator, I want to see references, length, resolution and cost before sending, so that I approve the spend knowingly.
27. As the operator, I want a YOLO send that skips the confirm step, so that I can move fast.
28. As the operator, I want YOLO sends to stop at a session credit cap I set, so that moving fast can't drain my balance.
29. As the operator, I want the Animate result to land as a new take on the beat, so that it joins the normal review flow.

### Selections and cuts
30. As the operator, I want to shift-click beats in any order and preview them, so that I can try an edit quickly.
31. As the operator, I want trims and ramps made in a selection preview saved as the take's defaults, so that they survive a reload.
32. As the operator, I want to Push a selection into a named cut, so that the edit is kept.
33. As the operator, I want a pushed cut to own its own trims, ramps and order, so that later board edits never change it.
34. As the operator, I want a Cuts tab listing my cuts, so that a trailer and a promo can coexist.
35. As the operator, I want to open a cut in the timeline player, so that I can keep editing it.
36. As the operator, I want to trim, ramp, reorder and drop entries inside a cut, so that I refine the edit after pushing.
37. As the operator, I want to swap which take a cut entry uses, so that I can try an alternate without re-pushing.
38. As the operator, I want each entry's source info (prompt, job, full length) visible in the cut, so that I know what I'm trimming.
39. As the operator, I want the cut's running length shown as I edit, so that I can hit a target duration.

### Agent edits and music
40. As the operator, I want a "Suggest trims" action that finds frozen frames, stutter and bad starts, so that the first edit is done for me.
41. As the operator, I want suggestions shown as marks I accept or dismiss, so that a suggestion never overrides my own trim.
42. As the operator, I want to accept all suggestions in one click, so that the common case is fast.
43. As the operator, I want to attach a song to a cut, so that I can cut to music.
44. As the operator, I want Match to music to align each take's own audio to the song, so that the music runs through underneath.
45. As the operator, I want my order kept during matching, so that the story never gets reshuffled by the music.
46. As the operator, I want takes that can't align to fall back to snapping their cuts to the nearest beat, so that every cut still lands musically.
47. As the operator, I want to preview and undo a match, so that I stay in control.

### Lock and sound
48. As the operator, I want to Lock a cut, so that picture is frozen for sound.
49. As the operator, I want locking to create a version and unlocking to create the next one, so that sound always matches an exact picture.
50. As the operator, I want each take's own audio as a layer with crossfades at cuts, so that cuts don't click or jump.
51. As the operator, I want sounds chopped mid-hit at a cut found and repaired, so that nothing is jarring.
52. As the operator, I want a continuous ambience bed under the cut, so that separately generated clips feel like one place.
53. As the operator, I want a music layer, so that the song carries the cut.
54. As the operator, I want an added-effects layer with hits, whooshes and risers at cuts and impacts, so that the edit hits harder.
55. As the operator, I want added effects from a local folder, and generated on request with my OK, so that I control cost.
56. As the operator, I want an automatic mix (levels, ducking music under hits and dialogue, limiting), so that I get a balanced result without mixing by hand.
57. As the operator, I want each layer mutable and adjustable, so that I can override the mix.
58. As the operator, I want take audio time-stretched on sections up to 1.5× and muted above, so that fast ramps don't sound like chipmunks.

### Finalize and export
59. As the operator, I want a Finalize action on a draft take showing its cost, so that I can get the 1080p version of that exact render.
60. As the operator, I want "Finalize all picks in this cut" with the total cost, so that I can finish a cut in one go.
61. As the operator, I want a prominent countdown on every draft take (yellow, red in the last 48 hours) and a project banner listing drafts about to close, so that the same-render 1080p option never passes unnoticed.
62. As the operator, I want nothing deleted or blocked when the window closes, so that projects always remain workable.
63. As the operator, I want finalized takes to keep the draft's trims and ramps, so that my edit survives the swap.
64. As the operator, I want an MP4 render of a locked, mixed cut, so that I have a finished file.
65. As the operator, I want a DaVinci Resolve timeline export with ramps baked into intermediate files, so that Resolve plays exactly what I approved.
66. As the operator, I want the export to list any takes still at draft resolution, so that I know what isn't final.

### Agent and model providers
67. As the operator, I want one assistant called the Agent, so that it is clear who I'm talking to.
68. As the operator, I want to ask the Agent why a beat exists or whether the story makes sense, so that I can reason about the story with it.
69. As the operator, I want an app-wide default model with a per-project override, so that most projects use a cheap model and special ones can differ.
70. As the operator, I want a project's model locked once it has run, with switching an explicit logged action, so that the project history says which model wrote what.
71. As the operator, I want a Hyper preset using one key and the live model list, so that new models appear without code changes.
72. As the operator, I want only vision-capable models offered, so that the Agent can always read stills, sheets and frames.
73. As the operator, I want a custom OpenAI-compatible endpoint option, so that any compatible provider works.
74. As the operator, I want the Raycast bridge offered only when it is connected, so that my personal workflow never confuses anyone else.
75. As the operator, I want a quick model test on selection (image input, structured answer, rule following), so that a weak model is flagged before I rely on it.
76. As the operator, I want a rule-breaking answer retried once with the error and then stopped, never silently switched to another model, so that failures are visible.
77. As the operator, I want API keys kept in app settings and never in project files, so that projects are safe to share.

### Navigation
78. As the operator, I want the product called Narrate on screen, so that the name is consistent.
79. As the operator, I want one project bar with Story, Board, Beats, Cuts, Sound, Export, so that the tabs follow the actual flow.
80. As the operator, I want the Media tab replaced by drag-and-drop, so that there is one way to bring media in.

## Implementation Decisions

- **Beats and takes.** The existing story card is the beat and each production asset is a take. A beat gains an explicit pick (by take id, replacing "newest asset wins") and a benched flag; a take gains a rejected flag, its generation job id, its draft flag and draft creation time (for the finalize window), and its default trim and speed ramp (already stored as in/out seconds and a 1–4× curve).
- **Spine.** Story order is derived from the connected chain starting at the seed; connector edits are persisted, and the chain is the source of truth for order. Beats not on the chain keep their position on canvas. Benched beats stay on the chain but are skipped.
- **Cuts.** A cut is a new project-level record: id, name, version, locked flag, ordered entries. An entry references a beat and a take and carries its own trim and speed ramp, copied at push time. Pushing never mutates takes; editing a cut never mutates takes or beats.
- **Lock and versions.** Locking freezes a cut version; unlocking copies it into the next version. Sound work belongs to a specific locked version.
- **Commands.** All new behaviour goes through the existing project command gateway and append-only ledger (set pick, reject take, bench beat, rewire spine, add take, push cut, edit cut entry, lock/unlock cut, save sound plan). Optimistic version checks as today.
- **Playback.** Hover, selection and cut playback reuse the resident GPU frame-bank player ported from beatsmaxxer-pro and the monotone speed-curve module; no new playback engine.
- **Media pipeline.** Hold, time-stretch, ramp baking, mixing and MP4 rendering run through ffmpeg on the server as pure "render plans" (input description → ffmpeg arguments/filter graph) executed by a thin runner. Detection (frozen frames, stutter, bad starts), waveform alignment and beat grids run server-side in code, not the model.
- **Match to music.** Cross-correlate each take's audio envelope against the song to find the best offset within that take's available footage; keep sequence order; slide each entry within its own trim and adjust neighbouring edges to meet; below a confidence threshold, snap the cut to the nearest beat instead.
- **Sound plan.** A locked cut's sound is a plan record: four layers (take audio, ambience, music, added effects), per-layer gain/mute, placed effects, ducking and limiter settings. The Agent proposes added-effect placements; the auto-mix is deterministic.
- **Finalize.** Uses the Seedance draft-finalize call by job id at 1080p; cost is pre-checked; the finalized file becomes the same take's high-res media so trims and ramps carry over.
- **Generation sends.** Animate (and any generation) passes the prompt linter and the 2K reference check server-side before any spend; cost is pre-checked; YOLO skips only the confirm step and stops at a per-session credit cap.
- **Model providers.** Generalize the current Kimi-only OpenAI-compatible client into a provider setting: presets (Hyper at the Hyper OpenAI-compatible preset with model list from its models endpoint; custom endpoint), plus the Raycast bridge when its capability check reports connected. App default plus per-project lock. Vision-capable models only. Keys in app settings. One retry on a rule-breaking answer, then stop; never a silent fallback.
- **Export.** MP4 from the render plan; Resolve via FCPXML referencing baked intermediates (ramps rendered into per-entry files), plus the mixed audio stems.
- **Naming and tabs.** Display name Narrate; repository and code identifiers unchanged. Project tabs: Story, Board, Beats (the current Cards list), Cuts, Sound, Export; Media removed; single navigation bar.
- **Assumed (operator did not answer; my recommendation stands until changed):** four sound layers plus auto-mix; Narrate as display name; files dropped on empty canvas become benched beats; trim suggestions run on a "Suggest trims" button, never automatically on push.

## Testing Decisions

- Good tests assert external behaviour through the highest seam: a command in, project state (ledger snapshot) out; a render plan in, ffmpeg arguments out; an audio pair in, an offset out. No assertions on component internals.
- **Seam 1 — project command gateway** (prior art: the S1/S2 persistence and brief-route integration tests): pick/reject/bench/rewire, push, cut entry edits, lock/unlock, sound plan save — each as command → persisted project.
- **Seam 2 — pure domain modules** (prior art: the prompt-lint and speed-curve unit tests): spine derivation from edges, cut snapshot semantics, trim-suggestion detection on synthetic frame-difference series, music alignment on synthetic signals, auto-mix gain/ducking math, finalize-window state, render-plan builders, FCPXML builder.
- **Seam 3 — one ffmpeg smoke test** per render path (Hold, ramp bake, mix, MP4) on a tiny fixture, skipped when ffmpeg is absent.
- **Provider seam:** the existing fake-agent pattern from the stage-agent handler tests; a model-test routine run against a fake provider returning good/bad answers.
- UI behaviour (take cycling, rewiring, bench, timeline gestures) verified in the browser preview; no component unit tests.

## Out of Scope

- Generating new Seedance coverage, buying credits, or finalizing specific takes (operator decisions, done by hand).
- Multi-track picture editing (overlays, picture-in-picture); cuts are a single picture track.
- Native editable speed ramps in Resolve (baked only for now).
- Exports to editors other than Resolve.
- Local ComfyUI/SwarmUI generation providers.
- Renaming the repository or code identifiers to Narrate.
- Stem separation of dialogue from take audio.

## Further Notes

- The board review work this builds on (GPU hover playback, shift-select sequences, timeline with trims and speed ramps, per-take trim/ramp saving, prompt linter rules, 2K reference check) exists in the working tree and must be committed before tickets start.
- Draft takes from 2026-09-30/10-01 leave the finalize window around 2026-10-07/08.
- Glossary: `CONTEXT.md`. Prompt rules for Blood Rush: the project's `trailer/PROMPT-RULES.md`.
