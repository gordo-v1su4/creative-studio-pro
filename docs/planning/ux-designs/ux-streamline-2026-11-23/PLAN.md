# Build plan: streamlined Creative Studio Pro

What to build is in [SPEC.md](SPEC.md); how it looks is in [DESIGN.md](DESIGN.md). This file is the order of work.

## How the work lands

- Work happens on `ux-streamline`. Each slice below merges to `main` and deploys to Hosted Studio once it is verified, replacing the old screens in place. There is never a second UI behind a switch.
- A slice is verified when `bun run check`, `bun test` and `bun run check:env` pass, the slice has been walked through in the browser on the local test copy at desktop and phone width, and `graft build` has refreshed the graph.
- Test first where a rule can be stated as a pure function (name locking, drop rules, sync merge, selection). Use the `tdd` skill for those.
- After slice 1, run the `retro` skill on the session and fold what it finds into the repo before starting slice 2.
- The mockups are the reference for every screen: https://claude.ai/artifact/GcSURykGvjJGXujETaqa1m, with sources in `mockups/`.

## Slices

| # | Slice | What the operator gets | Depends on |
| --- | --- | --- | --- |
| 0 | Shell and look | Four stages, three panels, docked Agent, new look, old screens inside | — |
| 1 | Shots and playback | New shot grid, takes band, viewer, hover-scrub, selection strip, faster timelines | 0 |
| 2 | Canvas | Grid/Canvas toggle, drag and drop everywhere, G to group, Unplaced | 1 |
| 3 | Review Room | State on every shot, automatic sync, review in the viewer, links both ways | 1 |
| 4 | Front door and story plan | One way in, logline pitches, level approvals, names that lock, Notion optional | 0 |
| 5 | Voice | Talk to the Agent and hear it | 4 |
| 6 | Prep intake | Drop everything, sorted for you, found-in-story suggestions | 0 |
| 7 | Cut | Cuts, Sound and Export inside the shell | 1 |

Slices 2, 3, 4 and 6 do not depend on each other and can be taken in any order after their prerequisite.

### 0 · Shell and look

Goal: the new frame around the app, with every existing screen still working inside it.

1. Replace the design tokens in `src/routes/layout.css` with the set in DESIGN.md; load Geist and Geist Mono.
2. Extract a shell from `src/routes/+page.svelte` (1,783 lines today): top bar, outline panel, work area, dock, footer line.
3. Turn `workspaceTabs` into the four stages. Map Board and Shots to Shots, Cuts, Sound and Export to Cut; map stored tab names from the old layout.
4. Move Series, Watch, Library, Runs, Settings, Publish and New project into a project menu on the crumb. Keep the command palette.
5. Move `AgentChat` from a modal into the dock; keep its conversation across stage changes.
6. Replace the stage-and-gate footer with the "Next" line; gates stay visible in Runs.
7. Add the UI regression tests: no wrapping control label, no borders in the shell.

Done when: every old screen is reachable through the four stages, the top bar fits at 1280px, and nothing overflows at 375px.

Status, 2026-11-23: built and checked in the browser on the local copy at 1440px and 375px.

- Done: tokens and Geist fonts; four stages with their views (`src/lib/domain/stages.ts`); the project menu; panels on a black ground; an outline of groups and shots; the Agent in a dock; the "Next" line (`src/lib/domain/next-line.ts`); tests for all of it.
- Changed from the plan: the docked Agent no longer starts its interview by itself. Left open beside the work it would have called the model on every project change, so it now waits for "Start the interview". In focus mode it behaves as before.
- Left for later slices: the project picker and the Agent's own header still have the old look; the outline lists board groups, not yet the story plan's acts and scene codes; on the canvas the layers panel stands in for the outline.
- Two tests fail on this machine before and after this slice and are unrelated to it: the text-card video test and the vault skills-sync test.

Risk: step 2 is the largest single change in the plan. Do it as a move with no behaviour change, and merge it before restyling the insides.

### 1 · Shots and playback

Goal: reading, playing and comparing takes without waiting.

1. Measure first: Space-to-first-frame for one take, and open-to-playing for a 60-clip cut, on the local copy and on Hosted Studio. Record both in DECISIONS.md.
2. New shot card (frame, take rectangles, title, status, version) in `ProductionWorkspace`; selecting never reflows.
3. Fixed band under the grid: the selected shot's takes, and the selection timeline.
4. Selection strip on top of `ReviewSequence`: explicit order by drag, an auditioned take per entry, Play, Push to cut.
5. Viewer: plain video on the 480p proxy; keys (Space, arrows, J K L, P, X, 1–4, Esc); lanes for frames, scrub and audio with one rectangular playhead.
6. Frame strips: one low-res strip per take, made at ingest beside the proxy and poster; hover-scrub on cards and the viewer's hover preview both read it.
7. Timeline loading in `src/lib/media/gpu/clipBanks.ts`: play when the clips at the playhead are resident, load ahead, keep proxies in browser storage, show the poster until a clip is ready.
8. Details tab: shot spec, prompts by skill section with QC result, Get price and Confirm as separate steps.
9. Measure again and record the change.

