# Creative Studio Pro — Product Requirements Document

Version: 0.1.0 (founding PRD)
Date: 2026-08-21
Owner: Gordo
Status: Draft for agent handoff
Companion document: `docs/UI-UX.md` (the two documents are a set — implement against both)

---

## 1. Vision

One canvas-first creative studio that takes a rough idea all the way to a reviewed,
reusable teaser/trailer asset — without leaving the app.

The product's spine:

    IDEA → CREATIVE ROOM (multi-model) → CANVAS (compare/branch/select)
        → SOURCE SPLIT (scene detect → storyboard → extend clips)
        → ASSEMBLE (teaser/trailer) → GATE (human approval)
        → GENERATE (image/video, gated) → LIBRARY (promoted specs)

Creative Studio Pro is not another tool. It is the front door and the workbench
that blends the user's existing repos into one focused product.

---

## 2. Problem

Today the workflow is fragmented across repos and surfaces:

- Ideation is locked to two models (ChatGPT + Claude) inside Directors Cut's
  `/create` form, producing one narrow 12-second Sora package per answer.
- Storyception proved a canvas/graph environment works beautifully for
  story beats and branching, but it is a separate app.
- Splitter Pro 2 proved scene-detection → storyboard grid → per-clip preview is
  the right way to break source video into extendable clips, but it is a
  separate app.
- TrailerCraft proved trailer-assembly workflow, but it is a separate app.
- Generation is scattered (Raycast Nano Banana, Higgsfield, Sora) with
  inconsistent provenance.
- The creative ops spine (creative-studio-os: cron digest, Linear, Discord)
  exists but has no product surface to point at.

The user opens five tools to do one job. The job is: develop a concept with
many model brains, see it spatially, feed it real footage, and ship a teaser.

## 3. Goals

G1. A single canvas environment is the main UI. All creative state — concepts,
    model answers, story beats, source clips, prompts, generated media — lives
    as nodes on one canvas per project.
G2. The first input step is a multi-model creative room: one brief is sent to
    multiple Raycast model families (default ChatGPT, Claude, Gemini, Grok,
    Kimi; any contrasting model is substitutable), each returning a structured
    creative package: title, logline, summary, image-sequence prompt,
    3x3 grid prompt, teaser-trailer prompt.
G3. Source video splitting (splitter-pro2 pattern) is a first-class canvas
    lane: detect scenes, show the storyboard grid, preview each clip, and
    extend clips (drag edges / extend with generated continuation).
G4. Generation is always behind an explicit human gate with a live quote.
    Raycast/free image generation first, Higgsfield/Sora as paid escalation.
G5. Every artifact carries full provenance: exact model label, prompt hash,
    job id, source brief hash. Nothing fabricated; raw model output is stored
    verbatim.
G6. Winners promote to a reusable spec library (Directors Cut card model).

## 4. Non-goals

- Not a general NLE (no multi-track audio mixing, no color grading suite).
- Not a fork/rebuild of donor repos — their logic is ported, their repos stay
  where they are (creative-studio-os rule: reuse over rebuild).
- No spoofing Raycast Pro as an API; Raycast integration goes through the
  existing bridge contract (Script Commands + localhost HTTP bridge).
- No always-on local LLM. Ideation models are accessed through Raycast.
- No faked model outputs or placeholder content presented as real.

## 5. Donor map (what each repo contributes)

