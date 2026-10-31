# Pickup — where the trailer work stopped (2026-10-31)

Read this first next session. Everything below is on `main` (last commit `a0939c2`).

## Where things stand

**Trailer project:** Blood Rush — Teaser Trailer (renamed from "EP01 Cold Open" on 2026-10-31), `01a0f10b-cee6-7765-bdb9-d1de0d611a5d`. It is the big teaser for the whole show, not a cold open.

- **Score:** `freshman-year-mashup-full.wav` (1:26). Essentia analysed it: 126 BPM, 181 beats, sections intro · intro · verse · chorus · chorus.
- **Shots:** all 47 are tagged by the caption gateway. V6-15 "Title / black" is flagged by hand as the title card.
- **Latest cut:** the newest "First cut · freshman-year-mashup-full" has 49 entries, runs 87.7 s and plays. It covers the whole track and ends on the title card.
- **Old cuts to clear out:** three older "First cut" attempts are in the Cuts list. Two of them hold stills and won't play.

## Built this session

- **Shots tab**
  - Drop or add files and whole folders.
  - From Higgsfield… shows your newest finished renders to import.
  - Each card has bench, remove (with undo) and a title card toggle.
  - Tag shots runs two at a time and stops after three failures in a row.
- **Score row**
  - Add a score, then analyse it with Essentia.
  - First cut to score is planned in code: same tags + same score always give the same cut.
- **Cut player and preview:** same component; it fits one screen, and the timeline has zoom and fit.
- **Board**
  - Drag selects (pinch zooms, scroll pans).
  - Shots show an arrow cursor.
  - F frames the selection.

## Trailer direction (your notes, 2026-10-31)

- **What it is:** the big teaser for the whole show, longer than it is now, with more story filled in.
- **Shape:** music dropouts. The song cuts out for a beat and a dialogue line or a moment plays, then the music slams back in. There should be several of these.
- **The hook:** set something up early that nobody understands, and pay it off later in the show. The model is *How to Get Away with Murder* (Shonda Rhimes): twists where you think it's one thing and it's another.
- **Research first:** study the best teaser trailers and how they build: dropouts, dialogue buttons, the reveal and the title card.
- **Order of work:** finish the technical items below first, then the story.
- **Story changes, Notion first and for good:** change the story in Notion permanently, so nothing gets pulled from the old version. Episode 1 can stay as it is; the arc changes from episode 2 on.
  - Bryson can be in the trailer before his full backstory is worked out.
  - **Bryson** has to be in the trailer. He doesn't appear in episode 1. He's the dean's son.
  - **The dean** is spying on the group because he believes Kai is planning something evil.
  - **Bryson and Kai** have a secret romance, but Bryson is getting close to Kai on his dad's orders.
- **What the app needs for this:**
  - Dropout markers in a cut: the song ducks or mutes over a span while that shot's own dialogue plays.
  - The first cut should leave room for dialogue moments, not just cut on beats.
  - Shots for Bryson and the dean have to be made first: references, then Prep, then shots.

## Next, in order

0. **Captions must name the characters.** Today a tag says "a young man with bleached hair", not "Kai", so once shots come from different places there's no telling who is who. We have character sheets for everyone (the series references, with the headshot cropped from each sheet's first panel). Plan:
   - **Who might be in the shot:** take the names in the shot's title, beat and generation prompt, and show the model only those headshots. A short list is far more reliable than "find these faces among everyone".
   - **Giving the model the faces: copy stack-structure, which already solved this.**
     - `src/trigger/caption.ts` (around line 154) sends up to three `referenceImages` with the frame, each with a `referenceLabels` entry `{ name, role }`. The live gateway at `caption.v1su4.dev` already accepts them.
     - `src/components/studio/sceneCaptionPrompt.ts` has the rules. Match people by recognizable identity, never by clothes, gender or importance. Name a matched character and don't describe their looks. Answer `name: null` when unsure. Use named locations consistently. Return structured `evidence.subjects[{ name, confidence, role }]`.
     - Reuse that prompt and evidence shape here instead of writing new ones.
   - **Fixed vocabulary:** `subjects` must be names from the references list, or `unknown`. Never a description.
   - **Link the project to its series:** Cold Open has no series attached (`project.series` is empty), so the app can't find Blood Rush's references for it.
   - **Re-tag** the 47 shots afterwards, and let the planner use the names: same characters together, the lead in the opening and closing beats.
0b. **Missing Seedance prompts on 18 takes.** 35 of the 53 video takes have their prompt and job ID. The rest:
   - **15 V6 slices:** split from the v6 trailer, and the split didn't copy the source's prompt. Copy the source take's generation onto its slices, and make splitting do that from now on.
   - **2 dropped `hf_…` files:** the job ID is in the file name. Look each one up with `higgsfield generate get <id>` and attach `job_id` and `generation`. Also make file intake do this for any dropped file named `hf_…<uuid>`.
   - **1 TR- take.**
   - Then re-tag those shots so their captions get the prompt as context.
1. **Delete a cut.** There's no command for it yet, and the old broken first cuts need removing.
2. **Stills in cuts.** The cut player plays video only, so the first cut leaves out the 9 P01 stills. Either make the player hold a still for its length, or animate those stills.
3. **Play order on the Board.** Today selected shots play in their order on the Board (left to right, rows top to bottom), not the order you clicked them. You expected click order. Shift-clicks should keep click order; a box selection falls back to Board order.
4. **First-cut planner finesse.**
   - The intro currently pulls action shots (fight, smash landing). Weight story order more in quiet sections, or let you pin the opening and closing shots.
   - Group shots by place and subjects from the tags.
   - Add a "reshuffle" that gives a different but still repeatable cut (a seed).
   - Clips shorter than one beat (the 0.46 s v6 clips) leave one cut off the beat. Snap or skip them.
5. **Tags on the card.** Add a per-card re-tag button, and let you edit the caption, place and energy.
6. **Show the song's sections** as coloured bands on the cut timeline (intro, verse, chorus).
7. **Prep tab** is empty on projects that aren't episodes: rename it or hide it there.
8. **Agent speed.** Kimi k3.1-pro takes minutes for image-heavy calls. Try a Gemini model through the Raycast bridge on the Mac (Settings → Agent model; its test checks pictures).

## Machines and services

- **PC:** needs `git pull` (the post-merge hook rebuilds graft). Its `.env.local` also needs `ESSENTIA_API_URL`, `ESSENTIA_API_KEY`, `SCENE_CAPTION_SMART_GATEWAY_URL` and `SCENE_CAPTION_SMART_GATEWAY_TOKEN`; copy them from the Mac. Restart the dev server after any env change.
- **Essentia:** `https://essentia.v1su4.dev`. There's one key; beatsmaxxer-pro's `.env` has the working copy. Studio jobs need app-vm's GPU.
- **Caption gateway:** `https://caption.v1su4.dev`, running Qwen3-VL-8B on app-vm. It now runs with `--cache-ram 0` (RAM went from 14 GiB to about 0.6 GiB).
- **If either service says "no CUDA":** follow proxmox-home `docs/app-vm-dockhand-runbook.md`. On 2026-10-31 the GPU had fallen off the bus, and a VM restart fixed it. Never fall back to CPU.

## Still parked

- Review Room on its own domain
- A Trigger.dev job queue for Agent calls
- Moving Prep media into Review Room
- Deleting the GitHub branch `chore/graft-post-pull-hooks` (you said you'd do it)
