# 01 · Shots grid: make it the mock, on TR130, with the names

First issue under the way of working decided on 2026-11-24 (`../HANDOFF.md`, "Start here"): look and behaviour
built together, one screen at a time, finished before the next.

- **Project:** TR130 — Teaser Trailer (`?project=01a2067a-6cdc-7d1f-b28c-19429297cb80`). Look only: it is connected
  to the real Review Room, so no picks, reviews or pushes.
- **Mock:** `../mockups/Main.html` (canvas https://claude.ai/artifact/GcSURykGvjJGXujETaqa1m). Pictures:
  `01-shots-now.jpg` (the app on 2026-11-24) and `01-shots-mock.jpg` (the mock, styled, no images).
- **Blocked by:** nothing. The selection colour (question 2 in the handoff) can be settled inside this issue.

## Names (decided 2026-11-24)

A shot is its code plus one line, nothing else (`CONTEXT.md`, "Shot code" and "Shot line").

- The code comes first and is the name: `DRP_0010` on a card, `BLR_TR130_DRP_0010` where there is room.
- Under it, the shot line: the card's `title` ("The knock").
- Never shown: `beat` (a copy of the title on 56 of TR130's 57 cards) and `purpose` (copy history, "TR130 shot
  from the TR110 v004 rebuild (was …)").
- A scene is `DRP · The sealed drop and the hood` everywhere.
- **This changes the mock's card**, which puts the line first and the number small on the right.
- **Card chosen 2026-11-24: option A, "code on top"** (`01-card-options.jpg`, top row). Three lines under the still:
  the code in Geist Mono (`DRP_0010`, ink, 12px), the shot line in Geist (ink2, one line, cut with an ellipsis), then
  status · takes · version in small tracked capitals with the status in its colour and the version on the right.
  The still keeps the take marks bottom left and the length bottom right, as in the mock.

## What differs from the mock today

| Area | Mock | App now |
| --- | --- | --- |
| Work area | One scene at a time: `010 VHS Video Haven` heading, "9 shots · 40s of 45s", that scene's shots | All 57 shots in one flat grid, no scene heading |
| Toolbar | Grid / Canvas, status filters (Awaiting, Changes, No take), Add shot, Play scene | Old toolbar: drop-files sentence, Add files…, Add folder…, From Higgsfield…, Add score…, Tag shots, First cut to score, Save workspace, in bordered square buttons |
| Cards | Line, number right, then status · takes · version | Line big, code small and grey on the right (to become code first, line beneath, see above) |
| Outline | Story plan → acts → scenes (order, code, title, count) → the open scene's shots with status-coloured numbers | Five story levels on top (Brief, Acts, Scenes, Story beats, Shot list "57 proposed"), "Names lock as each level is…", then scenes, an "Open in Review Room" row, shots all one colour |
| Top bar | Studio · project · four stages centred · Review Room in step · search | Adds a "Local test copy · nothing here syncs there" banner, which is wrong for TR130 (it is connected to Review Room); Grid/Canvas and Agent/Menu sit up here instead of in the work area |
| Bottom band | Takes of the open shot · Selection timeline · Play · Push to cut | Same parts; check spacing, no borders |
| Dock | Agent chat, Details | Agent shows "Start the interview" (decided 2026-11-24: chat only, purple wash) |
| Lines and corners | No borders, rounded | Several bordered square controls |

## Done when

- The screen looks like the mock at 1440 px and at phone width, with TR130's pictures, except for the agreed card
  swap. A screenshot beside the mock is shown to the operator, and they say yes.
- Every shot is named by its code with its line beneath, on the card, in the outline, the takes band, the selection
  strip and Details. No `beat`, no `purpose`, no file name standing in as a name.
- Nothing from the old toolbar is left in view. Whatever of it is still needed (adding files, Higgsfield, the score)
  has a place the operator agreed to, or is listed here as moved, not lost.
- `bun run check`, `bun test` (the two known Mac failures aside), `bun run check:env`, `bun run build`, `graft build`.

## From the first full-screen audition (2026-11-24)

The audition page is a throwaway HTML screen built from scene DRP's 15 stills, with switches for greys, depth,
selection, main button, card text and outline (kept in the session scratchpad, `cards/build_shots.py`).

- **One surface, not three panels.** The scene list, grid and Agent sat in three rounded boxes with black gaps; the
  operator said no other app they like looks like that. Now one surface with 8px dividers and a small grip, as in
  Review Room's `WorkspacePanes.svelte`, and **the edges drag** to resize the side panes (Frame.io does the same).
- The phone version first shown was bad; a fixed one followed but has not been judged.
- The top bar (Studio · Blood Rush / TR130 · stages · Review Room in step) and the work bar (Grid, Canvas, Add shot,
  Play scene) feel scattered; not settled. The small buttons are still in doubt.
- **Tidier bars, offered as switches (not chosen yet).** Top bar: *spread* (as the mock), *left* (stages beside
  the project name, Review Room on the right) or *minimal* (just the trailer's name, the stages, and a teal dot for
  Review Room, its words on hover). Scene bar: *words* (Grid, Canvas, Add shot, Play scene) or *icons* (a grid /
  canvas pair, a +, and one teal Play). The page opens on *left* + *icons*.

- **Where videos live (operator, 2026-11-24):** takes are uploaded to Review Room as they are generated, and Review
  Room's storage (RustFS on the server) is where every video lives; this app should reference them from there, the
  same files the trailer feed uses. The audition plays the local copies only because they are the same files.
- **Card, round two:** the version sat at the far right of the status line and was cut off. It moves next to the
  code (`DRP_0040  v001`) and shows the version of the take in use (the pick), not the newest.
- **Takes band:** the thumbnails were too small, looked cut off, and nothing said which take is in use. They grow,
  and the pick is labelled.
- **Selection strip:** it was not clear what the four clips were. It starts empty with one line saying what it is for.

- **Bottom band, round three (the operator called the old one a mess):** takes appear in one place only, the band
  under the viewer, never repeated inside the viewer. No outlines: the take being watched is at full strength and
  the others dim; the pick carries a small teal "Pick" label. "Use v004 as pick" sits in one fixed spot, at the right
  of the Takes title, and only when the take being watched is not the pick. Takes and Selection are two equal
  halves whose titles share one line and whose 72px contents share one top edge. The selection strip is as tall as
  the takes, clips never narrower than 96px (it scrolls instead), Play and Push to cut sit beside its title,
  clicking a clip plays from that clip, and removing is a × that appears on hover. The playhead redraws every frame.
- **The audition now holds all of TR130** (11 scenes, 56 shots, 119 takes from the local copy; `MRN_0020` has nine
  takes, `PCK_0010` ten). Takes not yet stored in Review Room show "new" for their version (handoff question 4).

- **Round four (same evening):** the Agent took too much room and looked cut off from the rest. It is now a 40px
  strip on the right edge with one button that glows softly when the Agent has something to say; clicking opens a
  see-through panel floating over the grid that never covers the band. The pick is chosen on the take itself ("Make
  pick" on hover, or P), not with a button that comes and goes. The right half of the band is no longer a
  hand-made selection: it is **the open scene in order** (MRN: 0010, 0020, 0030, 0040), Play scene plays it
  straight through, clicking a shot plays from there, and shift-clicking shots narrows Play to those ("Play 2",
  "Play all"). The operator read the old selection as the scene's sequence, which is the better model.
- **Details lives in the viewer (operator, 2026-11-24),** not beside the Agent. A 260px column to the right of the
  video, its first line flush with the video's top: Shot (full code), Scene (code · title), Length, Take (version,
  Pick, review status, "not in Review Room yet" when unstored), Size, File (the original file name, small and
  grey), Prompt ("No prompt yet" on every TR130 shot today). "Details" in the viewer's header or I hides and shows
  it; the choice is remembered. The Agent panel is the Agent only.

- **Round five:** the Agent's message box is the bottom of its panel, not a box of its own, with a plain send arrow;
  the operator's messages are plain text under "You", never in a bubble. One Play on screen: a play/pause symbol
  under the video and "Play scene" by the scene strip; none in the scene bar. The scene strip always fits its
  width (never cut off at the ends). In strip mode the right edge holds four centred buttons: search, Agent (glows),
  Review Room, settings. The operator tried docked, neutral greys, depth off and grey main buttons on the switches;
  nothing is settled about those yet.
- **Next after this issue (operator, 2026-11-24):** Story and Prep, "the most important" parts, starting from how
  an idea in Notion becomes scenes and shots, where names are made, and how that reaches Review Room.

## Open inside this issue

1. **Where the old toolbar's actions go, agreed 2026-11-24:** Add files…, Add folder… and From Higgsfield… become
   one "Add shot" menu (Empty shot, Files…, Folder…, From Higgsfield…), and dropping on the grid keeps working. Add
   score…, First cut to score and Tag shots move to Cut (Sound). Save workspace goes: the screen saves itself.
   **Look notes from the same talk:** the operator now leans to the greys with no colour in them at all (neutral or
   graphite, to settle in context); is not sold on the small buttons, possibly the teal one; and hates a busy screen
   with writing everywhere. Before the build, show the whole Shots screen at once with TR130's pictures and live
   switches for greys, depth, selection and button style, and keep words on screen to a minimum.
2. **The 57th card,** the whole trailer as one video ("TR130 TRL01 v001 (2-35) exact mix"): which scene it shows
   under and what its name is (handoff question 4).
3. **Greys, chosen 2026-11-24: "graphite with depth"** (`01-greys.jpg`, fourth column, lower sample). Zinc is
   dropped as too flat and slightly cold; slate is out. Graphite is neutral with the slightest warmth, as OKLCH at
   Tailwind neutral's lightness steps, hue 70, chroma tapering to the ends:
   `50 .985/.0029 · 100 .97/.0030 · 200 .922/.0034 · 300 .87/.0037 · 400 .708/.0049 · 500 .556/.0060 ·
   600 .439/.0052 · 700 .371/.0047 · 800 .269/.0040 · 900 .205/.0036 · 950 .145/.0031` (L/C, hue 70).
   "With depth": the work area a soft radial from 900 to 950, panels a gentle top-down gradient with a 1px inner top
   highlight (`#ffffff10`), cards and buttons the same at `#ffffff14`–`1a` with a small soft shadow under cards. No
   borders. Every grey in the app's tokens moves to this scale; the selection fill becomes its graphite equivalent.
   Still open to the in-context audition, like the selection colour.
5. **Selection colour, chosen 2026-11-24 for now: option 2** (`01-selection-options.jpg`): a neutral grey fill
   (`#1c1c21`) and the selected shot's code in teal; teal stays for the pick, approved and the main button. The
   operator wants to **audition colours in context later**, on the finished screen beside everything else, so the
   fill must stay one token (`--color-selected`) and the build must leave a quick way to try other values live
   (for example a small dev-only picker, or a `?sel=` setting read on the local copy) without a code change.