| Donor | What Creative Studio Pro takes | What it does NOT take |
|---|---|---|
| storyception (M3 Mac) | Canvas/graph environment as main UI; beat cards (320x400), branch nodes, reference/character rail above story nodes, 2x2 variant option boards → selected option → 3x3 expansion; dark premium aesthetic, mono micro-labels | Its Gemini/Vertex-specific pipeline, its persistence layer, its archetype catalog verbatim |
| splitter-pro2 (Racknerd) | Scene detection (PySceneDetect, frame-index based), storyboard grid with per-clip still + preview, contact-sheet export, clip extend/split UX, dark minimalist UI | Its standalone deployment; FastAPI backend stays a service, UI patterns port to the canvas |
| trailercraft (M3 Mac) | Trailer assembly workflow, trailer-specific pacing/structure steps | React/Vite implementation details; license is absent — conceptual transfer only |
| directors-cut (M3 Mac) | Comparison runs + answers.jsonl schema, concept approval gate, quote→confirm→generate flow, prompt-card library, `--dc-*` dark editorial token baseline | The table-first Projects UI as the primary metaphor (canvas replaces it) |
| raycast-pro-bridge (M3 Mac) | Typed tool contract, Script Commands, multi-model creative-room run schema (`creative_concept_v1` extended with image_sequence_prompt + image_grid_prompt + teaser_trailer_prompt), auth/allowlist/audit | The HTTP server itself — CSP calls it, doesn't absorb it |
| creative-studio-os (Racknerd) | Ops spine: cron digest, Linear roadmap, Discord reach, gates-as-review-blocks | Nothing UI — it coordinates from outside |
| super-seed2 | Production methodology gates: pitch approval, Nano Banana vibe check, confidence ≥ 80 before video | Production project trees |

## 6. Users

Primary: Gordo — solo creative director working with AI models as a writers' room
and generation stack. Secondary: agent workers (Hermes profiles, coding agents)
that operate the app via its bridge/API surface on his behalf.

## 7. Core workflows

### 7.1 Creative Room (ideation)

1. User enters title + rough brief on the canvas (Seed node).
2. User picks model families (default: ChatGPT, Claude, Gemini, Grok, Kimi)
   and a creative focus (full room / image-grid / teaser / logline-summary).
3. Bridge creates a creative-room run and prepares the canonical brief;
   Raycast runs it in fresh chats per model.
4. Each model answer is captured verbatim with its exact displayed Raycast
   model label, parsed into the structured package, and appears on the canvas
   as a Model Voice card fanned from the Seed.
5. User compares on canvas, approves/rejects per package. Approval is the gate
   to any downstream generation.

Structured package per model answer (`creative_concept_v1`, extended):

    TITLE · LOGLINE · SUMMARY
    IMAGE SEQUENCE PROMPT (still-image board, no timing)
    3X3 GRID PROMPT (one 16:9 image, nine edge-to-edge panels)
    TEASER TRAILER PROMPT — 12 SECONDS (savage-cut cadence, audio arc,
    silence beat, hard title device)

### 7.2 Canvas compare / branch

- Model Voice cards can be branched ("take this logline, re-pitch the teaser
  through model X"), remixed (drag a summary from card A onto card B to create
  a merge task), or parked.
- Selection promotes a card into the Pipeline lane.

### 7.3 Source Split lane

1. User drops source video onto the canvas (Source node).
2. Scene detection runs (PySceneDetect AdaptiveDetector, frame-index cuts,
   env-tunable `SPLITTER_*` thresholds) via the splitter service.
3. A Storyboard Grid node appears: one still + playable preview per segment,
   numbered, duration-labeled.
4. User can re-split (tune thresholds), merge adjacent segments (with the
   "these shots may be the same shot — keep separate or merge?" prompt when
   keyframes look near-identical), trim, and EXTEND a clip: request a
   generated continuation that starts from the clip's final frame.
5. Selected/extended clips become canvas media nodes with provenance.

### 7.4 Assemble teaser

- Approved concept package + selected clips + reference images combine into a
  Trailer node following the teaser-trailer-screenplay contract: runtime,
  cadence, anchor shots from storyboard, director's liberty for interpolated
  shots, flash-frame strobe, title-card mechanics, visual style block.

### 7.5 Gate + generate

- Nothing billable runs without: approved concept + live quote + explicit
  confirm. No automatic provider fallback.
- Image order: Raycast free generation first (Nano Banana 2/3x3 grid) →
  Higgsfield as gated fallback.
- Video order: Sora 2 via handoff or Higgsfield Seedance via CLI quote.
- Results return as versioned artifacts attached to their source node
  (prompt hash must match the approved hash).

### 7.6 Library

- Approved concepts promote to spec cards (Directors Cut schema):
  final prompt text + container settings (12s, 720p/2k, 16:9).
- Library is a canvas-adjacent view, not the primary metaphor.

