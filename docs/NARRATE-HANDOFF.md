# Narrate tickets — handoff (2026-10-01)

## Handoff message to the next thread

**Where I left off:** V1S-124 (Finalize), V1S-122 (edit inside a cut) V1S-123 (suggest trims) V1S-125 (lock a cut) V1S-126 (match to music) V1S-128 (sound stage) V1S-129 (Agent effects pass) V1S-130 (export) and V1S-131 (board groups) are done. Next is **V1S-132 — owner brief** (127 is ready-for-human: the Raycast bridge test), then 133. A throwaway export project (01a0fa85…) is kept on purpose so the operator can try the .fcpxml in Resolve; delete it after. UI rule from the operator: never browser-default controls; use `src/lib/ui/controls/Range.svelte` and `Toggle.svelte` (slim, teal→blue→violet, no rainbow), in Linear order. The operator parked 1080p finalizing: keep working on the 480p drafts (finalize costs a full 1080p render on Higgsfield, 12 credits/s; see Operator decisions).

**Browser testing is required, continuously, not only at the end.** Build each piece and check it in the browser preview (`.claude/launch.json` → "csp-dev", port 5174) as you go: open the board, click the real controls, read the page and console, take a screenshot as proof. Do this on a throwaway project created through the API, then delete it. The previous thread did this for every finished ticket:

| Ticket | What was checked in the browser |
|---|---|
| 113 | Take cycling, picks saved across reload, reject, reveal, restore |
| 114 | Bench, bin, Preview strip skipping the benched beat, refused shift-click |
| 115 | Connect, rehook, unhook by dropping off and by Delete, loop refused |
| 116 | One nav bar, tab order, page titles, Settings |
| 118 | Drops on a beat and on empty canvas, refused types, 2K flag |
| 119 | Hold rendered and became the pick |
| 120 | Animate panel, Agent draft, live lint, sending disabled with no CLI or key |
| 121 | Push, Cuts tab, cut edits staying separate from takes |
| 122 | Swap a cut entry's take from the picker (trim kept, saved), drop entries down to one (then disabled), source info and live cut length — throwaway project |
| 123 | Suggest trims on copies of real Blood Rush clips: marks on the timeline, dismiss one, accept one, accept all — each saved to the cut |
| 125 | Lock, read-only player (drags on clip edges and the speed lane do nothing, no console errors), unlock to v2, edit v2, open locked v1 read-only from versions |
| 126 | Real Blood Rush material (copies): freshman-year song attached through the page's file input (162 BPM grid), song + clip waveform lanes, Match: v10's out-of-sync piece slid −4 s onto the song, v8 raw (Seedance audio, r 0.27) beat-snapped; undo restored, keep saved |
| 128 | Sound tab on a locked cut of real renders (copies) + the real song: ambience bed and a hit placed, music gain dragged, Build mix (15.05 s, peak −5 dB under the −1 dBFS limiter), report (auto levels, ramp muting above 1.5×, ducking), Play with picture plays the mix |
| 129 | Effects folder set in Settings (E:\music\Splice\Samples → 18 effects after filtering), Agent (Kimi k3) suggested a riser and a downsweep with reasons; keep one, remove one; mix rebuilt with the operator's full mashup (154.8 BPM grid) |
| 130 | Export tab on real renders (copies): drafts listed before export, Export MP4 + Resolve timeline → 3 baked clips (1920×1080; the 3× ramp baked to 121 frames), mix + 2 stems, MP4 361 frames / 15.04 s with AAC, FCPXML 1.9 sequence 361/24s with lanes −1…−3. Resolve import itself not yet tried (needs the operator) |
| 131 | Shots on a copy of the real V6 20s trailer → the live splitter (splitter.serving.cloud, PIN from .env.local) returned 16 shots = the hand prototype; new group shown; slices keep source + in/out; select a beat → move to Main; + new group by typing. Fixed on the way: overlapping default rows (a stray click split a shot), two-step Shots, none on slices, focus on the name box |
| 124 | Badges (yellow, red, finalizing…) on a throwaway project and on Blood Rush; Finalize on a take, banner Finalize all and hide, cut Finalize all picks — real quotes, sends blocked by the short balance |

Most of that was scripted through the page (clicks, drops and drags dispatched in the browser, with project state read back), plus screenshots. Prefer real clicks where you can. V1S-124 was browser-tested with real clicks (no submits).

Work goes straight to `main`. Tickets: Linear project "Narrate — review, cuts, sound & export" (V1S-113 → V1S-133), mirrored as GitHub #3 → #23; spec in `docs/planning/narrate-review-cuts-sound-spec.md` (#2). Do them in Linear order; close the GitHub issue (`Closes #N` in the commit) and mark Linear Done when finished.

## Done (on main)

