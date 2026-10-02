# Narrate tickets — handoff (2026-10-01)

## Handoff message to the next thread

**Where I left off (2026-10-02, context full):** building **Series from Notion**: a series is a Notion root (Story page plus Episodes → Scenes → Shots databases), and each episode imports as its own project. Built and tested (229 tests pass), and the live connect works; nothing has been imported yet. **Next, in order:** (1) in Notion, make an isolated area (below); (2) re-point the connection to it; (3) import EP01 from the copy and browser-test it; (4) the Episode outline in the Story tab; (5) "Fit to 10 / 15 min" (the Agent writes shots to the target length, through the lint loop). The app is named **Creative Studio Pro** again (top bar, page titles, Agent prompts); Narrate is only the review/cuts/sound workflow name. Dev server: `csp-dev-5175`.

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
| 132 | Story tab: Draft brief (Kimi drafted every field from the seed, incl. a quoted ban), added a must-not, Save → files/PROMPT-RULES.md written with the managed section; bans enforced by the linter. Right panel starts closed; stage gate is a collapsed, optional section. (Pane was hidden, so clicks ran inside the page.) |
| 133 | Throwaway project with copies of 4 real Blood Rush drafts: top bar (softer brand, grey project name, spaced tabs, slim keys, Agent tooltip), left panel collapse/expand handle, posters fade in, hover chips (Muted/Sound key, time readout), sequence bar → Play, transport keys (pause, next clip, frame steps → clip 2/3, frame 3/361), push to cut, take Pick by keyboard (↓ Enter swapped and saved), lock, Sound tab Pick, Build mix, AudioPlayer play/seek to 30 s/pause, Export Pick closes on an outside click; no horizontal overflow at 375 px (page and player) |
| board | Throwaway with 4 real drafts: shift-drag box over a row → selection bar; New group… → typed name → beats moved; double-click rename; box the other row → Play in order (left card first); rail → moves one beat; select a connector → × Unhook removed the link (saved); card footer reads TK 2/2 on one line |
| TH | Trailer House on a throwaway with real Kimi: seeds typed → 3 pitches → a teaser (12 s, Seedance 2.5) → characters; Kai's 2K sheet attached through the panel (an 800×600 test image refused), three more with the image; a 2.5 teaser came back in the four-section format with `@Image_1` and a speaker-block line |
| 124 | Badges (yellow, red, finalizing…) on a throwaway project and on Blood Rush; Finalize on a take, banner Finalize all and hide, cut Finalize all picks — real quotes, sends blocked by the short balance |

Most of that was scripted through the page (clicks, drops and drags dispatched in the browser, with project state read back), plus screenshots. Prefer real clicks where you can. V1S-124 was browser-tested with real clicks (no submits).

Work goes straight to `main`. Tickets: Linear project "Narrate — review, cuts, sound & export" (V1S-113 → V1S-133), mirrored as GitHub #3 → #23; spec in `docs/planning/narrate-review-cuts-sound-spec.md` (#2). Do them in Linear order; close the GitHub issue (`Closes #N` in the commit) and mark Linear Done when finished.

## Trailer House: the start of a project (Kimi, 2026-10-02)

The Story tab opens with **Trailer House**, the operator's flow for a new idea:

1. **Seeds**: a few words or images. Optional: a main character, in text and/or a reference image (at least 2K on the long edge; smaller is refused; the Agent sees it in every step and never re-describes the look).
2. **Three pitches** from the Agent, each a one-sentence logline plus a short description. Pick one, or **Three more**: the Agent is told what it already offered for the same seeds.
3. **The teaser**, right away: TITLE, LOGLINE, HOOK and a Seedance prompt, so the operator can render it and judge the idea.
4. **Keep going**: main character and relationships, then a plot outline, then **Full story arc** (Build story, which now reads the teaser, characters and outline).

