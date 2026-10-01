# Narrate tickets — handoff (2026-10-01)

## Handoff message to the next thread

**Where I left off:** Linear **V1S-124 — Finalize drafts to 1080p, with the 7-day reminder** (Urgent, GitHub #14), status In Progress. The backend is done and committed (`c101f80`, "V1S-124, part 1"): window state, linking takes to draft jobs, quote and send, and settling a finalize in place. All of it is tested against a fake generator. **Not started:** the route actions, linking the Blood Rush takes, and all of the UI (badge, banner, Finalize buttons). Steps are under "Still to do for V1S-124" below. After that, continue in Linear order: V1S-122, then 123, then 125 to 133.

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

Most of that was scripted through the page (clicks, drops and drags dispatched in the browser, with project state read back), plus screenshots. Prefer real clicks where you can. V1S-124's UI has **not** been browser-tested yet: it doesn't exist.

Work goes straight to `main`. Tickets: Linear project "Narrate — review, cuts, sound & export" (V1S-113 → V1S-133), mirrored as GitHub #3 → #23; spec in `docs/planning/narrate-review-cuts-sound-spec.md` (#2). Do them in Linear order; close the GitHub issue (`Closes #N` in the commit) and mark Linear Done when finished.

## Done (on main)

V1S-113 takes/pick/reject · 114 bench + bin · 115 rewire spine · 116 Narrate name + one nav bar · 117 Agent model providers · 118 drag and drop · 119 Hold · 120 Animate · 121 push to cut + Cuts tab.

## In progress: V1S-124 Finalize (Urgent; GitHub #14)

Generation runs through the **Higgsfield CLI** (`src/lib/server/higgsfield.ts`), not the public REST API: the CLI uses the operator's higgsfield.ai account (plan credits) and supports Seedance draft mode — `seedance_2_5` with `draft: true` (480p) and finalize via `--draft false --draft_job_id <id> --resolution 1080p` with the draft's own prompt/duration. Prices come from `generate cost` (free). On Windows the binary is `%APPDATA%/npm/node_modules/@higgsfield/cli/vendor/hf.exe`; the prompt is passed as a JSON file (`--prompt @file.json`).

Built and tested (backend):
- `src/lib/domain/finalize.ts` — window state (open / closing last 48 h / closed, 7 days from `generation.draft_created_at`), `draftsClosingSoon` (3 days, soonest first), `finalizeRequest`, `applyLinkDraftJobs`, `finalizedTake`.
- Gateway `link_draft_jobs` command; `recordFinalizes`; `applySettleGeneration` swaps a finalized take's media in place (trims, ramp, pick kept; draft file kept as `generation.draft_url`).
- `src/lib/server/animate.ts` — `quoteFinalize` and `sendFinalize` (re-quotes; blocks on a higher price or short balance before any submit). The existing Animate poller settles finalize jobs too.
- `tests/integration/finalize.test.ts`.

Still to do for V1S-124:
1. Route actions on `src/routes/api/projects/[projectId]/animate/+server.ts` (or a sibling `finalize` route): `quote {take_ids}`, `send {take_ids, expected_version, confirmed_credits}`, `link {links}`.
2. Link the Blood Rush takes: `data/projects/01a0f10b-cee6-7765-bdb9-d1de0d611a5d/files/trailer/higgsfield-drafts.json` holds 35 take↔draft-job matches (exact file-size match) with prompts and quotes — feed `links` to `link_draft_jobs`.
3. UI: countdown badge on draft takes in `StoryCardNode.svelte` ("1080p · 5d left", yellow → red in the last 48 h, gone when closed); project banner on the board listing drafts closing within 3 days with Finalize; Finalize on a take and "Finalize all picks" on a cut (Cuts tab), each showing the quoted credits and needing an explicit confirm.
4. Verify in the browser on a throwaway project with a fake/unchanged generator — **never submit a real job** unless the operator says so.

## Operator decisions on record

- **Do not render anything.** Price checks only. The only planned real finalize is the 20 s trailer (V6-00, draft job `4bbbdde6…`, quoted 240 credits) as a test — and only after the operator tops up (balance was 24.01 credits). Everything else stays on the 480p drafts for now.
- Finalize price is 12 credits per second at 1080p (10 s → 120, 15 s → 180, 20 s → 240). All 34 linked drafts: 4,740 credits; just the current picks: 2,760. Windows close 2026-10-07 19:03 UTC (V6-00) and 2026-10-08 ~01:25–02:00 UTC (the rest).
- Optional, not needed: swap the near-fall shot in the 20 s trailer for the better standalone redo (19-ledge-bullet-time). On the board V6-14 already picks the redo.

## Next tickets after V1S-124

V1S-122 edit inside a cut (swap take, drop entry, source info, running length) · 123 suggest trims (add single stray frames at cuts, see the #13 comment) · 125 lock a cut · 126 match to music · 127 Raycast bridge test (ready-for-human) · 128 sound stage · 129 effects pass · 130 export · 131 board groups (use splitter.serving.cloud) · 132 owner brief · 133 UI polish.

## Notes

- Live provider calls are untested: Hyper (no key here; model ids `deepseek-v4.1-flash` / `glm-5.3-flash` are guesses), the Raycast bridge as a model provider, and real Higgsfield submits.
- Background agents hit the account's weekly usage limit once (resets 2026-10-05); prefer doing tickets inline.
- Throwaway test projects go through the API and are deleted afterwards; never mutate the Blood Rush project for tests (undo any test edits).