V1S-113 takes/pick/reject · 114 bench + bin · 115 rewire spine · 116 Narrate name + one nav bar · 117 Agent model providers · 118 drag and drop · 119 Hold · 120 Animate · 121 push to cut + Cuts tab · 124 Finalize to 1080p · 122 edit inside a cut (swap take, drop entry, source info, running length) · 131 board groups (`domain/groups.ts`, `server/splitter.ts`, `/split` route; group remembered per project in localStorage) · 130 export (`domain/export.ts` plans + FCPXML; `server/export.ts`; files in files/export/<cut>-v<n>/) · 129 Agent effects pass (Settings → Sound effects folder; Mirelo text-to-audio via CLI for generated effects at 0.25 credits/s, always priced and confirmed first; beat grid is now DP beat tracking) · 128 sound stage (sound plan per locked version; `SoundStage.svelte`; mix render plan in `domain/sound.ts`; effects layer takes manual placement and has a `suggested` flag ready for V1S-129) · 126 match to music (song lane + per-clip waveforms; aligns a take's own audio — works when the song is in the take's audio, e.g. the SFX-plus-SONG renders; Seedance's own generated music doesn't match, so those beat-snap) · 125 lock a cut (versions kept; sound work should reference `{cut_id, version}` of a locked version) · 123 suggest trims (frame-difference detector; on real Blood Rush takes it flags only TR-05 stutter and TR-20's end freeze; the reported stray frame at the V6-12/13 join did not reproduce in the files on the board).

## V1S-124 Finalize (done; GitHub #14)

Generation runs through the **Higgsfield CLI** (`src/lib/server/higgsfield.ts`), not the public REST API: the CLI uses the operator's higgsfield.ai account (plan credits) and supports Seedance draft mode — `seedance_2_5` with `draft: true` (480p) and finalize via `--draft false --draft_job_id <id> --resolution 1080p` with the draft's own prompt/duration. Prices come from `generate cost` (free). On Windows the binary is `%APPDATA%/npm/node_modules/@higgsfield/cli/vendor/hf.exe`; the prompt is passed as a JSON file (`--prompt @file.json`).

Built and tested (backend):
- `src/lib/domain/finalize.ts` — window state (open / closing last 48 h / closed, 7 days from `generation.draft_created_at`), `draftsClosingSoon` (3 days, soonest first), `finalizeRequest`, `applyLinkDraftJobs`, `finalizedTake`.
- Gateway `link_draft_jobs` command; `recordFinalizes`; `applySettleGeneration` swaps a finalized take's media in place (trims, ramp, pick kept; draft file kept as `generation.draft_url`).
- `src/lib/server/animate.ts` — `quoteFinalize` and `sendFinalize` (re-quotes; blocks on a higher price or short balance before any submit). The existing Animate poller settles finalize jobs too.
- `tests/integration/finalize.test.ts`.

Added in part 2:
- `POST /api/projects/[id]/finalize` — `quote {take_ids}` (free price check), `send {take_ids, expected_version, confirmed_credits}`, `link {expected_version, links}`.
- `FinalizePanel.svelte` — per-take and total credits, balance (red and blocked when short), "Finalize…" then an explicit "Finalize for N credits". Opened from a take's **Finalize** button on the board, the board **banner** (drafts closing within 3 days, soonest first; "Finalize all…"; hide per project) and **Finalize all picks (N)…** on a cut in the Cuts tab.
- Card badge "1080p · 6d left" (yellow; red in the last 48 h; "finalizing…" while a finalize is in flight; gone when closed). Shared minute clock in `src/lib/ui/clock.svelte.ts`.
- Guards: a take already finalizing can't be quoted again; two takes from the same draft job (TR-19 and V6-14 share one) can't be finalized together, and the banner/cut list each draft once.
- **Blood Rush is linked:** 35 takes → 34 draft jobs (ledger v68 → v69, metadata only). Browser-checked on the real board: badges show, the V6-00 quote reads 240 credits against 24.01 left and sending is blocked.

## Operator decisions on record

- **Do not render anything.** Price checks only. The only planned real finalize is the 20 s trailer (V6-00, draft job `4bbbdde6…`, quoted 240 credits) as a test — and only after the operator tops up (balance was 24.01 credits). Everything else stays on the 480p drafts for now.
- **1080p finalizing is parked (2026-10-01):** stay on the 480p drafts for now. Finalize is not a cheap upscale on Higgsfield: the CLI and the connector's free `get_cost` both price finalizing V6-00 at 240, the same as a fresh 20 s 1080p run; no Higgsfield doc says otherwise (the old "~60" note was the 20 s *draft* price).
- Finalize price is 12 credits per second at 1080p (10 s → 120, 15 s → 180, 20 s → 240). All 34 linked drafts: 4,740 credits; just the current picks: 2,760. Windows close 2026-10-07 19:03 UTC (V6-00) and 2026-10-08 ~01:25–02:00 UTC (the rest).
- Optional, not needed: swap the near-fall shot in the 20 s trailer for the better standalone redo (19-ledge-bullet-time). On the board V6-14 already picks the redo.

## Next tickets

127 Raycast bridge test (ready-for-human) · 132 owner brief · 133 UI polish.

## Notes

- Live provider calls are untested: Hyper (no key here; model ids `deepseek-v4.1-flash` / `glm-5.3-flash` are guesses), the Raycast bridge as a model provider, and real Higgsfield submits.
- Background agents hit the account's weekly usage limit once (resets 2026-10-05); prefer doing tickets inline.
- Throwaway test projects go through the API and are deleted afterwards; never mutate the Blood Rush project for tests (undo any test edits).
