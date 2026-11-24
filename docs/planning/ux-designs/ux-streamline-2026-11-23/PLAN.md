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
| 8 | Re-render queue | "Needs changes" can queue a re-render: the Agent drafts the prompt change, the queue shows what was rendered, where and how | 1, 3 |

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

The 68-clip cut was still reading files when it started playing, and played through its first five clips without stopping. "Reopening downloads nothing" now rests on the browser keeping proxies (the gateway change above) and on the proxies held in memory for the session. Released to Hosted Studio the same day as `12fb779` and measured on TR130's 58-clip, 155 s cut after a page reload:

| | Before (`b9cea0d`) | After (`12fb779`) |
| --- | --- | --- |
| Timeline on screen | 3.0 s | 47 ms |
| Playing | 4.3 s | 1.2 s |
| Opened again, timeline / playing | not taken | 0.15 s / 0.31 s |

It played through its first five clips without stopping. The "after" run came second in the same browser, which by then held what the "before" run had fetched, so its 1.2 s to playing is better than a truly cold open would be; the 47 ms does not depend on that.

Status, part five, 2026-11-23 (step 8; local test copy, checked in the browser on a Ghost-written shot of "Blood Rush · The Late Shift"):

- **Shot spec** in Details, read-only, as rows: shot, who, action, says, where, light, camera, length.
- **Prompts by skill section** (`src/lib/domain/prompt-sections.ts`, `src/lib/ui/shots/PromptSections.svelte`). The video prompt shows Ghost's header and eleven sections, one 20px row each; the image prompt shows ONE SHOT's shot, action, place and light. Choosing a row shows that section in full in an editor that is always there, so nothing moves. Editing a section rewrites only that section; the rest of the prompt, headings included, stays as written. A prompt that is not written in sections shows as one row.
- **The check beside the title.** Ghost's stored result reads "Check clean" or "N to fix" with the findings listed. After a hand edit it reads "Edited · checked on send", because the stored result no longer describes the text; the server runs the check again before anything is sent.
- **Make a take: two steps** (`src/lib/domain/make-take.ts`, `src/lib/ui/shots/MakeTake.svelte`). Length, resolution and sound, then "Get price", then a separate "Confirm". Asking for a price spends nothing. Confirm opens only for a price asked for these exact settings and this shot, and only when the pick is a saved still of 2K or more with a prompt. It uses the existing animate route (`estimate`, then `send` with the confirmed price); no session cap or one-click send is offered here.

Checked: on a real Ghost prompt the twelve rows, the four image rows and the spec appear; typing into one section changed only that section; "Get price" returned 12 credits from the provider. Not exercised: Confirm, which would spend credits; its rules are covered by tests.

Released to Hosted Studio the same day as `253c38e`, then `60e5dde`. On hosted TR130 the blocks appear (its prompts are not in sections, so each shows as one row). "Get price" fails there: the server answers 502 and the edge in front of it replaces the app's message with its own page, so `60e5dde` makes the block say so plainly instead of showing nothing. Making takes from Hosted Studio needs the provider set up on the server first; that is outside this plan.

Still open in slice 1: stills in a selection. The older Animate window on the canvas (with its session cap) is still there beside this.

### 2 · Canvas

Goal: the board as a view of Shots where anything can be dragged anywhere.

1. Grid/Canvas toggle in the Shots header; `StoryCardNode` restyled as the canvas card.
2. One drop resolver, test-first, used by grid, canvas and outline: clip on shot is a new take, shot on scene moves it, image on reference is a source image, shot on selection adds it.
3. G groups the selected shots; a scene is a group with a scene code; existing board groups carry over.
4. "Unplaced" section in the outline for groups without a scene code.
5. References as canvas cards, linked to the shots whose prompts use them.

Done when: every drop in the list above works from grid, canvas and outline, and a moved shot keeps its shot code.

Retrospective after slice 1, 2026-11-23 (the `retro` skill), folded in before this slice:

- **Releasing was done by hand four times.** Now `scripts/release-studio.sh <commit>`, described under "Releasing" in `docs/operations/hosted-studio.md`, with a pointer from `AGENTS.md`. It refuses a commit that is not on `origin/main` or was released before, and prints what to record.
- **The look's mechanical rules were checked per component.** Now one test (`tests/ui/look-rules.test.ts`) checks every component in `src/lib/ui/shots` and `src/lib/ui/shell` for borders, pills, circles and bold, so a new file there is covered without its own test.
- **`AGENTS.md` said "no branches" while this work is on one.** It now points at "How the work lands" above.
- Left for the operator to decide: two tests fail on this Mac on every run for reasons outside the code (the local ffmpeg has no `drawtext`; the prompt-skill copies are out of step with the vault); CI is paused, so nothing but the pre-commit env check runs before a push; provider errors answered with 502 reach the browser as the edge's HTML page; the Vercel plugin proposes Next.js guidance for most prompts in this SvelteKit repo.

Status, part one, 2026-11-23 (steps 2 and 3; local test copy):

- **One drop resolver** (`src/lib/domain/drops.ts`, written test-first): files on a shot are new takes of it; files on open space or on a scene are new shots there; a shot on a scene moves it; a shot on the selection joins it; a picture on a reference is a source image; anything else means nothing, with a line saying why. The grid, the outline and the selection strip all ask it.
- **Grid.** Holding files over a shot tints it and says "Drop to add as a take of …"; over open space it says "Drop to add as shots". The old dashed outline and full-screen overlay are gone.
- **Outline.** Each group takes drops: a shot (from the grid or from the outline's own rows) moves there, files become new shots there. A moved shot keeps its number, order and Review Room code (checked on the test project).
- **G.** In the grid, G turns the gathered shots (the selection, else the selected shot) into a new group named "Group N"; on the canvas, G does the same for the boxed shots. No dialog; rename it afterwards.

Checked in the browser: the hints over a shot and over open space, a move from the grid to an outline group and the "Already in this scene" refusal, and G in the grid on two shots. The test project was put back afterwards. Not exercised: an actual file drop on a shot (it would add a file to the project) and G on the canvas; both go through code paths that already existed (`importFiles` with a shot, `create_group` and `move_beats`).

Released to Hosted Studio the same day as `07105a2`, the first release made with `scripts/release-studio.sh`. On hosted TR130 the hints appear over a shot, over open space and over an outline group; nothing was dropped there, so the project was not changed.

Status, part two, 2026-11-23 (steps 1 and 2; local test copy, checked in the browser at 1440px):

- **The canvas card is the grid card** (`src/lib/ui/nodes/StoryCardNode.svelte` now draws `ShotCard`): the pick as a frame with hover-scrub, take marks, title, shot code, status and version. The two face tabs are gone.
- **Its actions float beside it.** Selecting a card shows a bar under it: previous and next take, Bench, Hold, Animate, Finalize, Split, excluded takes, Exclude or Restore, and (in a series) its references and "Prev frame". The card itself never changes size. A draft's time left, "Under 2K", "Excluded" and "Animating…" show as one note over the frame.
- **Details on the canvas.** With one shot selected, the dock's Details tab shows its code, status, story beat, purpose, spec and prompts by section, and the two-step make-a-take block (`src/lib/ui/shots/ShotBrief.svelte`). It is read-only there; the text is edited in Grid.
- **Canvas drops use the same rules.** Files dropped on a card or on open space, and cards dragged onto a group in the side panel, now ask `dropMeaning` like the grid, the outline and the strip do.
- An image prompt is split into shot, action, place and light only when it opens the way ONE SHOT writes it (shot size, angle, dash); a line that merely contains a dash stays one row.

Checked in the browser: the cards and connectors render, selecting one tints it and shows the bar, Details fills in, and Bench then Unbench from the bar changed the shot and put it back. Not exercised, because each would change the test project for good or needs a real pointer drag: the bar's other actions, a file drop on the canvas, and dragging a card onto a side-panel group. Their handlers are the ones the old card used; only the drop decisions were rerouted.

Released to Hosted Studio the same day as `23178da`. On hosted TR130 the canvas shows the new card; selecting it shows the bar and fills Details. Nothing was changed there. In TR130's Main view the one shot sits on top of the seed card; that is where the saved layout puts them, not something this release moved.

Open questions for the operator: the old Animate window (with its session cap) still opens from the bar, beside the new two-step block in Details; and Space or a double-click does not open the viewer from the canvas yet.

Still open in slice 2: references as canvas cards linked to the shots that use them (step 5), the viewer from the canvas, and "Unplaced" in the outline (step 4, which waits for scene codes from the story plan in slice 4). The canvas's side panel and its other node kinds still carry the old look.

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

Status, part one, 2026-11-23 (steps 2 and 3 in this repository; local test copy, connected to the real Review Room):

- **The check is automatic.** While a connected project is open and its window is in view, Review Room's changes are read every ten seconds and at once on coming back to the window (`src/lib/domain/review-poll.ts`, the check itself in `src/routes/+page.svelte`). It is the same merge the "Sync reviews" button ran (`pullTakes`), so new takes, statuses, exclusions and the current version all arrive the same way. The button is gone from the Shots grid.
- **A quiet check costs nothing.** A feed with nothing in it, or the cursor already stored, saves no new project version; before, every pull wrote the cursor. Measured: three checks in 26 s, version unchanged.
- **It never holds up the operator.** The check runs beside the board's own requests, not ahead of them (one takes about 1.6 s from this machine). If a pick or a move collides with an arriving change, it is read again and sent once more.
- **Unsaved edits survive.** A change arriving while a shot is being edited no longer replaces the draft: the edits are kept and everything else is taken from what arrived, field by field (`src/lib/domain/merge-production.ts`). Before, any new project version discarded the unsaved text.
- **A review that could not be sent is kept.** Status and exclusion go to Review Room at once; when it cannot be reached the decision is kept, the shot shows "Not sent", the top bar counts it, and it is tried again with every check (`src/lib/ui/review-room-state.svelte.ts`). A request that can never succeed (a take not stored there) is shown as an error and not kept.
- **The top bar says where things stand:** "in step · 4s", "checking", "not reached · retrying", or how many changes are waiting. A shot Review Room has just changed carries a "Review Room" note for eight seconds.

Checked in the browser: the line moves from "checking" to "in step", checks go out about every ten seconds, and the version stays put when nothing changed. The first check after opening brought in changes that had been waiting in Review Room (version 437 to 439), which is the catch-up working. Not exercised live: a failed send and its retry, and an edit surviving an arriving change; both are covered by tests (19 new) rather than by taking Review Room offline.

Released to Hosted Studio the same day as `a1482a7`. On hosted TR130 the top bar reads "in step", checks go out about every ten seconds and take about 0.7 s each, and the "Sync reviews" button is gone. The first check there took the project from version 346 to 348 (what had been waiting in Review Room, and its place in the feed); it has stayed at 348 since.

Status, part two, 2026-11-23 (step 5 in this repository; local test copy):

- **Links to Review Room** (`src/lib/domain/review-room-links.ts`). A shot's Details (grid and canvas) carries "Review Room"; the viewer's review block carries "Open in Review Room" for the take on screen; the open group in the outline carries "Open in Review Room" for its folder. Each opens in a new tab. The address is `/?project=…&folder=…&asset=…&version=…`, carrying as much as this app knows: the exact version when the take is stored there, else the shot's folder, else the project's folder.
- The browser now learns where Review Room is from the layout (`reviewRoomUrl`, the address only, never the key).
- Until Review Room understands these addresses (step 6), a link opens Review Room on its first project. Episodes of a series get no link yet: their Review Room project id is held in the series record, not on the project.

Survey of `review-room-svelte` (read-only, 2026-11-23), what steps 6 to 8 take there:

- **Addresses (step 6).** Everything that is "open" lives in runes in one file, `src/routes/+page.svelte`; nothing is in the URL, and every owner action reloads the page back to the first project. All data is already on the client after load, so a link only has to apply ids after mount; `openInboxNote` is the existing model. Query parameters on `/` fit (`?sharing=1` already works that way). A shot can be found by its code within a project. Sign-in drops the target today, so a cold link needs a validated `next`.
- **Link back (step 7).** Folders have `ownerApp` but no URL field. One optional field on `projectFolders`, written by the owning credential and limited to https on this app's host, then shown beside the lock.
- **Notes (step 8).** Reviewer comments belong to the shot, not to one version; the timecode is seconds, optional. A read endpoint under the existing key scheme (`media:read`) is one handler and one route. Notes per version would need a new field, and comments already written could not be attributed to a take.
- **How it ships.** A merge to `main` there deploys the app and its database functions to production at once, and a failed check does not undo the database half. Its own rules ask for a written spec and a Linear ticket id in the branch and commit names.

Status, part three, 2026-11-23 (step 4 in this repository; local test copy):

- **Notes in the viewer** (`src/lib/domain/review-notes.ts`, `Viewer.svelte`). The notes reviewers left on the shot in Review Room are listed in the viewer's review block in the order of the picture (timecode, who, text) and marked on the scrub bar as amber rectangles at their timecodes. A click on a row or a mark goes to that moment. A note already dealt with is dimmed; a note with no timecode is listed last and does not seek; a timecode past the end of the take on screen is listed but not marked.
- They are read through this app's server (`action: "notes"` on the Review Room route, then `GET /api/v1/assets/{id}/notes` there) when a shot is opened and again when Review Room reports a change to it. A take that is not stored there, or a Review Room without that address yet, simply shows no notes: the viewer never gets an error for it.
- Notes belong to the shot in Review Room, not to one take, so every take of a shot shows the same notes.

Checked in the browser with stand-in notes fed to the page (Review Room cannot return any until step 8 ships): three marks at the right places, four rows in order, a click moved the picture to the note. Against the real Review Room today the answer is "none available", as intended.

Status, part four, 2026-11-23 (steps 6 to 8, in `review-room-svelte`; built by a second agent on its own branch, reviewed here, then pushed to that repo's `main` on the operator's word, which deployed it):

- **Addresses (step 6).** What is open in Review Room's workspace is now in its address: `/?project=…&folder=…&asset=<id or shot code>&version=<id or v003>&t=<seconds>`. A link or a reload lands on the same thing; unknown or archived parts fall back to the deepest part that exists. Sign-in remembers where the link was going (a same-site path only).
- **Link back (step 7).** A locked folder can carry an https address for its page in this app, set only by the credential that owns it, shown as "Open in Creative Studio Pro" beside the folder path and in its menu.
- **Notes (step 8).** `GET /api/v1/assets/{assetId}/notes` for `media:read` keys returns a shot's notes with their timecodes, in the shape this app's viewer reads.
- Review Room commit `c880092` (five commits on top of `acfcccc`). Its own checks on the branch: no type errors, 330 tests pass (296 before), build succeeds. Its deploy workflow finished successfully.

Checked after the deploy: an anonymous request to `/` still goes to plain sign-in; one carrying an address goes to sign-in with the address kept; the notes address refuses a request with no key (401) and, asked through this app with the real key, answers for twelve stored takes (none of them has a note yet). A link from this app to a stored version was opened in the browser and reached Review Room's sign-in with the address intact; landing on the version after signing in has not been watched, because the browser here is not signed in to Review Room.

Not done there: no Linear ticket exists for the work, so the commits carry no ticket id; the unmerged "keep me signed in" branch (`origin/feat/keep-signed-in`) will meet two small conflicts in the sign-in page, each resolved by keeping both changes; the in-app agents page was not updated (the API document and OpenAPI file were).

This app's links and notes were released to Hosted Studio the same day as `337de5e`: on hosted TR130 the three links appear and the notes read answers for 25 stored takes (none has a note yet).

Status, part five, 2026-11-23 (the operator's requirement: "see and select between the takes easily, and the current take must update live between the two"; plus the link back):

- **Takes on the card.** A shot with more than one take shows them as marks at rest. While the card is hovered, selected or focused the marks open into one labelled chip per take (`v001`, `v002`, or `T1` for a take not stored yet). Hovering a chip shows that take in the frame; clicking it makes it the pick. The card never changes size. It works the same in the grid and on the canvas (`ShotCard.svelte`).
- **A pick always reaches Review Room or says so.** Making a take the pick sets Review Room's current version at once. Before, a failure there was swallowed; now the answer reports it, the shot shows "Not sent", and the pick is sent again with every check until it lands (`action: "current"`). A newer pick on the same shot withdraws an older one still waiting.
- **Review Room to here** was already in place from part one: its current version becomes the pick here within ten seconds, and at once on coming back to this window.
- **Review Room's own screen** did not notice changes made elsewhere until reloaded. That is being built in `review-room-svelte` on a branch (`live-current-version`): an open workspace follows the current version, status and exclusions within about ten seconds and on focus.
- **The link back** (step 7, this app's half). Once per opened project, this app writes its own address for the project into every locked folder it owns in Review Room (`action: "link_back"`, then one PATCH per folder), so "Open in Creative Studio Pro" appears there. The address comes from `ORIGIN`, the setting the server already has; a copy without an https address (a local test copy) writes nothing. What was written is remembered on the project (`review_room.link`), so it is not repeated until folders are added.

Checked on the local test copy: a two-take shot showed chips on selection, hovering the other chip showed its frame, clicking it made it the pick with nothing left waiting, the pick held through the next check, and clicking back restored it; the card stayed 158px tall throughout. Not exercised: a pick failing to reach Review Room (covered by tests), and the link back, which only a copy with an https address performs.

Still open in slice 3: watching a link land on its version after Review Room's sign-in, and shipping Review Room's live refresh. The episode outline's own button, which also stores takes that are not in Review Room yet, is unchanged.

### 4 · Front door and story plan

Goal: from nothing to an approved shot list in one conversation, with names that hold.

1. Front door screen replacing `NewProjectFlow`, `TrailerHousePanel` and the `BriefPanel` form: one input, drop targets, example phrases in two groups, the expand motion.
2. Agent actions: pitch three loglines, three more, quick teaser. The Agent drafts the brief; remove the rule that blocks the interview on an unlocked brief.
3. Story plan levels with an approval state each (brief, acts, scenes, story beats, shot list), shown in the outline and in `StoryPlan`.
4. Name locking, test-first: approving a level assigns its codes once; a code cannot change afterwards, a title can.
5. Notion: a key field in Settings stored server-side (the `NOTION_TOKEN` variable stays as a fallback), writes to Notion only when a key is present, the public template link on the front door.
6. Publish the series template as a public Notion page. This is a step for the operator; the plan only needs its address.

Done when: a project can go from one sentence to an approved shot list with no Notion key, and no code changes after its level is approved.

Status, part one, 2026-11-24 (steps 3 and 4 as rules; no screen yet):

- **The five levels and their states** (`src/lib/domain/story-levels.ts`, written test-first from the parked draft): brief, acts, scenes, story beats, shot list. A level is empty until it holds something, proposed until approved, and levels are approved in order. Something added to an approved level (a scene with no code, a story beat not approved, a shot with no shot code) puts it back to proposed until it is approved again.
- **What approving fixes.** The brief fixes the show code and the project code (suggested from the brief's title, `TR100` unless given; a project already in Review Room keeps the codes it has there). Scenes fix each scene code (three capitals from the title, by the rule show codes already follow). Story beats approve each beat. The shot list puts the planned shots on the board and gives each its shot code: tens within its scene, a number between its neighbours for a shot added later, never a number the scene once gave.
- **A shot's code is its own.** A shot now carries the scene code it was numbered under (`scene_code` beside `shot_number`), so `BLR_TR100_VHA_0020` stays that when the shot moves to another scene. Review Room registers a named shot under that name.
- **Where approvals are stored:** `production.story_levels` (when each level was approved, and the two codes the brief fixed). Only approving a level writes it.
- **Where the lock is enforced:** in the gateway. `approveStoryLevel` is the one command that approves and names. `saveProduction`, which every whole-project save goes through, keeps the stored approvals whatever it is sent, puts back a fixed code the incoming copy does not carry (a draft made before the approval), and refuses a save that changes a fixed code or hands it to something else ("Scene code VHA is fixed: its level is approved, so only the title can change"). A title always saves.
- Changed from the draft test: scene codes follow the existing rule, so "The rooftop leap" is `RFL`, not `RLP`; a shot with no room between its neighbours takes the next ten after the scene's last number (`0020`, not `0021`); the lock compares shot codes (`VHA_0010`), not bare numbers.

Checked: 28 new tests (rules, the gateway on a real store, Review Room registration with a fake client); `bun run check`, `bun test` (the two known failures only), `check:env`, `build`. Nothing to see in the browser yet.

Not done here: an episode imported from a Notion series keeps its own codes and lock (`setShotCodes`, the series' "codes locked"); the levels read the story plan, which such an episode does not have. A code freed by removing its scene is not remembered, so a later scene could be given it; Review Room already refuses that for scenes it holds.

Status, part two, 2026-11-24 (steps 3 and 4 on screen; local test copy, checked in the browser at 1440px and 375px):

- **The story plan is one level at a time** (`src/lib/ui/StoryPlan.svelte`, rewritten in the look). Its bar carries the five levels, where the open one stands ("5 proposed"), the level's Add button, Save while something is unsaved, and one approve button ("Approve 5 scenes", "Approve 1 new scene"). Approving saves what is on screen first. A row is selected with a teal fill and edited in a pane beside the list, so the list never moves.
- **The notice comes before the button.** The line under the bar reads "Names lock on approve · Approving the scenes fixes each scene code. Titles can still change." whenever the level can be approved, says why when it cannot ("Approve the acts first"), and after approval says what is now fixed. A fixed code is shown as text, never as a field.
- **The brief is a level, not a form to lock** (`src/lib/ui/story/BriefSheet.svelte`): drafted by the Agent or typed, saved, approved. The show code and project code sit above it, suggested (from the brief's title, `TR100`) and editable until the brief is approved.
- **By hand as well as by the Agent.** Acts, scenes, story beats and planned shots can each be added, changed and removed here; the Agent's existing proposals (story beats from the source, shots for a beat) are buttons in the same places.
- **The outline** (`src/lib/ui/shell/Outline.svelte`) lists the five levels with their state on top; clicking one opens it on the Story stage. Under them, scenes with their scene codes in story order, then **Unplaced** for groups that are not scenes (slice 2, step 4). A shot shows its own number even after it has moved.
- **The "Next" line** follows the levels while a project is being planned here ("Approve the scenes, then story beats"), then goes back to the line about shots.
- A plan route action, `approve_level`, approves through the gateway; for a trailer stored in Review Room, approving the shot list also makes its scene folders and registers the shots there, as "Add to Board" did.
- Fixed on the way: the outline panel had a one-pixel frame since slice 0 (its class was named `outline`, which is also a Tailwind utility). A test now refuses local classes named after layout utilities in the new screens.

Checked in the browser on a scratch project made for this ("Slice 4 check (scratch)", no Notion, no Review Room): brief typed and approved (codes `LTF`, `TR100`), three acts approved, a scene added and approved (`VHA`), a story beat added and approved, two shots added and the shot list approved (`VHA_0010`, `VHA_0020`, benched on the board). A request that tried to change the approved scene code was refused with "Scene code VHA is fixed: its level is approved, so only the title can change". At 375px nothing overflows; the pane sits under the list.

Not exercised: the two Agent buttons (they call the model), and approving the shot list of a trailer connected to Review Room (it would create folders there); the second is covered by tests with a fake client.

Status, part three, 2026-11-24 (step 1; local test copy, checked in the browser at 1440px and 375px):

- **The front door** (`src/lib/ui/story/FrontDoor.svelte`) takes the place of the work, not a dialog over it: "What are we making?", one input, and four drop targets on it (Notion series, Show folder, Images or video, Song). Anything can be dropped on the screen or picked from a target; what is held shows on its target and can be let go. "New project" in the menu opens it, an app with no projects opens on it, and `/?new` links to it. The outline beside it lists the five levels a new project will go through.
- **The two groups of example phrases** open under the input once it is clicked or typed in (180ms, off under reduced motion); the input itself does not move. A phrase from "You have nothing yet" turns Start into "Pitch three".
- **What a start means is a rule** (`src/lib/domain/front-door.ts`, test-first): one sentence starts from the idea; a Notion link (picked, pasted or typed into the sentence) or a show folder's text starts from the story; an ask for a pitch, or nothing at all, starts with the Agent pitching; pictures, clips or a song alone still start a project. A dropped folder's text files are the story, its pictures and clips become shots (unplaced), a song becomes the score.
- **Every new project has a story plan from the first second** (three empty acts), so its levels show at once. Until the brief names it, a project is called by its first sentence cut at a word; a project still carrying that name takes the brief's title when the brief is approved.
- After a start the app opens the brief level and the Agent's dock, and records what the Agent should do first (draft the brief, or pitch): part four acts on it.
- **Gone:** the start dialog (`NewProjectFlow.svelte`) and the brief form with its lock field (`BriefPanel.svelte`). A project with a story plan now shows only the plan on Story. A project from before the plan keeps its notes with the new brief sheet, and can be given a plan with "Start a story plan"; an episode imported from a series keeps its outline.

Checked in the browser: the door with a project open behind it and its way back, the examples opening on focus, a phrase chosen (teal, "Pitch three"), a sentence typed ("Start"), and a start that made "It's a vampire thing, but it all happens in a…" and landed on its brief level with the Agent docked. No request went to a model. At 375px the headline stays on one line and nothing overflows.

Not exercised: dropping or picking real files, a folder or a song, and starting from a Notion link (each would upload to the scratch project or read Notion); their sorting and routing are covered by the rule tests, and the upload paths are the ones the Shots stage and the score already use. The Trailer House panel still stands on projects without a story plan until part four replaces it.

Status, part four, 2026-11-24 (step 2; local test copy, checked in the browser with the model's answers stood in for):

- **The Agent's actions** (`src/lib/ui/story/agent-work.svelte.ts`): pitch three loglines, three more, "Make this", quick teaser, draft the brief, and propose a level. Each is one function, offered both in place (the pitch, the brief, the story plan's bar) and in the Agent's dock (`AgentActions.svelte`), and each says what it is doing and what came of it in the dock ("Proposing the scenes…", then "2 scenes proposed. Read them, change anything, then approve.").
- **The Agent leads.** A project started from a sentence has its brief drafted at once; one started with nothing has three loglines pitched at once. It happens once, for the project just started, never again on a reload.
- **The pitch** (`Pitch.svelte`, on the brief level): three loglines with "Make this", "Three more" with a place to say what is off, and the quick teaser of the pick. "Make this" (a new `pick` action, no model) makes the logline the project's and the plan's source, and the Agent drafts the brief from it. The teaser's writing is the Agent's; its price and Confirm are two separate steps of the operator's, and the Agent's actions never reach the render route.
- **The Agent proposes every level** (`src/lib/server/story-propose.ts`, plan action `propose`): acts, scenes, story beats, shots, each from the brief and the levels above. What it may put where is a rule (`src/lib/domain/story-propose.ts`): a proposal fills what is empty and never replaces or removes what is there. Story beats are made to add up to the brief's length less what is already planned; shots to their beat. It replaces the old one-step proposal that rewrote acts and beats together.
- **The interview no longer waits for a locked brief.** It opens at once, reads the brief when there is one and the idea when there is not, and its rounds are recorded as before. A brief can be redrafted at any time; only a version carrying the old lock with interview rounds against it stays fixed. The stage gate panel lost its brief form.
- **Gone:** the Trailer House panel. Not carried over from it: the main-character text and reference image, the choice of video model and aspect for the teaser (it is Seedance 2.5 at 16:9; the length can be set), the live highlighting of what the prompt check finds, and the "characters" and "outline" continuations, which the story plan and Prep now cover. Teasers already made keep everything they had.

Checked in the browser on scratch projects, with the page answering in the model's place (a stand-in for `fetch` installed for the check; `brief/draft`, `pitch` and `propose` never reached the server's model): from the sentence "A night clerk at a dying video store learns the regulars are not renting for the movies." the brief was drafted unasked and approved (the project became "Late Fees", codes `LTF` `TR100`), then acts, scenes, story beats and shots were each proposed and approved, ending with four shots on the list (`VHA_0010`, `VHA_0020`, `CDB_0010`, `CDB_0020`), no Notion and no Review Room. On a second project the pitch path: a failed pitch is said in the dock in red; with three stand-in loglines, "Make this" picked one for real, drafted the brief from it, and the quick teaser bar offered Write teaser, then Get price and Confirm.

**Not exercised live, because each costs money:** every call to the Agent's model (drafting the brief, pitching, the teaser, proposing acts, scenes, story beats and shots, the interview) and the teaser's price and render. They are covered by tests with the suite's fake model (`tests/integration/story-propose.test.ts`, `brief-draft`, `trailer-house`, `stage-agent-handler`), which check what is asked, what is accepted, and what is refused; whether the real model's answers are any good has not been seen.

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

### 8 · Re-render queue

Added 2026-11-24 at the operator's request; not designed yet. Their words: "there should be a choice when you say needs revision on the right panel, to say 'add to queue for re-render' and we come up with a system to queue files and ai write the new prompt changes and just have it queued for rerendering it would then show complete in the render queue and where/how it was rendered ie. (higgsfield, fal.ai, local or cloud comfyui)".

Goal (to be confirmed in the design): from "Needs changes" to a new take without leaving the review.

1. Grill the design with the operator and write the decisions down before any code (the `grilling` and `domain-modeling` skills): what a queue entry is, who may spend, how a provider is chosen, what "where and how it was rendered" shows, per project or across projects, whether a finished re-render becomes the pick.
2. The rest of the steps come out of step 1.

What exists to build on, and the open questions, are in `HANDOFF.md` under slice 8.

## Not in this plan

See "Out of scope" in SPEC.md.