## 8. Data model (v0.1)

Entities (stable IDs everywhere; never array position or display name):

- Project (canvas root)
- Seed (title, brief, creative_focus, created_by)
- CreativeRoomRun (run_id, models_requested[], deliverables[], status)
- ModelAnswer (answer_id, model_label exact, raw text verbatim, structured
  package, content_sha256, prompt_sha256, structure_status)
- SourceVideo (path, fps, frame count, hash)
- SceneSegment (segment_id, source_id, start_frame, end_frame, keyframe_still,
  preview_clip, detection params snapshot)
- TrailerSpec (concept ref + clip refs + teaser prompt + anchors)
- GenerationJob (provider, model, quote, cost, status, job_id, result_url)
- Artifact (versioned, provenance-stamped, parent node ref)
- SpecCard (promoted library entry)

Storage: local-first. Project = one folder; JSONL for answers/artifacts/prompts
(existing Directors Cut pattern), media as files, index rebuilt on write.
The Ops spine (creative-studio-os) reads status; it does not own this data.

## 9. Technical architecture

- Frontend: SvelteKit 5 + Tailwind 4 (matches Directors Cut), canvas via a
  graph library (React Flow pattern from Storyception — evaluate Svelte
  equivalents; do not port React).
- Local services consumed, not absorbed:
  - raycast-pro-bridge (HTTP, :8787, bearer token) — ideation + capture
  - splitter service (FastAPI + PySceneDetect + ffmpeg) — scene detection
  - generation providers via bridge quote/confirm contract
- Auth/secrets: tokens in `.env.local` / BWS; never in static client code;
  bridge calls from UI go through SvelteKit server routes.
- Bun only for JS. uv for Python services. No npm.
- Provenance: every stored answer/artifact carries hashes and exact labels.

## 10. Security & honesty rules (inherited, non-negotiable)

- No raycast2api, no spoofing Raycast Pro, no arbitrary shell/AppleScript from
  the UI. Tool allowlist on the bridge; audit every call.
- Clipboard is sensitive; redact from logs.
- Generation spend: quote + confirm + no auto-fallback, always.
- Model answers stored verbatim; invalid structure is labeled invalid, never
  silently repaired.
- Model routing: do not use gpt-5.5 for agent work in this project (user
  directive, 2026-08-21).

## 11. Phased delivery

Phase 0 — Foundation: repo scaffold, design tokens (docs/UI-UX.md), canvas
shell with pan/zoom + Seed node + local persistence. Acceptance: create a
project, see it on canvas, reload and it persists.

Phase 1 — Creative Room: bridge integration, model-family picker, creative-room
run creation, Model Voice cards, verbatim capture, approve/reject.
Acceptance: one real run with ≥3 model families captured through Raycast,
zero fabricated content.

Phase 2 — Source Split: splitter service integration, Storyboard Grid node,
preview, merge/trim/extend interactions.
Acceptance: split a real video, extend one clip, provenance recorded.

Phase 3 — Assemble + Gate: Trailer node, quote/confirm generation, versioned
artifact return to canvas.
Acceptance: one gated image generation (Raycast-first) and one gated video
quote round-trip.

Phase 4 — Library + Ops: spec promotion, library view, creative-studio-os
digest reads studio status.
Acceptance: approved concept appears in library; digest references it.

## 12. Success metrics

- Time from rough idea to a canvas with 5 model voices: < 10 minutes.
- Zero fabricated outputs anywhere in the system (audit-verifiable).
- Every generated dollar has a matched human confirm event.
- One app open for the whole loop.

## 13. Open decisions for kickoff

1. Canvas library choice (Svelte-native vs wrapping React Flow) — Phase 0 spike.
2. Repo home: fresh repo vs absorbing into pindeck (front-door candidate).
   Default: fresh repo `creative-studio-pro`, pindeck stays asset layer.
3. Whether splitter service runs on Racknerd (Docker) or M3 Mac local.
   Default: M3 Mac local during Phases 0–2 (footage is local), containerize later.
4. Model family defaults per creative focus (image-grid focus may want
   different families than logline focus).