- **Master prompt:** `prompts/trailer-house.md`, edited like a doc. It is the operator's Raycast "Trailer House" instructions, rewritten for Kimi. Raycast is on hold; the Raycast bridge is not configured (URL and token are blank in `.env.local`, and the bridge isn't running). V1S-117's "Raycast as an Agent model" can't work as built, because the bridge has no chat endpoint.
- **Seedance formats are skills:** `.agents/skills/seedance-2-5-higgsfield` and `seedance-2-0-higgsfield`, both current as of 2026-10-02. Each has a `SKILL.md` and a `format.md`; the app puts the chosen model's `format.md` into the master prompt, so the skill is the single source.
  - 2.5 uses an opening line plus REFERENCE AND CONTINUITY / STORY AND TONE / `[00:00–00:05] — SECTION` timeline / VISUALS AND SOUND. Dialogue is a speaker block in the section where it is spoken; sounds sit at their moment. The canonical example is the operator's own THE DELIVERY MAN prompt (`example-the-delivery-man.md`).
  - 2.0 is plain prose: `Total: Ns / N shots / aspect`, then `Shot 1:` … and an `SFX:` line.
- **Lint loop:** the Agent's Seedance prompt goes through the operator's full prompt linter (`domain/prompt-lint.ts`: declared names only, no pronouns, generic person or place words, or partial names, no re-described looks, banned words plus the project's rules file, `@Image_1`). The Agent fixes every finding, for up to three rounds (`lintAndFix`). The route streams each round (NDJSON) and the panel shows it live: the draft with findings highlighted (red errors, yellow warnings), then the fix. Banned words are blacked out (▇▇▇) everywhere in what the Agent reads. The saved teaser carries `lint` {rounds, fixed, remaining}; "Fix again" re-runs it. Both format skills teach the declaration style (`@Image_1 = Name — …`, `No image: Name — …`).
- **Render:** `server/teaser-render.ts` + `/trailer-house/render` (quote / send / poll / board). The teaser goes to the chosen Seedance through the Higgsfield CLI: 2.5 as `omni_reference` with the character image as `--image-references`, `t2v` without; 2.0 without draft flags; aspect passed. It is priced first, sent only for the exact confirmed price, and blocked while lint errors remain. A 2.5 480p render is a draft. The panel polls every 10 s, and the finished clip lands in `files/trailer-house/` and plays in place. "Add to board" makes it a take (with job id and draft info, so Finalize works) on a beat in a "Teasers" group. Real quote seen: 12 s 2.5 draft at 480p = 36 credits. Balance was 1.01, so Send stayed locked; nothing was rendered.
- **Fixed on the way:** Animate's Seedance 2.5 request sent `--start-image` without `--mode omni_reference`, which the CLI rejects (t2v takes no media). `seedanceArgs` now sets the mode.
- **Code:** `domain/trailer-house.ts` (targets 2.0: 4–15 s, 2.5: 4–30 s; parsers), `server/trailer-house.ts` (Kimi calls), route `/trailer-house` (pitch / develop / continue / clear) and `/trailer-house/character-image`, and `TrailerHousePanel.svelte`. State lives in `project.trailer_house`, and the teaser becomes the lead voice.
- **Browser-tested with real Kimi** on a throwaway project: pitches, three more with Kai's 2K sheet attached, a 2.5 teaser in the new format, characters, an under-2K image refused.

## Higgsfield API (separate from the CLI) — 2026-10-02

Two different Higgsfield services:
- **Higgsfield CLI** (`hf`, `server/higgsfield.ts`): what the app uses for Animate, Finalize and Trailer House renders. It runs on the higgsfield.ai plan's credits and has Seedance 2.5 480p drafts and finalize.
- **Higgsfield API** (console.higgsfield.ai, `@higgsfield/client`): its own pay-per-use dollar balance (about $15 loaded), billed per request, no draft or finalize. Key: `HIGGSFIELD_KEY` in `.env.local` (KEY_ID:KEY_SECRET; the operator chose this name over the SDK's `HF_CREDENTIALS`). `scripts/higgsfield/index.ts` prices by default (free) and generates only with `--run`; `--model 2.0` switches models.
- Models: `bytedance/seedance-2.5/text-to-video` (4–30 s, 480p/720p, about $0.2056/s at 480p) and `bytedance/seedance-2.0/text-to-video` (4–15 s, 480p–4K, token-metered at about $0.014 per 1,000 video tokens; 4 s at 480p ≈ $0.54).
- Verified 2026-10-02: one Seedance 2.5 run, 480p, 4 s, no audio (≈ $0.82), request `f90e4d1b-3548-4103-8b52-2293585d07ea` completed with a video URL. Seedance 2.0 is priced but not run (its endpoint has the same shape).
- Not wired into the app yet.

## Series from Notion (in progress, 2026-10-02)

**The operator's goal:** a web series (Blood Rush, 12 episodes), test episodes at **10 or 15 minutes** (30 later), Notion as the source of truth. The Notion side must be **isolated and reusable as a template** for future shows.

**Built (committed):**
- `domain/notion-series.ts`: the template (`SERIES_TEMPLATE`: Episodes / Scenes / Shots with required properties), `checkDatabase`, readers (`toEpisode` / `toScene` / `toShot`), `layoutEpisode` (act order Teaser → Act 1… → Tag, read from scene timecodes), `actBudget(layout, minutes)`, and `episodeToBoard` (one group per scene named "Act 1 · P02 — Morning Quad", one beat per shot with prompts, duration and `source` details: dialogue, audio, refs, lens, camera, characters).
- `server/notion.ts`: the official `@notionhq/client` v5 (data sources) behind a `NotionApi` seam. `readSeries` walks **only the root page** (plus one level of child pages, e.g. "Databases (raw)"), finds the databases by data-source title and the story page by `/story/`, and reads the story text.
- `server/series.ts`: `SeriesStore` (in `data/series/<root>.json`, git-ignored), `connectSeries`, `importEpisode` (new project plus gateway `importEpisode`, which refuses a board that already has beats).
- Schemas: card `source`, cards max 400, `project.series` (episode and scene outline), event `project.episode_imported.v1`.
- Routes: `GET/POST /api/series` (connect by root link) and `POST /api/series/[id]` (refresh / runtime / import). The `/series` page: setup steps, connect, template chips, read the story, episode length 10/15/30, episode list with Import / Open. Opening `/?project=<id>&tab=story` opens a project.
- The secondary-page header (`+layout.svelte`) says Creative Studio Pro and has Series in its nav.

**Notion connection (done in the browser with the operator):** internal connection **Creative Studio Pro**. It has **read content only and no user info**, and its content access is **only "Bloodrush Series Shot List"** (root id `3d88a006765081d3aa63cb0f9c1a4ca0`). `NOTION_TOKEN` is in `.env.local` (`.env.example` has the name only). ⚠ The token showed up in plain text in a page read during setup; **the operator was asked to regenerate it** (Configuration → refresh icon) and update `.env.local`. Confirm this was done.

**Live connect result:** all template checks pass; the story page is "Blood Rush — Season 1 Story (v2 · Rush draft)" (14k characters). 13 episodes: EP00 Teaser Sizzle (6 scenes, 37 shots), **EP01 The Late Shift (14 scenes P01–P14, 67 shots, every shot has a Seedance 2.5 prompt, about 6 minutes of shots; its timecodes plan for 25 min)**, EP02–EP12 outline only (no scenes).

**Next step agreed with the operator (not started):** make the Notion side isolated:
1. A new top-level page **"Creative Studio Pro"**, the only page the connection may see.
2. Under it, **"Blood Rush (example)"**: a copy of the Bloodrush series (story, Episodes / Scenes / Shots with rows). Check that the copy's relations point inside the copy, not at the originals.
3. Under it, **"Series Template"**: the same structure, empty (the story page with section headings, three databases with the template properties and two-way relations).
4. Re-point the connection's content access to "Creative Studio Pro" only (removing the original Bloodrush page). That is a settings change: ask the operator first.

Use the Notion MCP (as the operator) to create and copy; the app's connection stays read-only. The original Bloodrush pages stay untouched. Then import EP01 from the copy and browser-test it.

**Then:** the Episode outline in the Story tab (act timeline sized to the episode length, scene list with time budget, shots and characters); "Fit to length" (the Agent expands EP01 from about 6 min to 10/15 min and writes EP02+ scenes and shots from the season story, every prompt through `lintAndFix`); write-back to Notion only on an explicit button (needs a separate connection with insert/update rights).

**Episode-length maths shown to the operator:** 10 min ≈ 120 shots; 15 min ≈ 180. Drafts: CLI about 3 credits/s (1,800 / 2,700); API Seedance 2.0 about $0.135/s; 2.5 about $0.21/s.

## Done (on main)

Board follow-up (operator request): shift-drag box select (`selectionKey="Shift"`), selection bar (Play in order via `domain/board-order.ts`, New group… from the selection, Move to…), double-click a group to rename, selection kept across project updates; a selected connector shows × Unhook and bigger end grips; take counter reads TK n/n · drag beats (one, or a box selection) onto a group in the left panel to move them (cards keep their board place); the layout save now keeps the places of beats in groups not on screen (before, saving one group's layout dropped the others') · V1S-113 takes/pick/reject · 133 UI polish (`--color-nr-*` theme tokens replace the hex in the card, hover player, timeline and player; `controls/Pick.svelte` and `controls/AudioPlayer.svelte` replace every native select and audio player; top bar restyled with tooltips on Library/Runs/Settings/Agent; left panel collapses inward to a "Layers" handle, remembered in localStorage; player transport row and key chips; timeline clips slide into place after a reorder; reduced motion respected) · 114 bench + bin · 115 rewire spine · 116 Narrate name + one nav bar · 117 Agent model providers · 118 drag and drop · 119 Hold · 120 Animate · 121 push to cut + Cuts tab · 124 Finalize to 1080p · 122 edit inside a cut (swap take, drop entry, source info, running length) · 132 owner brief (`server/brief.ts`, `/brief/draft`, rules section in `domain/brief-rules.ts`; quoted must-nots are lint errors via `lintPrompt(…, projectBanned)`) · 131 board groups (`domain/groups.ts`, `server/splitter.ts`, `/split` route; group remembered per project in localStorage) · 130 export (`domain/export.ts` plans + FCPXML; `server/export.ts`; files in files/export/<cut>-v<n>/) · 129 Agent effects pass (Settings → Sound effects folder; Mirelo text-to-audio via CLI for generated effects at 0.25 credits/s, always priced and confirmed first; beat grid is now DP beat tracking) · 128 sound stage (sound plan per locked version; `SoundStage.svelte`; mix render plan in `domain/sound.ts`; effects layer takes manual placement and has a `suggested` flag ready for V1S-129) · 126 match to music (song lane + per-clip waveforms; aligns a take's own audio — works when the song is in the take's audio, e.g. the SFX-plus-SONG renders; Seedance's own generated music doesn't match, so those beat-snap) · 125 lock a cut (versions kept; sound work should reference `{cut_id, version}` of a locked version) · 123 suggest trims (frame-difference detector; on real Blood Rush takes it flags only TR-05 stutter and TR-20's end freeze; the reported stray frame at the V6-12/13 join did not reproduce in the files on the board).

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

127 Raycast bridge test (ready-for-human; needs the operator). Nothing else is open in the Narrate project.

## Notes

- Live provider calls are untested: Hyper (no key here; model ids `deepseek-v4.1-flash` / `glm-5.3-flash` are guesses), the Raycast bridge as a model provider, and real Higgsfield submits.
- Background agents hit the account's weekly usage limit once (resets 2026-10-05); prefer doing tickets inline.
- There is no delete endpoint: a throwaway project is deleted by removing `data/projects/<id>/` after closing it in the browser. `data/projects/01a0fa85…/files/` (the V1S-130 export test, ledger already gone) is left on disk in case the operator is still trying its .fcpxml in Resolve; remove it when done.
- Throwaway test projects go through the API and are deleted afterwards; never mutate the Blood Rush project for tests (undo any test edits).
