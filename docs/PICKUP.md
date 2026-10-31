# Pickup — where the trailer work stopped (2026-10-31)

Read this first next session. Everything below is on `main` (last commit `a0939c2`).

## Where things stand

**Trailer project:** Blood Rush — EP01 Cold Open (P01 · 2:47 AM), `01a0f10b-cee6-7765-bdb9-d1de0d611a5d`.

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

## Next, in order

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
