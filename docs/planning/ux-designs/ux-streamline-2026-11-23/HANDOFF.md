# Handoff: streamlined Creative Studio Pro

Written 2026-11-24 so each remaining slice can be carried on in its own thread. Read this first, then the slice's
section in `PLAN.md` (same folder), which holds the dated status notes for everything already built.

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
| Branch tip | `d81b3cc` plus the handoff commits |
| `main` on GitHub | `337de5e` |
| Hosted Studio (studio.v1su4.com) | gateway and app both at `337de5e`; rollback image `rollback-a1482a7` |
| Not released | everything after `337de5e`: `d81b3cc` (take chips on the card, picks that are kept and resent, the link back) |
| Review Room (`review-room-svelte`) | `main` at `c880092`, deployed; local branch `live-current-version` at `43be65a` is unfinished work, not pushed |

Slices 0 and 1 are done and live. Slices 2 and 3 are mostly done and live. Slices 4 to 7 are not started, apart from
a parked draft test for slice 4. Slice 8 is designed (2026-11-24) and not built.

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
- "Unplaced" in the outline waits for scene codes on groups, which slice 4 brings.
- Pricing a take fails on Hosted Studio: the server image has no Higgsfield CLI. Outside the plan; see slice 8.

### Slice 3 · Review Room: what is left

1. **Release `d81b3cc`** when the operator says so, then on Hosted Studio check: take chips on a card with two takes
   (hover only; do not click), and that TR130 gained `review_room.link` after the first check (the link back writes
   one address per locked folder, about 70 requests, once).
2. **Review Room's own screen does not notice changes made elsewhere until reloaded.** This is the last piece of the
   operator's requirement "the current take choice must update live between the two". Unfinished work is on local
   branch `live-current-version` in `review-room-svelte` at `43be65a`: a pure merge rule (`src/lib/live-refresh.ts`
   with tests), a feed helper (`convex/lib/seriesAssets.ts`, `convex/personal.ts`) and a Convex test; it is **not
   wired into the page** and not verified. The branch has no worktree; make one from it. What it has to do:
   - While the owner workspace is open and visible, pick up changes made elsewhere within about ten seconds and at
     once on focus, without a reload and without losing what is open: the current version (and so what "current"
     shows), review status, a version's exclusion, new versions.
   - If the owner is deliberately viewing a non-current version, keep them on it but update which one is marked current.
   - Find out whether choosing a version in Review Room's own picker makes it current on the server (and bumps the
     asset's `updatedAt` so the changes feed carries it); if making a take current is not one obvious action, add it.
   - Rules there: work in a worktree on the branch, never touch sign-in files (`origin/feat/keep-signed-in` is in
     progress), schema changes optional only, `bun run check`, `bun test`, `bun run build`. No Linear ticket exists
     for any of this work; that repo's rules ask for one.
3. **Unwatched:** a link from this app landing on its version after Review Room's sign-in (the browser was never
   signed in to Review Room). **No real note has been seen** come through the viewer; none of the shots tried had one.
4. Episodes of a series get no Review Room link and no link back: their Review Room project id is in the series
   record, not on the project (`shotRoomLink` and `folderLinks` in `src/lib/domain/review-room-links.ts` read
   `project.review_room` only).

### Slice 4 · Front door and story plan: started, nothing built

Steps and "Done when" are in `PLAN.md`. What exists:

- A parked draft test, `slice4-story-levels.test.ts.draft` in this folder (move it to
  `tests/domain/story-levels.test.ts` to use it). It describes a module that does not exist yet,
  `src/lib/domain/story-levels.ts`, with this intended shape:
  - `STORY_LEVELS = ['brief', 'acts', 'scenes', 'beats', 'shots']`; `levelStates(counts, approvals)` gives each level
    `empty`, `proposed` or `approved` (an approval of something no longer there does not count); `nextLevel`;
    `canApprove(level, states)` (in order, and only when the level holds something); `lockNotice(level)` (the sentence
    shown before approving, story 16).
  - Name locking (decision 22): `sceneCodeFor(title, taken)` and `assignSceneCodes(scenes)` (three capitals, unique,
    never touching a code already given); `assignShotNumbers(shots)` (tens within a scene, keeping numbers already
    given, a shot added between two takes a number between them); `lockViolations(approvals, before, after)` (a code
    whose level is approved cannot change or be handed to another scene; new things can always be added; a title can
    always change).
  - The tests are a first draft written in one pass and never run against code: treat the expected values (for
    example the exact scene codes) as a proposal, not a contract.
