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

Status, 2026-11-23: the first part is built and checked in the browser on the local copy at 1440px and 375px.

- Done (steps 2, 3 in part, 8 in part): the new shot card (`src/lib/ui/shots/ShotCard.svelte`, facts in `src/lib/domain/shot-card.ts`); selecting a shot moves nothing; a fixed takes band under the grid where a click makes another take the pick (`TakesBand.svelte`); a Details tab in the dock holding the title, story beat, purpose, prompts, bench, remove, title card and take review that the old card carried.
- Not done yet: the playback measurements (step 1, to be taken before any playback code changes), the selection timeline in the band and the selection strip (3, 4), the viewer and its keys (5), frame strips (6), progressive timeline loading (7), prompts shown by skill section and the price and confirm steps in Details (8).
- The toolbars above the grid (add files, score, first cut) keep their old look for now.

Status, part two, 2026-11-23 (local test copy, Blood Rush teaser, 82 shots):

Measured before any playback change:

| What | Result |
| --- | --- |
| Hovering a shot until it plays (GPU frame bank) | 450–800 ms; the whole proxy (0.6–1.3 MB) is downloaded and decoded first |
| Opening a 62-clip cut, all video, first time | 10.0 s, most of it making 480p proxies on first request |
| Opening the same cut again | 0.12 s to the timeline, 0.30 s to playing |
| Opening a cut that contains stills (68 clips, 9 stills) | never: the first still failed as "unsupported format" and the cut stayed on "loading 34/68" |

Two of the project's seven cuts held stills, so this was the "long timeline will not play" problem. Not a loading-speed problem locally.

Built:

- **Stills play in a cut.** A picture is one frame held for as long as the cut entry says (`src/lib/media/stills.ts`, `ResidentFrameBank.loadStill`, `clipBanks.ts`). The 68-clip cut now opens in 0.39 s and plays through its stills.
- **One unreadable clip no longer stops a timeline.** The rest plays, the cut opens read-only, and a line names what was left out.
- **The viewer** (`src/lib/ui/shots/Viewer.svelte`, keys in `src/lib/domain/viewer-keys.ts`): opens over the grid on Space, Enter or a double-click; plays the take from its 480p proxy in a plain video element; arrows step shots and takes; J K L, P, X, 1–4, Esc; a scrub bar that thickens on hover with a rectangular playhead and amber timecode; takes with version, file name and state. Its review controls (status, Make pick, Exclude, the stored name) sit at the top of the dock's Details tab.
- Selecting a shot fetches its pick's proxy; the viewer fetches the neighbouring shots' proxies.

Measured after: the viewer is on screen 6–27 ms after Space with the take's still; the take is playing after 100–140 ms when its proxy was already fetched, and after 400–900 ms when it was not.

Status, part three, 2026-11-23 (local test copy, checked in the browser at 1440px and 375px):

- **Frame strips** (step 6). One JPEG per video take holding 24 frames of 160px side by side, read from the 480p proxy (`src/lib/server/video-strips.ts`, shared numbers in `src/lib/media/strips.ts`). Served as `?strip=1` on the files route, made when a take arrives and, for older takes, on first request (three ffmpeg runs at a time). About 50 KB each on this project.
- **Hover-scrub on shot cards.** Moving across a card's frame walks the pick's kept span through its strip; nothing is decoded. Strips for the cards on screen are fetched ahead, three at a time, so the first hover does not wait. This replaces hover-to-play on the grid (450–800 ms before the first frame); playing with sound is the viewer's job. A video that is not a project file still uses the old hover player.
- **Viewer lanes** (step 5). The frame strip, the scrub bar and the take's own sound are three lanes with fixed heights under one rectangular playhead. Hovering shows the frame at the pointer above the bar with its amber timecode. The played part of the waveform is teal. The playhead now follows the picture every frame instead of a few times a second.
- **Selection strip** (steps 3, 4). Beside the takes band, same 56px height (stacked when the work area is under 720px wide). Rules in `src/lib/domain/selection.ts`; the strip, the canvas and the sequence player share one selection (`src/lib/ui/review-sequence.svelte.ts`).
  - A shot joins by shift-click or by being dragged onto the strip; its card shows its place. On touch there is an Add button.
  - Entries are as wide as they are long. Dragging inside the strip reorders; a teal bar shows where a drop lands.
  - On a focused entry: ↑↓ auditions another video take (the pick is never written), ⌥←→ moves it, ⌫ takes it out, Space plays.
  - Play opens the existing sequence player on the selection. Push to cut saves the order, takes, trims and ramps as "Cut N" in one click.
  - Takes that arrived before lengths were recorded have their length read from the proxy, so the running length and the push still work.

