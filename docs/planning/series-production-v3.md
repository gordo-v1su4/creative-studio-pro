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
  - New character **Bryson**: Kai's love interest, and possibly another evil entity. Not in the Story page,
    story beats or references yet; decide where Bryson enters and what Bryson really is during the story pass.
    **Elias** was originally going to be the love interest; that role moves to Bryson, so Elias's arc needs a
    look too. The operator already has pictures of Bryson (to vet with the other references, V1S-326).
- The operator expects about three more sessions on this; keep each one to a clear step.

## Parked

Dialogue length driving scene length; a master-shot pass then coverage angles; a vision check of sheet names; a
second model checking that a story beat's shots portray it; two-part episodes; more Storyception structures.

## Status (2026-10-18, early)

- **Done and pushed to main:** V1S-327 (handle compile + lint), V1S-328 (previous shot's last frame + chips on shots),
  V1S-329 (Fit reads Action, Dialogue, story beats and References; dialogue placement check; self-check), V1S-324
  (skill v3; the Agent panel writes story beats, episode outlines and scenes into Notion, verified live on a throwaway
  series, now in Notion's Archive), V1S-326 (Review Room `_References` folders, created for Blood Rush; upload from the
  References drawer; `scripts/stamp_reference_name.py`).
- **Decision waiting on the operator:** a previous-shot frame under 2048 px blocks the send (refs-min-2K). A 1080p or
  480p pick's last frame is under that. Exempt it, upscale it, or keep the block?
- **Holds:** the P01 "2:47 AM" teaser is **on hold** (operator, 2026-10-18). Its shots are fine as a scene but not
  exciting. A more exciting action teaser exists elsewhere. Leave the scene out of Fit runs.
- **Priority order (operator, 2026-10-18):** EP101 Act 1 first (shots populating across CSP, Notion and Review Room),
  then the episode's images, then the trailer. **The season trailer (V1S-297, Video Haven Website) is due today
  (2026-10-18):** pick the cut at 480p from the existing shots, make it a little longer than the current ending (Kai on
  the roof doing tricks, almost falling off the side but not), then up-res.
- **Next for V1S-283:** (1) story pass for EP101 Act 1 (Action and Dialogue) in the Agent panel's Story mode, which now
  writes to Notion; (2) References: vet super-seed2, add rows to Notion, upload from the drawer; (3) Sync, then Fit
  Act 1 (skip the teaser); (4) the operator approves the shots; (5) grid stills through the send gate.

## Hand-off for the next session (end of 2026-10-18)

- **Act 1 is in Notion.** Action and Dialogue for 020 Morning Quad, 030 The Paper Cut and 040 Video Haven, Day were
  approved and written (`docs/planning/ep101-act1-draft.md`). Bryson stays out of the pilot (enters EP02/EP03). The
  story-beat episode links were already correct.
- **First thing next time, a gap:** an imported episode copies each scene's Action and Dialogue **once, at import**.
  Sync writes codes and shots but does not pull scene text back in, so the EP101 project still has empty
  Action/Dialogue and Fit would see nothing. Fix: make Sync (or a "Refresh scenes" action) re-read each imported
  scene's Action, Dialogue, story-beat and reference links into `project.series.scenes`, deterministically. Then run
  Fit on Act 1 only (020–040), skipping the teaser.
- **Then:** the operator reviews Fit's Act 1 shots → References (vet super-seed2, Notion rows, upload from the drawer)
  → grid stills through the send gate (only after the operator's OK) → Acts 2–3 story pass the same way.
- **Open decision:** a previous-shot frame under 2K blocks the send (V1S-328). Exempt it, upscale it, or keep the block?
- **Trailer (V1S-297, other repo/project):** due 2026-10-18; pick at 480p from the existing shots, extend past the
  rooftop near-fall, then up-res.
- **Leftovers to delete by hand:** local projects `01a14b46-…` (first test import) and `01a14d3c-…` (throwaway Agent
  write test); the throwaway Notion page is in Archive.

## Status (2026-10-20)

- **Scene-text gap closed** (`eefd123`): Sync now copies each imported scene's Action, Dialogue, Summary, Location,
  Characters, story-beat and reference links from Notion into the episode (Notion-owned, nothing written back).
  Live: 3 scenes refreshed (020–040).
- **Fit budget** (`ce01eba`): 8- and 10-shot scenes timed out at the fixed 180 s on Kimi k3; the answer budget now
  scales with the shots wanted (45 s and 1200 tokens a shot, capped at 600 s / 16000).
- **Act 1 fitted at 10 min:** Morning Quad 6 shots (35 s), The Paper Cut 8 (50 s), Video Haven, Day 10 (60 s). That's 24 shots,
  lint clean, self-check passed (it caught one renamed speaker). The teaser was skipped. Synced: 24 shot pages created in
  Notion with codes `BLR_EP101_<scene>_<shot>`. The codes are **not locked** yet.
- **Waiting on the operator:** (1) review and approve Act 1's 24 shots (Story tab or Notion); (2) vet the super-seed2
  references, add their Notion rows, link them to scenes 020–040 and upload from the drawer. The shots say "No
  image:" for every character until then, so re-run Fit or set references on the shots after linking; (3) lock the
  codes; (4) the previous-shot frame under 2K decision; (5) OK for grid stills through the send gate (spend).
- Acts 2–3 still need their story pass (Action and Dialogue) before Fit can fill them.

## Paused for the operator (2026-10-20, later)

- **All 92 shots written** (Acts 1–3 + Tag, teaser on hold), synced to Notion with codes (not locked). Acts 2–3
  draft: `docs/planning/ep101-acts2-3-draft.md` (090: Mara no longer says the banned word).
- **References and tests ready, nothing sent:** `docs/planning/ep101-references-and-tests.md`. Picks per character in
  the project's `files/references/characters/`, alternates in `candidates/`, location sources in
  `locations/sources/`. Tests A (Elias + Rowan arguing), B (Mara close-up), C (close-ups for Rowan, Malik, Malachi),
  D (new anamorphic base plates per location), then scene 020 both ways. One send at a time, with the operator's OK, through the
  Higgsfield plugin (plan credits; show before/after and the API-price equivalent).
- **Also done today:** Sync refreshes scene text (`eefd123`), Fit budget scales (`ce01eba`), previous-shot frames
  under 2K are upscaled (`01fa58b`), phone access over Tailscale
  (`https://desktop-q20uuvd.tail7fdbe2.ts.net:8443`, `c4d5f8e`); the top bar now works on a phone (tabs, project picker, `117167e`).
- **Open:** may a 1672 px image (Mara's clean multi-panel) be an input? Lock the codes after the shot review. A
  per-episode Save the Cat arc is for the season-rework session.

## Session 2026-10-20 (evening): references live, free image tests

- **References are wired end to end.** 8 rows in Notion's References (7 crew + College Quad), linked to their
  scenes, uploaded to Review Room `_References` (needed: Review Room learned reference codes `BLR_REF_CHR_…`,
  review-room-svelte `5036f26`, Convex deployed; CSP sends metadata in Review Room's shape with an Idempotency-Key
  and settles retries, `442ac51`). The References drawer shows each picture whole in a 400 px panel (`cc9bd8d`).
- **Scene 020 re-fit** with the references: its 6 shots now name the images. The other scenes still carry
  "No image:" — re-fit each (Story tab → open the scene → Take out fitted → Fit this scene) once the character
  refs are final.
- **Prompts** (`7630112`, `b4fc508`): grids are square only (2x2 up to 4 shots, else 3x3; spare cells are closer
  angles, never black), a one-line opener + "Shot N.", no negatives; Nano Banana names read
  `Kai "Hoodie" Santana from image 1` (the operator's form that bound best).
- **Testing method:** free runs in the operator's Higgsfield tab (Nano Banana Pro, 2K, Unlimited), 2–3 at a time;
  never overwrite the operator's prompt box without asking. Results so far: wide/grid shots lose identity; the
  operator's lean 2x2 came closest (Kai held). Next tests: **one shot per image at 2K, only the refs that shot
  needs**, night only (no daytime), haze helps.
- **Character work in progress (Elias):** new sheets in a dark teal plaid button-down (white hoodie retired),
  saved in `files/references/candidates/Elias/`. Recipe: one big hero headshot (anamorphic ECU, night alley,
  defocused, haze), rerun until the skin detail lands, then use it as the identity ref. Elias must read different
  from Bryson (Bryson: lip ring, right-cheek mole, hazel eyes, black hoodie). Still to do: Rowan's sheet without
  the teeth, hero ECUs for each crew member, Malik in clothes (his only sheet is shirtless).
- **Open:** the UX pass the operator asked for (live status while Kimi writes, the scattered Fit/Take out/Grid
  buttons, a Fix button for blocked sends); Fit writes "16:9 cinematic keyframe, fall 2001 film look:" into every
  shot (say it once).

## ONE SHOT rebuild (grilled 2026-10-25)

The old prompts didn't work, so EP101 starts over on the five ONE SHOT skills, copied into the app as its own logic
(ADRs 0003, 0004; terms in `CONTEXT.md`: Prep, Reference spec, Source image, ONE SHOT standard, Shot spec).
Tracked in Linear under V1S-283, in this order: V1S-370 skills in, V1S-371 clean slate (trash the 92 shots),
V1S-372 setting fix (Willamette Valley, not California), V1S-373 GPT Image 2.5 at 2K through the operator's
Higgsfield account with an approval step and credit prediction, V1S-374 Prep (references), V1S-375 shots from Ghost,
V1S-376 2x2 keyframes, V1S-377 Fresh idea. V1S-378 (GhostSuno score prompt) is on hold.

**Stills route (V1S-373, 2026-10-25).** The app already sends through the Higgsfield CLI (`@higgsfield/cli`,
`hf.exe` under the npm global folder, or `HIGGSFIELD_CLI`), logged in to the operator's account (`higgsfield auth
login`; Creator plan, plan credits). Every still is `gpt_image_2_5`, quality high, resolution 2k: 2.75 credits each
at any aspect. Quote → approval card (prompt, references in attach order with exact names, model, credits, episode
running total) → send re-quotes and refuses if the prompt, the reference order or the price changed → spend logged
in `production.still_sends`. Code: `src/lib/server/stills.ts`, `src/lib/domain/stills.ts`, `StillApprovalCard.svelte`.