- Where the story plan lives today: `src/lib/domain/story-plan.ts` (`sections` are acts, each with `scenes` that may
  carry a `scene_code`, and `moments`, which are story beats with an `approved` flag and planned `shots`),
  `src/lib/ui/StoryPlan.svelte`, the gateway's `setShotCodes` (`src/lib/application/gateway.ts` near line 449),
  shot numbers on cards (`shot_number`, "never changes once set"), Review Room codes in `project.review_room`.
- Not decided: where level approvals are stored (a new optional `story_levels` on the production was the idea), and
  where the lock is enforced (the gateway, on every save that could change a code).
- To be replaced by the front door: `src/lib/ui/NewProjectFlow.svelte`, `TrailerHousePanel.svelte`, `BriefPanel.svelte`.
  The front door, pitch and story mocks are `mockups/Start.html`, `Pitch.html`, `Story.html`.
- Step 6 is the operator's: publish the Notion series template as a public page and give its address.

### Slice 5 · Voice: not started (needs slice 4's front door)

Steps in `PLAN.md`; ADR 0009 (voice is a layer over the Agent: speech becomes ordinary chat text). The mock uses
"hold V to talk" because Space plays. The Agent's chat is `src/lib/ui/chat/AgentChat.svelte`; when docked it waits for
"Start the interview" instead of calling the model on every project change. A key for the voice provider is a new
setting: document it in `.env.example`, the vault note and proxmox-home before the slice is called done.

### Slice 6 · Prep intake: not started (independent of 4 and 5)

Steps in `PLAN.md`. `src/lib/ui/PrepWorkspace.svelte` is the screen; the mock is `mockups/Prep.html` (every thumbnail
the same 16:9 size; a "Found in the story" row). The drop rules already know a picture on a reference is a source
image (`dropMeaning` in `src/lib/domain/drops.ts`, kind `source-image`); nothing calls that branch yet.

### Slice 7 · Cut: not started (independent of 4, 5 and 6)

Steps in `PLAN.md`. Cut is not mocked. The Cut stage's views exist in the shell (Picture, Sound, Export in
`src/lib/domain/stages.ts`) and show the old screens: the cuts list and `SequencePlayer.svelte` (which now opens from
what a cut already knows and reads files while playing), `SoundStage.svelte`, `ExportStage.svelte`. The spec says
this pass only moves Cut into the shell and the look; how cuts, mixing, export and QC work does not change.

### Slice 8 · Re-render queue: designed, nothing built

Designed with the operator on 2026-11-24 in three rounds of questions. Read, in this order: decisions 27 to 40 and the facts under them in `DECISIONS.md`; slice 8 in `PLAN.md` (ten ordered steps and a "Done when"); stories 56 to 70 and the implementation decisions in `SPEC.md`; "Rendering" in the root `CONTEXT.md`; `docs/adr/0011`.

The design in one paragraph: a take marked Needs changes offers "Queue re-render" with one box for what to change. The re-render reuses that take's still, references and settings; the Agent rewrites only the prompt, with the skill that wrote it, and the operator sees the change highlighted and approves it. Everything approved is priced together and sent on one Confirm. Each render is a run on the operator's Trigger.dev, so it finishes with the browser closed; this app does the provider's work. A finished re-render is another take, here and in Review Room, awaiting review, never the pick. The Queue view (third view of Shots) is a sortable table, one line per render, saying where and how each was made.

Start with step 1 (the render record and its rules, test-first); it needs nothing from anyone. Steps 2 to 5 can follow without the operator. What needs the operator:

- **Step 6**: creating the Trigger.dev project and its production key (the dashboard asks only for a name; they are signed in at `trigger.v1su4.dev`). Do not create it for them without their word.
- **The fal.ai key**: they add `FAL_KEY` to the environment file themselves, later. Until then fal.ai is listed as not set up.
- **One real Confirm** at the end, to prove a render end to end. It spends credits: ask first.
- **Step 10** (Higgsfield on Hosted Studio): on their urgent list, deliberately not part of this slice's "Done when".
- **A mock of the Queue view** agreed before step 5 is built.

Things that will trip you:

- "Make a take" refuses a shot whose pick is a video, and a video take does not record the still it started from. Re-render cannot be built on `stillOf` in `src/lib/server/animate.ts` as it stands; the render record must carry the still and references (step 1), and older takes fall back to their Higgsfield job id.
- `applySettleGeneration` in `src/lib/domain/animate.ts` makes a finished take the pick. A re-render must not (decision 34); `pushTake` already stores a take that is not the pick without making it current in Review Room.
- The app still sends `draft` for every 480p render and offers Finalize. Both go (decision 33, step 9); the CLI still accepts `draft`, so nothing will fail to remind you.
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
