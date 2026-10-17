# Series production v3: decisions and hand-off (2026-10-17)

Read this first when picking up Blood Rush EP101 or any ticket below. It records the second grilling session
(Q1–Q28, 2026-10-17 afternoon), which corrected the first build. Words follow `CONTEXT.md`; the code/Notion
ownership rule is ADR 0002 (`docs/adr/0002-app-writes-codes-into-notion.md`); media lives in Review Room (ADR 0001).

## What went wrong in the first attempt

- Blood Rush was rebuilt in Notion as **Blood Rush v2**, but scenes were titled `P01 — …` (the old convention)
  because `.agents/skills/story-interview/SKILL.md` still says so. Codes are `010 PAR — Name` / `BLR_EP101_PAR_0020_v003`.
- Fit wrote shots without the linked story beats, with no dialogue, and guessed reference images (none existed).
- Notion was hard to navigate (a "Databases (raw)" page, dead ends, loose pages).
- The test import (project `01a14b46-a81a-713d-bcc9-6ff0ff2ce2e7`, P01 shots only, nothing sent) is to be deleted.

## The flow

1. **Story pass** (any chat with Notion: Kimi desktop's Notion plugin, Claude, or the app's Agent panel) runs the
   story-interview skill v3 → fills Notion: season story beats (Save the Cat), episode outlines for every episode,
   and scenes with **Action** and **Dialogue** only for the episode being made (EP101 now, 10 minutes).
2. **The app** pulls the series (Series page → Sync): every episode, EP101's scenes; assigns and later locks codes;
   writes the codes back into Notion; creates the Review Room folders.
3. **Fit to length** (the Agent, Kimi by default) writes EP101's shots from Action, Dialogue, story beats and References,
   checks itself, and the shots sync into Notion (plain fields; prompts stay in the app).
4. The operator approves the shots. Only then: grid stills → 480p drafts → pre-edit → 1080p, each through the send gate.

## Decisions

| # | Decision |
|---|---|
| Q1, ADR 0002 | The app owns codes and writes them into Notion columns (Show, Episode code, Scene code, Shot code, Locked). Typing over them in Notion is undone on sync. The app's Notion connection has Read + Update + Insert content, nothing else, and sees only the Creative Studio Pro page (write tested 2026-10-17). Notion's "agent access" stays off. |
| Q2 | Notion titles are names only. Order in `Scene #` (10, 20…), code in its own column. The app shows `010 QUD — Morning Quad`. |
| Q3, Q9, Q10, Q28 | **References**: one Notion database (Name = exact string printed on the image, Kind = Character / Location / Prop, Role line, Handles, File name, Name on sheet ✓). Files in the series' Review Room project under `_References/…`. Source files are in **super-seed2**; the operator vets them before anything is copied. A location's reference also carries look and grade (no separate Look kind). |
| Q4 | The scene field "Story Beats" is renamed **Action**. "Story beat" means only the season's 10–15 events. |
| Q5, Q14 | Fit reads linked story beats, Action, Dialogue and References, then checks its own shots against a checklist (a second model later). |
| Q6, Q18 | Old Notion page → `Archive / Blood Rush (old version)`. `Blood Rush v2` → renamed `Blood Rush`, overwritten in place (story kept). Delete the test import. |
| Q7 | The story pass runs in any chat with Notion; the app's Agent panel gets Notion write tools so it works from the web or phone (folded into V1S-324). |
| Q8 | **Dialogue** is a field on each scene: `SPEAKER (delivery): "line"`, written with script craft. Each line goes in exactly one shot, verbatim; the linter checks. |
| Q11 | "Previous shot": attach the last frame of the previous shot's pick as a reference, per shot, never automatic. |
| Q12 | "Scene", never "sequence". |
| Q13 | Codes appear in Notion as soon as they're assigned, with a Locked checkbox. |
| Q15 | App ↔ Notion sync is deterministic code, no LLM. |
| Q16 | Whole season: story beats and episode outlines. EP101 only: scenes, Action, Dialogue. |
| Q17 | The media bank is the right-hand drawer: thumbnails by kind (character headshots cropped from sheets), drag onto a shot, chips on the shot. |
| Q20 | Notion layout: `Creative Studio Pro / Blood Rush` hub (Story, Season arc board, Episodes → episode → scenes → shots, References gallery), `Archive` beside it. Raw tables in one collapsed toggle. No dead ends. |
| Q21 | Each episode page starts with its **Episode outline** (story points in order, section-tagged, flashbacks marked). |
| Q22 | No fixed slot numbers. Per shot: characters → location → props. Image N is declared once per shot and always means the same reference. |
| Q23, Q26 | The exact name on the sheet is canonical. Writers type `@Kai`; a deterministic step swaps it for `@Image_1 (Kai "Hoodie" Santana)`, adds `@Image_1 = Kai "Hoodie" Santana — definitive identity and wardrobe lock` at the top, and attaches the sheet. Only `@Handles` are swapped. |
| Q24 | Env rule: a value lives only in BWS (`hermes_keys`) and `.env.local`/`.env`; proxmox-home documents where and how; the Hermes vault note has the short version and the env-name → BWS-name table. A name-only `check:env` runs as a pre-commit hook and a Claude Code Stop hook. |
| Q25 | This repo commits to `main` per finished chunk. Repos that use PRs open one only when the whole chunk is done. |
| Q27 | Name on sheet ✓ is checked by the send gate; a small script stamps a missing name along the bottom of the image. A vision check comes later. |