Not exercised against the project: Push to cut from the strip (covered by a domain test that runs its entries through the cut rules), so the test copy gained no cut.

Measured on Hosted Studio, 2026-11-23 (studio.v1su4.com, still running `main`; project TR130, 57 shots, 120 takes):

| What | Result |
| --- | --- |
| Any media request, time to first byte | 190–840 ms, through the Vercel gateway to the App VM |
| A poster (10–23 KB) | 180–650 ms each; 14 at once had a median of 705 ms |
| A normal take's 480p proxy (65–283 KB) | 220–1,640 ms, and the same again on every repeat |
| The 2:35 trailer's proxy (14 MB) | 10.3 s the first time, 2.6 s the second (about 5 MB/s) |
| Kept by the browser between requests | nothing: the gateway answers every request `Cache-Control: private, no-store` (`scripts/build-studio-gateway.ts`), replacing the app's own `private, max-age=86400` on proxies and posters |

So on Hosted Studio every hover, every viewer open and every cut reopen downloads its media again, at 0.2–1.6 s a file. The local numbers above (a cut reopening in 0.1–0.4 s, a prefetched take playing in 100–140 ms) do not carry over until that changes. (Slices 0 and 1 were published to Hosted Studio later that day as `b9cea0d`; on TR130 the viewer was on screen in 37 ms and playing in 414 ms the first time, 43 ms the second.)

Settled 2026-11-23 (the open question above): the signed-in browser may keep proxies, posters, frame strips and picture thumbnails; Vercel's CDN still stores nothing, and pages, project data and original files stay `no-store`. The gateway now leaves the app's own `Cache-Control` on those four kinds of request (`scripts/build-studio-gateway.ts`, rule written down in `docs/operations/hosted-studio.md`). It went live the same day as `b51a5b4` on `main` (Vercel deploys the gateway on every push to `main`; the app on the App VM was not touched).

Measured again on TR130 right after that deploy, same four takes:

| What | Before | After |
| --- | --- | --- |
| A take's proxy, first request | 340–1,640 ms | 305–830 ms (unchanged in kind: one trip to the App VM) |
| The same proxy again | 220–1,290 ms | 3–8 ms, from the browser |
| A poster again | 180–650 ms | 3–6 ms, from the browser |
| Header on proxies and posters | `private, no-store` | `private, max-age=86400` |
| Header on the page, project data and an original file | `private, no-store` | `private, no-store` |
| Vercel's CDN | stores nothing | stores nothing (`x-vercel-cache: MISS` on every request) |

Status, part four, 2026-11-23 (step 7; local test copy, after a page reload so nothing was held in memory):

- **A timeline opens from what is already known.** A cut entry says where its clip starts and ends, and most takes have a recorded length, so the player lays the timeline out and starts at once. Each file's real length, frame rate and sound are read afterwards in play order, four at a time, and settle the clip in place (`src/lib/media/timeline-open.ts`, `SequencePlayer.svelte`). Only a clip with no known length is read first. Before this, every file was read before anything was shown.
- A save waits until every file has been read, so an assumed length is never written. A file that cannot be read is taken out when that is found, and the cut turns read-only as before.
- Compressed proxies for the next eight clips are fetched ahead of the playhead.
- While the clip at the playhead has no frame in memory, the nearest frame of its strip stands in for the picture.

| Cut | Timeline on screen | Playing | Every file read |
| --- | --- | --- | --- |
| 4 clips | 37 ms | 211 ms | 59 ms |
| 46 clips | 61 ms | 389 ms | 389 ms |
| 62 clips, all video | 117 ms | 391 ms | 281 ms |
| 68 clips, 9 stills | 72 ms | 281 ms | 509 ms |

The 68-clip cut was still reading files when it started playing, and played through its first five clips without stopping. "Reopening downloads nothing" now rests on the browser keeping proxies (the gateway change above) and on the proxies held in memory for the session. Not yet measured on Hosted Studio: this part is not released.

Still open in slice 1: releasing and measuring part four on Hosted Studio (step 7), prompts by skill section, and the price and confirm steps (step 8). A still pick does not play in a selection yet.

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
