# Handoff: streamlined Creative Studio Pro

Written 2026-11-24 so each remaining slice can be carried on in its own thread. Read this first, then the slice's
section in `PLAN.md` (same folder), which holds the dated status notes for everything already built.

## Start here: the change of course on 2026-11-24 (evening)

The operator looked at the local copy beside the agreed mocks and said the app is "a mix of a hot mess": new pieces around old screens, wrong names, and stale test material. Everything below this section is still true as a record of what was built, but **the way of working has changed**. Read this section first; it wins where it disagrees with the rest.

### Next session starts here (2026-11-25)

- **Grilled and decided (2026-11-25): ADR 0012**, Notion is the master of names, edited from the app, with a drift
  check (supersedes 0010; glossary: Drift check, Old). The checker is built in **Prep's turn**, not now. Next:
  `/to-spec` and `/to-tickets` for it, plus one ticket per approved audition screen.
- **Voice, open for the voice slice:** the operator now wants the voice Agent to answer with its own voice model
  under a master prompt that keeps it to the house structure, free to talk creatively ("does this sequence work
  together? let me watch it"), cost and quality to be tried. That reopens ADR 0009. Look at OpenAI's realtime API
  and Trigger.dev's realtime voice support then, not before.
- **Bug found while grilling:** `connectSeries` (`src/lib/server/series.ts:99`) rebuilds the series record without
  `notion_trash`, so every refresh or sync drops the queue of shot pages waiting to be trashed in Notion.
- **Auditions are the mocks now**, built on TR130's real material, in the old session's scratchpad (`cards/`:
  `shots.html`, `story.html`, `prep.html`, served by a temporary `look-preview` entry in `.claude/launch.json`,
  since removed). The scratchpad may be gone; the decisions are in `issues/01`–`04`. If the files are gone,
  rebuild from those notes, not from memory.
- **Nothing was built in the app and nothing is committed.** Don't send TR110's sixteen references or the three
  stray Review Room sheets (Lucian Vale, Bryson, Kai's sunglasses) by hand; the checker is meant to fix them.

### How to work now

- **One screen at a time, finished completely before the next.** Finished means: it works, it matches its mock on the canvas (https://claude.ai/artifact/GcSURykGvjJGXujETaqa1m), it shows the right names, and the operator has looked at it with real TR130 material and said yes. No more wrapping new chrome round an old screen and calling the slice built. Their words: "this whole mix and match thing was not the best approach."
- **Issues, one at a time, live in `issues/` beside this file.** The first is `issues/01-shots-grid.md` (the Shots grid against its mock, with what differs today and when it is done).
- **Order:** Shots (grid, takes, viewer), Prep, Story, Canvas, Cut, Settings. New features (the render queue's remaining steps, voice) wait for the screens they live on.
- **The main session orchestrates; subagents build.** The operator asked that the main session only plan, brief, review and report, and that implementation go to subagents or sessions on Opus 5.5 at medium effort. Check their report against the diff and in the browser before telling the operator it is done.
- **Say plainly when a screen does not yet look like its mock.** "Built" in the status notes below meant "works and tested", and the operator read it as "looks like the mock". That gap is what caused the surprise.
- Still true: no release and no push to `main` without their word; no PR unless they say so; never change real data on Hosted Studio.

### The real material is now on this Mac

- **TR130 — Teaser Trailer** (`?project=01a2067a-6cdc-7d1f-b28c-19429297cb80`) was copied down from Hosted Studio on 2026-11-24, one way, read only on the server. 57 shots, 120 takes (all files in its own folder), one cut. **Judge every screen with this project**, not with "Blood Rush — Teaser Trailer", which is the old TR100 source pool the operator calls garbage.
- **It is connected to the real TR130 in Review Room.** A pick or a review made locally changes Review Room. Look; do not press.
- The series record and its reference cache (`data/series/`) were refreshed from the server too (the local character sheets were out of date). What was replaced is in `data/series/archive/before-hosted-copy-2026-11-24/`.
- **TR110 and TR105 are here now** (copied down on 2026-11-24 at the operator's word, one way, read only on the server: TR110 `01a1f301…` 264 files 3.0 GB, TR105 `01a1df26…` 160 files 539 MB). TR130's references come from TR110's Prep (`story_plan.prep_source_project_id`), which points at TR105, which points at The Late Shift; the whole chain is on this Mac. Both open in the local app. Like TR130, they are connected to the real Review Room: look, do not press.
- **This Mac's series record is behind Review Room**: Review Room's series project holds Lucian Vale, Kai's sunglasses and a Bryson sheet that `data/series/3fc8…json` does not list. Found read only on 2026-11-24 (`GET /changes`).
- **The route to the server** is in the vault note `04-Projects/Proxmox Home/Tailscale Agent Access.md`: Tailscale SSH, `gordo@app-vm`, data at `/opt/creative-studio-pro/data/`. Tailscale has to be running on this Mac, and the first connection asks the operator to approve a check in the browser. The LAN address refuses this Mac's key.
- The operator has not confirmed the current sheets look right here (grey background, headshot on the far right, headless body not scaled up).

### Names (the operator's rule; the display is fixed, see below)

- A shot is `BLR_TR130_DRP_0010`: show, trailer (`TR` stands where `EP` would), scene code, shot number in four digits counting in tens. A take adds `_v001`. These already exist for 56 of TR130's 57 shots, but **only in the Review Room connection** (`project.review_room.shots[card_id].code`, and `asset.review_room.code` / `.version`); the cards have no `scene_code` or `shot_number`, so the app showed "01" and file names.
- **Scene codes are set in Review Room and must never be changed**: `DRP MRN SUN KAI VHV RMT TER PTY PCK RFS CAM`.
- **Decided 2026-11-24: a shot is its code plus one line, nothing else.** The code is its only name; under it sits the shot line (what happens), stored as the card's `title`. On TR130 the cards also carry `beat` (the same text on 56 of 57) and `purpose` (copy history: "TR130 shot from the TR110 v004 rebuild (was …)"). Neither is shown as a name or a description; that double and triple labelling is what made names confusing. The 57th card is the whole trailer as one video ("TR130 TRL01 v001 (2-35) exact mix"), the unsplit-video naming case below.
- **Way of working, decided the same evening:** look and behaviour are built together, one screen at a time, to its mock, judged on TR130. No "structure first, style later".
- A scene is shown one way everywhere: `DRP · The sealed drop and the hood`. The board group's name "TR130 01 · …" (the "01" is only the scene's order) means nothing to the operator and is not shown.
- **Done on 2026-11-24 (`176495e`), display only, nothing written to the project.** `shotCode`, `shortName` and `takeName` in `src/lib/domain/shot-card.ts`; `sceneLabel` and `shotListAsItStands` in `src/lib/domain/story-levels.ts`. On TR130 the grid cards and the outline show `DRP_0010` (the full code on hover and in the card's spoken label), the takes band, viewer header, review block and Details show the full code, the viewer's takes list shows `BLR_TR130_PCK_0010_v001` or `BLR_TR130_PCK_0010 Take 2` with the file name beneath, scenes read by code and title, and the Story page's shot list shows the 57 board shots under the 11 scenes. Checked by the main session on the grid and outline; the rest is the subagent's report.
- Left as they were: take chips and takes-band thumbnails are too small for a full name and keep `v001` / `T2` with the name on hover; the Story bar and outline still say "Shot list · 57 proposed" and acts read "0s" (level state was not touched); the Cut stage (`SequencePlayer`, `CutOutline`) still uses the old labels; phone width was not checked.
- Not settled: what a take that is not yet stored in Review Room shows for its version, and how a single longer video that covers several shots without being split is named. Follow what Review Room shows.

### The Story page: proposed, liked, not yet approved in so many words

The operator finds five levels (Brief, Acts, Scenes, Story beats, Shot list) "a little convoluted"; of the proposal below they said "this looks a lot clearer" and asked for it to be fleshed out before it is built.

- **Three steps instead of five: Brief, Scenes, Shot list.** Acts become plain headings over the scenes. Story beats stop being a step: by the glossary and the story-interview skill they are the season's Save the Cat moments from the Bible, and a scene carries them; show them on the scenes that carry them.
- Each scene shows its code, its name, a line or two on what happens (its Action), and the story beats it carries. Approving Scenes locks scene codes; approving the Shot list locks shot numbers.
- The shot list is the board's shots, by scene, with their names. In TR130 the plan holds no shots and no beats; its 57 shots are board cards whose group is the scene's group.
- The Bible (Notion, imported as read-only text in `story_plan.source`) should fill the brief and each scene's "what happens" as a draft for the operator to approve. It must not rename scenes or change codes. TR130's brief is empty and its acts carry placeholder text.
- **Do not carry the story across from TR110.** The operator said so explicitly. TR110 has 26 written beats and no scenes; TR130 has 11 scenes and no beats; leave it that way.
- To flesh out: how levels and approvals in `src/lib/domain/story-levels.ts` and `production.story_levels` change, what happens to episodes (which may keep all five), and a mock of the three-step page agreed before it is built.

### The look: what was decided today and what is still open

- **The Agent's panel is decided and built** (`0935565`): a chat and nothing else, a purple wash rising from the composer, the word "Agent" in muted purple, no pink, no boxes, everything else behind "More". `DECISIONS.md` ("the Agent chat's look, decided again") has the rules; the mocks still show the earlier pink version. It has not been seen with a real conversation in it.
- **The selection green goes.** The dark green selection fill (`--color-selected`, `#10221f`, taken from Review Room) clashes with the teal; the operator regrets pointing at Review Room for it. Proposed and not yet chosen: a neutral grey fill, teal kept for the pick, approved and the main button. Show options on a mock before changing the token.
- **No outlines, no boxes, rounded not square.** Every screen not yet rebuilt still has the old square, bordered, blue-green style: most of Story below the plan, Prep, the canvas's left panel and its Seed, Voice and Scene cards, Settings. That is unfinished work, not a design choice.
- The Story page does not make its steps obvious; the operator only understood it once it was spelled out.
- Earlier-round mocks (options A, B, C) exist only in an old session's scratch folder and may be gone; the canvas holds the seven agreed look-B screens. Cut was never on the canvas.

### Where the code stands

- `ux-streamline` was pushed to GitHub for the first time on 2026-11-24 at `12a751b` (a backup; no PR, `main` untouched at `337de5e`, nothing released). Anything committed after that is local until pushed again.
- **Slice 7 (Cut) was merged into `ux-streamline` by its own session** (`6c651bb`, `12a751b`). Nobody has reviewed that merge; its session says lock, mix, export and QC were not pressed for real. Review it when Cut's turn comes.
- **Slice 6 (Prep intake) is on `refs/heads/slice-6-prep-intake`**, five commits, unmerged and unreviewed; its session says only stand-ins have sorted anything, not the real model.
- **Slice 8 (render queue) is paused** with steps 1 to 4 and 9 built (see its status note in `PLAN.md`): a take marked Needs changes can be queued and its prompt change approved, draft mode and Finalize are gone, and nothing can be priced or sent yet.

### Questions waiting on the operator

1. Three-step Story page: go ahead as described?
2. Selection colour: which option, once shown.
3. Copy TR110 and TR105 down so Prep can be judged?
4. Unstored takes and unsplit grouped videos: how are they named?
5. Does the operator want `ux-streamline` pushed after each piece from now on? They said "I thought we were pushing as we went."

## What to read, in order

1. This file: where things stand, the rules, and your slice's section below.
2. `PLAN.md`: the eight slices, their steps and "Done when", and a status note under each for what is built.
3. `DESIGN.md`: the look (ten hard rules, tokens, components). `SPEC.md`: the 70 user stories and decisions.
   `DECISIONS.md`: why. `mockups/`: the agreed screens (also https://claude.ai/artifact/GcSURykGvjJGXujETaqa1m).
4. Root `CONTEXT.md` (glossary: Shot, Take, Pick, Selection, Cut, Stage, Viewer, Render…) and `docs/adr/0007`–`0011`.
5. `docs/operations/hosted-studio.md`, "Releasing".

## Where things stand (2026-11-24)

| | |
| --- | --- |
| Working branch | `ux-streamline`, local only (never pushed as a branch) |
| Branch tip | slice 4's five commits (`a83b2d0` to `d2a140f`), the slice 8 design merged in (`7e385ac`), then slice 8's first steps (`a168df8`, `73b884e`, `40c5c83`) |
| `main` on GitHub | `337de5e` |
| Hosted Studio (studio.v1su4.com) | gateway and app both at `337de5e`; rollback image `rollback-a1482a7` |
| Not released | everything after `337de5e`: `d81b3cc` (take chips on the card, picks that are kept and resent, the link back) and all of slice 4 |
| Review Room (`review-room-svelte`) | `main` at `43b2512` on GitHub; the local checkout was pulled to it on 2026-11-24 (the operator's phone work is in it). Its live refresh of the owner workspace is on `main` (`src/lib/live-refresh.ts`). Every local branch there is already in `main` |
| Other branches here | none with work of their own: `claude/gracious-easley-99511a` (the slice 8 design, with its worktree) is merged into `ux-streamline` |

Slices 0 and 1 are done and live. Slices 2 and 3 are mostly done and live. Slice 4 is built and verified on the
local test copy, not released. Slices 5 and 6 are not started here; slice 7 is built and merged (see its section below). Slice 8 is designed and steps 1 to 4 are built (rules, render providers, the prompt
change, "Queue re-render" in the viewer up to Approve): see its status note in `PLAN.md`. Slice 6 (Prep intake) was
started on 2026-11-24 in a thread of its own, in its own worktree.

## Rules that are not written anywhere else

- **Releases need the operator's explicit word each time** ("release it"). "Keep going" is not that word; a release
  attempted on it was blocked. Build, verify, commit on the branch, and say what is unreleased.
- **How a release goes** when asked: fast-forward `main` to the branch tip, push (the Vercel gateway deploys itself),
  then `scripts/release-studio.sh <commit>` for the app on the App VM, check it in a signed-in browser, then record it
  in `proxmox-home/docs/creative-studio-pro-hosting.md` (pull that repo first; its AGENTS.md allows pushing to its `main`).
- **Review Room merges are production deploys** (app and database functions) and its repo has its own rules. Build on a
  branch in a separate worktree there; never push without the operator's word.
- **The operator's wishes, in their words:** "finish 3 and start 4 dont ask to continue", "just go through them all",
  "you can work in parallel if it makes sense", and "each slice should open a new thread" with a handoff. So: do not
  end a turn on "shall I continue?"; when a slice is finished, write its status into `PLAN.md`, update this file, and
  open the next slice in a new thread.
- **Never against real data without being asked:** on Hosted Studio only look. Do not press anything that changes a
  project, sends to Review Room, or spends credits (Confirm in "Make a take", Push to cut, the review keys).
- **The local copy is a test copy, but it is connected to the real Review Room.** A pick or a review made locally
  changes Review Room. Put anything you change back.
- A command whose text contains the words of a `trail` command (for example a sentence with "skills" next to "on")
  is blocked by a hook; reword the sentence.

## How to verify (every part, before it is called done)

- `bun run check` (0 errors; 2 old warnings), `bun test`, `bun run check:env`, `bun run build`, then `graft build`.
- Two tests fail on this Mac for reasons outside the code and are not yours to fix: "the text card is a 1080p video…"
  (the local ffmpeg has no `drawtext`) and "this repo is in step with the vault". Any third failure is yours.
- In the browser: start `csp-dev` from `.claude/launch.json` (port 5174) and walk the change through at 1440px and at
  phone width. Project "Blood Rush — Teaser Trailer" (`?project=01a0f10b-cee6-7765-bdb9-d1de0d611a5d`) has 82 shots,
  takes and seven cuts; "Blood Rush · The Late Shift" (`01a14bbe-8e15-7ae0-ba2d-2c1ee13a198b`) has Ghost-written prompts
  and shot specs.
- New rules go in pure functions under `src/lib/domain` or `src/lib/media`, written test-first. Source-level rule
  tests live in `tests/ui/`; `tests/ui/look-rules.test.ts` checks every component in `src/lib/ui/shots` and
  `src/lib/ui/shell` for the look's mechanical rules, so a new component there is covered automatically.

## The map of what was built (so you do not rediscover it)

- Shell: `src/routes/+page.svelte` (top bar, stages, outline, dock, the Review Room check), `src/lib/domain/stages.ts`,
  `next-line.ts`, `src/lib/ui/shell/Outline.svelte`, `ProjectMenu.svelte`.
- Shots grid: `src/lib/ui/ProductionWorkspace.svelte` (grid, bands, Details portal into the dock, viewer),
  `src/lib/ui/shots/ShotCard.svelte`, `TakesBand.svelte`, `SelectionStrip.svelte`, `Viewer.svelte`,
  `PromptSections.svelte`, `MakeTake.svelte`, `ShotBrief.svelte` (Details on the canvas).
- Canvas: `src/lib/ui/nodes/StoryCardNode.svelte` draws `ShotCard` with a floating action bar.
- Rules: `src/lib/domain/shot-card.ts`, `selection.ts`, `drops.ts`, `viewer-keys.ts`, `prompt-sections.ts`,
  `make-take.ts`, `merge-production.ts`, `review-poll.ts`, `review-notes.ts`, `review-room-links.ts`;
  `src/lib/media/strips.ts`, `stills.ts`, `timeline-open.ts`, `waveform.ts`.
- Review Room: `src/lib/ui/review-room-state.svelte.ts` (shared state and the outbox), the route
  `src/routes/api/projects/[projectId]/review-room/+server.ts` (actions `pull`, `review`, `current`, `notes`,
  `link_back`), `src/lib/server/review-room.ts` (client), `review-room-takes.ts` (`pullTakes`).

## Slice by slice: what is left

### Slices 1 and 2: leftovers (small; fold into another thread or take last)

- A shot whose pick is a still cannot join a selection. This is a stated rule (`playItemFor` in
  `src/lib/domain/slate.ts`, tested as "benched shots and still picks are skipped"), so changing it is the
  operator's call; they have not asked.
- Canvas: references as canvas cards linked to the shots that use them (PLAN slice 2 step 5); Space or a double-click
  does not open the viewer from the canvas; the canvas's side panel and its Seed, Voice and Scene cards still have
  the old look; the old Animate window (with its session cap) still opens from the card's bar beside the new
  two-step block.
- Pricing a take fails on Hosted Studio: the server image has no Higgsfield CLI. Outside the plan; see slice 8.

### Slice 3 · Review Room: what is left

1. **Release `d81b3cc`** when the operator says so, then on Hosted Studio check: take chips on a card with two takes
   (hover only; do not click), and that TR130 gained `review_room.link` after the first check (the link back writes
   one address per locked folder, about 70 requests, once).
2. **Done in Review Room's own thread (2026-11-24):** an open owner workspace there now follows changes made
   elsewhere without a reload. It is on that repo's `main` and deployed, by that thread's report; this file's author
   has confirmed only that `src/lib/live-refresh.ts` is on `origin/main` there, not the behaviour.
3. **Unwatched:** a link from this app landing on its version after Review Room's sign-in (the browser was never
   signed in to Review Room). **No real note has been seen** come through the viewer; none of the shots tried had one.
4. Episodes of a series get no Review Room link and no link back: their Review Room project id is in the series
   record, not on the project (`shotRoomLink` and `folderLinks` in `src/lib/domain/review-room-links.ts` read
   `project.review_room` only).

### Slice 4 · Front door and story plan: built, not released

Five parts, each with a dated status note in `PLAN.md` (what was built, what was checked, what was not). In short:

- Rules: `src/lib/domain/story-levels.ts` (levels, approvals, name locking), `story-propose.ts` (what the Agent may
  put into a plan), `front-door.ts` (what a start means). Approvals live in `production.story_levels`; the lock is
  in the gateway (`approveStoryLevel`, and `saveProduction` refuses a changed code).
- Screens: `src/lib/ui/StoryPlan.svelte` (one level at a time), `src/lib/ui/story/` (`FrontDoor`, `BriefSheet`,
  `Pitch`, `AgentActions`, `agent-work.svelte.ts`), levels and Unplaced in `shell/Outline.svelte`, Notion in
  `settings/NotionSettings.svelte`. Gone: `NewProjectFlow`, `BriefPanel`, `TrailerHousePanel`.
- Server: plan actions `approve_level`, `propose`, `begin`; trailer-house action `pick`;
  `src/lib/server/story-propose.ts`; `/api/settings/notion`; `getNotionToken()` is now async.

What is left:

1. **Release it** when the operator says so. Before or at release: no real model call has been made through any
   of this (drafting the brief, pitching, the teaser, proposing each level, the interview without a lock); try one
   project end to end with the real model first. Also never tried: a real file, folder or song dropped on the
   front door, starting from a Notion link, entering a real Notion key, and approving the shot list of a trailer
   connected to Review Room (tests cover each with stand-ins).
2. **Step 6, the operator's:** publish the series template as a public Notion page and paste its address into
   Settings → Notion. The front door says "not published yet" until then.
3. **Outside this repo, at release:** the Notion key can now live in the app settings file on the App VM, with
   `NOTION_TOKEN` as fallback. Record that in `proxmox-home` and the vault note's env table (not done; both are
   outside this checkout).
4. Not built: the front door has no Agent of its own before a project exists (the dock belongs to the open
   project); a code freed by removing a scene is not remembered; episodes imported from a series keep their own
   codes and show no levels; the Settings page still carries the old look (the Agent's dock was restyled on 2026-11-24: purple wash, no pink, no boxes; DECISIONS.md has the rules, and the mocks in `mockups/` still show the earlier pink version); the teaser's video
   model and aspect are fixed, and the Trailer House panel's character image and live prompt highlighting were
   not carried over.
5. Checking tip: buttons that call the model run at once, and the local copy has a model configured. The checks
   here installed a stand-in for `fetch` in the page first; a reload or a code change removes it.

### Slice 5 · Voice: not started (needs slice 4's front door)

Steps in `PLAN.md`; ADR 0009 (voice is a layer over the Agent: speech becomes ordinary chat text). The mock uses
"hold V to talk" because Space plays. The Agent's chat is `src/lib/ui/chat/AgentChat.svelte`; when docked it waits for
"Start the interview" instead of calling the model on every project change. A key for the voice provider is a new
setting: document it in `.env.example`, the vault note and proxmox-home before the slice is called done.

### Slice 6 · Prep intake: not started (independent of 4 and 5)

Steps in `PLAN.md`. `src/lib/ui/PrepWorkspace.svelte` is the screen; the mock is `mockups/Prep.html` (every thumbnail
the same 16:9 size; a "Found in the story" row). The drop rules already know a picture on a reference is a source
image (`dropMeaning` in `src/lib/domain/drops.ts`, kind `source-image`); nothing calls that branch yet.

### Slice 7 · Cut: built and merged into `ux-streamline`, not released

Mocked (`mockups/Cut.html`, agreed 2026-11-24), built on `claude/laughing-haibt-7a8ce2` and merged into `ux-streamline`
the same day at the operator's word: see slice 7's status note in `PLAN.md`. Left: one real lock, mix, export and QC
through the new screens on a project the operator names; Details on a phone.

### Slice 8 · Re-render queue: steps 1 to 4 and 9 built; nothing can be priced or sent yet

Designed with the operator on 2026-11-24 in three rounds of questions. Read, in this order: decisions 27 to 40 and the facts under them in `DECISIONS.md`; slice 8 in `PLAN.md` (ten ordered steps and a "Done when"); stories 56 to 70 and the implementation decisions in `SPEC.md`; "Rendering" in the root `CONTEXT.md`; `docs/adr/0011`.

The design in one paragraph: a take marked Needs changes offers "Queue re-render" with one box for what to change. The re-render reuses that take's still, references and settings; the Agent rewrites only the prompt, with the skill that wrote it, and the operator sees the change highlighted and approves it. Everything approved is priced together and sent on one Confirm. Each render is a run on the operator's Trigger.dev, so it finishes with the browser closed; this app does the provider's work. A finished re-render is another take, here and in Review Room, awaiting review, never the pick. The Queue view (third view of Shots) is a sortable table, one line per render, saying where and how each was made.

Steps 1 to 4 and step 9 (draft and Finalize are out of the app) are built (status note in `PLAN.md`, with what was decided on the way, what was walked in the browser and what was not, and what about fal.ai is untried). To try the block in the browser without touching Review Room, make a throwaway local project with a video take whose `review_status` is `needs_changes` and no `review_room`, and delete its folder afterwards. What needs the operator:

- **Step 6**: creating the Trigger.dev project and its production key (the dashboard asks only for a name; they are signed in at `trigger.v1su4.dev`). Do not create it for them without their word.
- **The fal.ai key**: they add `FAL_KEY` to the environment file themselves, later. Until then fal.ai is listed as not set up.
- **One real Confirm** at the end, to prove a render end to end. It spends credits: ask first.
- **Step 10** (Higgsfield on Hosted Studio): on their urgent list, deliberately not part of this slice's "Done when".
- **A mock of the Queue view** agreed before step 5 is built.

Things that will trip you:

- "Make a take" refuses a shot whose pick is a video, and a video take does not record the still it started from. Re-render cannot be built on `stillOf` in `src/lib/server/animate.ts` as it stands; the render record must carry the still and references (step 1), and older takes fall back to their Higgsfield job id.
- `applySettleGeneration` in `src/lib/domain/animate.ts` makes a finished take the pick. A re-render must not (decision 34); `pushTake` already stores a take that is not the pick without making it current in Review Room.
- The app no longer sends `draft` or offers Finalize (step 9, done). No render has been sent since, so the first real send is also the first proof that the CLI takes a Seedance 2.5 request without the flag.
- The Higgsfield CLI has no seed setting. Nothing can promise that a second render matches the first.
- Trigger.dev tasks share no files with the app and are built and deployed only on the App VM (`scripts/deploy-trigger-vm100.sh` in `review-room-svelte`). Keep the SDK, the build package and the CLI on the platform's version (4.8.8 on 2026-11-22); the runbook lists what broke before.
- Pindeck and Stack Structure show live runs with React hooks; this app is Svelte, so the way to subscribe has to be read from Trigger.dev's documentation.
- Costs come in two units, credits and dollars. Never add them.
- `tests/ui/look-rules.test.ts` covers `src/lib/ui/shots` and `src/lib/ui/shell` automatically; put the Queue view's components there.

The ADR number: `0011` was free on `ux-streamline` and on `main` when this was written; if another slice has taken it by the time this merges, renumber this one and its mentions.

## Threads

One thread per slice. When a slice is done: status into `PLAN.md`, update "Where things stand" here, then open the
next. Slices 6, 7 and 8's design do not depend on slice 4 and can run beside it, each in its own worktree; whoever
merges second resolves `src/routes/+page.svelte` and `ProductionWorkspace.svelte`, which most slices touch.