## Tickets, in order (project "Creative Studio Pro — series production")

1. **V1S-323** Notion v3: archive, hub layout, v3 template.
2. **V1S-324** Story-interview skill v3 + the Agent panel writes it into Notion.
3. **V1S-325** App ↔ Notion sync: codes and shots written back, v3 fields read.
4. **V1S-326** References: `_References`, media bank drawer, name-on-sheet check (waits on the operator's vetting).
5. **V1S-327** Handles: `@Kai` → exact name, image number, sheet.
6. **V1S-328** Previous shot's last frame as a reference.
7. **V1S-329** Fit reads the whole scene and checks itself.
8. **Env check hook** (no Linear ticket: the free issue limit was hit; tracked here). `bun run check:env`, pre-commit + Stop hook, AGENTS.md note.
9. **V1S-283** The EP101 proof run, after the above.

## Open questions for Higgsfield's agent (operator to ask)

1. "For Seedance 2.5 image-to-video with multiple reference images (two characters, one location, one prop), what order should the reference images be in, and how should the prompt refer to each one?"
2. "Which skills or workflows do you use to keep a character consistent across many shots in one scene, and can you show me the exact prompt structure they produce?"
3. "When the last frame of the previous shot is used as a reference for continuity, should it be the start frame or an extra reference image, and where does it go in the order?"

## Status (end of 2026-10-17)

- **Done:** V1S-323 (Notion v3, Blood Rush and the blank template), the env check hook, V1S-325 (Sync: codes and
  shots to Notion, Review Room folders). Blood Rush is linked to Review Room project `ks7d3aqsgbrpz030qvkvha5rtd8ge2pm`;
  EP101 is imported fresh (14 scenes, 0 shots) with scene codes CLD … LBC and 14 locked scene folders.
- **Follow-up (no Linear slot):** mirror shots *added or deleted* in Notion onto the board (field edits already sync).
- **Unlinked, not deleted:** the first test import, project `01a14b46-a81a-713d-bcc9-6ff0ff2ce2e7`; its folder can be removed by hand.
- **Later the same day:** Scene # and Shot # are padded **text** in Notion (scenes 3 digits `010`…`140`, shots 4
  digits `0010`); the app reads text or number. Every scene table shows **Scene code, then Scene #, then the name**.
  Episode pages use a normal filtered Scenes table (Notion locks the built-in relation table's columns). EP00 (the
  "Your Woman" teaser) is not being made: marked OMIT in the archived old page; the old series record moved to
  `data/series/archive/` so the Series page shows only Blood Rush. App, Notion and Review Room were in sync
  (last Sync wrote nothing, 17 locked folders).
- **Next, in this order (operator said: do not start Fit yet):**
  1. Story pass for EP101: write Action and Dialogue for all 14 scenes into Notion (Kimi desktop with the Notion
     plugin + the skill, or Claude). Operator reviews it in Notion.
  2. V1S-329: Fit reads linked story beats, Action, Dialogue and References, assigns dialogue lines, checks itself.
  3. Fit on Kimi writes EP101's shots; operator approves them before anything is sent.
  - V1S-324 (skill v3 + Agent panel writes Notion) and V1S-326 (references, after the operator vets the
    super-seed2 files) slot in around these; references ideally before Fit.
- **Open story items for the story session (operator, 2026-10-17):**
  - Walk through the **whole season arc** together before writing EP101's Action and Dialogue.
  - New character **Bryce**: Kai's love interest, and possibly another evil entity. Not in the Story page,
    story beats or references yet; decide where Bryce enters and what Bryce really is during the story pass.
- The operator expects about three more sessions on this; keep each one to a clear step.

## Parked

Dialogue length driving scene length; a master-shot pass then coverage angles; a vision check of sheet names; a
second model checking that a story beat's shots portray it; two-part episodes; more Storyception structures.