Done when: the viewer opens playing in under 100ms on the local copy, a 60-clip cut starts playing before it has finished loading, and reopening it downloads nothing.

Open question settled here: whether Hosted Studio's gateway may cache proxies and frame strips.

### 2 · Canvas

Goal: the board as a view of Shots where anything can be dragged anywhere.

1. Grid/Canvas toggle in the Shots header; `StoryCardNode` restyled as the canvas card.
2. One drop resolver, test-first, used by grid, canvas and outline: clip on shot is a new take, shot on scene moves it, image on reference is a source image, shot on selection adds it.
3. G groups the selected shots; a scene is a group with a scene code; existing board groups carry over.
4. "Unplaced" section in the outline for groups without a scene code.
5. References as canvas cards, linked to the shots whose prompts use them.

Done when: every drop in the list above works from grid, canvas and outline, and a moved shot keeps its shot code.

### 3 · Review Room

Goal: the two apps agree without a button, and each links to the other.

In this repository:

1. Review Room state on every shot card and in the viewer: stored or not, version, status.
2. A poller on the changes feed (10 seconds while a project is open, and on focus), merging with latest-change-wins per shot; test-first with a fake fetch.
3. Writes go out at once; a failed write is kept, shown on its shot and retried. Remove the "Sync reviews" control.
4. Review tab in the viewer: status, Make pick, Exclude, the stored name, notes at their timecodes.
5. "Open in Review Room" on a shot, a scene and a version.

In `review-room-svelte` (its own branch and deploy):

6. Put the open project, folder, asset and version in the address, so a link can open any of them.
7. A link from a locked folder to its project here.
8. A read endpoint for an asset's notes with timecodes, on the existing API-key scheme.

Done when: a status set in either app shows in the other within 15 seconds, and a link from a shot opens that shot's version in Review Room.

### 4 · Front door and story plan

Goal: from nothing to an approved shot list in one conversation, with names that hold.

1. Front door screen replacing `NewProjectFlow`, `TrailerHousePanel` and the `BriefPanel` form: one input, drop targets, example phrases in two groups, the expand motion.
2. Agent actions: pitch three loglines, three more, quick teaser. The Agent drafts the brief; remove the rule that blocks the interview on an unlocked brief.
3. Story plan levels with an approval state each (brief, acts, scenes, story beats, shot list), shown in the outline and in `StoryPlan`.
4. Name locking, test-first: approving a level assigns its codes once; a code cannot change afterwards, a title can.
5. Notion: a key field in Settings stored server-side (the `NOTION_TOKEN` variable stays as a fallback), writes to Notion only when a key is present, the public template link on the front door.
6. Publish the series template as a public Notion page. This is a step for the operator; the plan only needs its address.

Done when: a project can go from one sentence to an approved shot list with no Notion key, and no code changes after its level is approved.

### 5 · Voice

Goal: talk to the Agent and hear it.

1. Read OpenAI's current voice API documentation before designing the layer; do not rely on memory of it.
2. A voice layer in front of the Agent chat endpoint: speech in becomes chat text, the reply is spoken. It never answers by itself (ADR 0009).
3. Talk button and hold-V in the composer; the level bars; the "Listening" state.
4. Document the new key: its name in `.env.example`, its row in the vault note's env table, and where it lives in proxmox-home. Voice is absent when it is not set.

Done when: a spoken sentence appears as chat text, the Agent's reply is heard, and the same reply would have come from typing it.

### 6 · Prep intake

Goal: drop everything once and correct only the exceptions.

1. Intake command: many images in, a proposed sorting out (character, location, prop, unplaced); the operator accepts or drags to correct.
2. "Found in the story": things the story plan names that have no reference, each addable in one click, its reference made from its reference spec.
3. Plain headshots go to CastKit behind the price card; sheets already in the house format are accepted as they are.
4. Equal 16:9 thumbnails for every kind; the cast's headshots at the top of the dock.

Done when: eleven mixed images dropped at once end up sorted with at most the unplaceable ones left for the operator.

### 7 · Cut

Goal: Cuts, Sound and Export in the shell, with the viewer's lanes.

1. Mock the Cut stage in look B and agree it before building.
2. Cut as one stage with three steps: Picture, Sound, Export. Assemblies move here.
3. The cut timeline reuses the viewer's lanes with a music lane added.

Done when: a cut can be opened, locked, mixed and exported without leaving the Cut stage.

## Not in this plan

See "Out of scope" in SPEC.md.
