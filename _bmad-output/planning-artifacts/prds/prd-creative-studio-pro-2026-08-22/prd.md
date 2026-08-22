---
title: Creative Studio Pro — Product Requirements Document
status: draft
created: 2026-08-21
updated: 2026-08-22
---

# Creative Studio Pro — Product Requirements Document

Version: 0.2.0 (BMAD reconciliation)
Date: 2026-08-22
Owner: Gordo
Status: Draft for BMAD update
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
G2. The first input step is a multi-model creative room reached only through
    the Raycast bridge. Before each initial creative spurt, the bridge harvests
    the models Raycast currently exposes and CSP randomly rotates a varied
    subset, with an operator override. Candidate families include ChatGPT,
    Gemini, Grok, Kimi, DeepSeek V4 Flash, GLM 5.3, the newest available Qwen,
    and Raycast's latest available Claude Haiku. Exact versions are never
    hard-coded or assumed. Each selected voice returns a structured creative
    package: title, logline, summary, image-sequence prompt, 3x3 grid prompt,
    and teaser-trailer prompt.
G3. Source video splitting through the hosted `splitter.serving.cloud` OpenAPI
    service is a first-class canvas lane: submit a job, poll status, retrieve
    the result and assets, show the storyboard grid, and preview each clip.
    CSP owns non-destructive merge/trim metadata. Clip extension is a separate
    gated generation workflow seeded from a segment's final frame; Splitter's
    current v0.2.0 contract does not advertise an extend operation.
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
| splitter-pro2 / `splitter.serving.cloud` | Hosted FastAPI/OpenAPI service for PySceneDetect video jobs, job polling, result manifests, clip/thumbnail assets, and image-grid splitting; CSP ports the storyboard/preview UX onto the canvas | Its standalone UI or a local M3 deployment; CSP consumes the published service contract |
| trailercraft (M3 Mac) | Trailer assembly workflow, trailer-specific pacing/structure steps | React/Vite implementation details; license is absent — conceptual transfer only |
| directors-cut (M3 Mac) | Comparison runs + answers.jsonl schema, concept approval gate, quote→confirm→generate flow, prompt-card library, `--dc-*` dark editorial token baseline | The table-first Projects UI as the primary metaphor (canvas replaces it) |
| raycast-pro-bridge (M3 Mac) | Typed tool contract, Script Commands, multi-model creative-room run schema (`creative_concept_v1` extended with image_sequence_prompt + image_grid_prompt + teaser_trailer_prompt), auth/allowlist/audit | The HTTP server itself — CSP calls it, doesn't absorb it |
| creative-studio-os (Racknerd) | Ops spine: cron digest, Linear roadmap, Discord reach, gates-as-review-blocks | Nothing UI — it coordinates from outside |
| super-seed2 | **Logic backbone (user-stressed):** the mandatory creative-stage pipeline the whole product is modeled on — S0 Intake → S1 Interview → S2 Brief lock → S3 Story spine → S4 Layout pass (mandatory before prompts) → S5 Vibe check (Nano Banana 3x3) → S6 Asset registry → S7 LIRA/plates → S8 Prompt pack → S9 Generate → S10 Assemble, with confidence scoring, hard gates (nothing generated before gates clear), and operator-only force-advance (`pipeline/creative-stages.md`). Also: character-sheet formats, storytelling formats, `pipeline/higgsfield-skills` (LIRA, CINEDANCE, ACTING), and tried-and-true production examples in `projects/` (bloodrush, tiny-parka, china-man, etc.) | Production project trees themselves |

## 6. Users

Primary: Gordo — solo creative director working with AI models as a writers' room
and generation stack. Secondary: agent workers (Hermes profiles, coding agents)
that operate the app via its bridge/API surface on his behalf.

## 7. Core workflows

Every project moves through the super-seed2 stage map (S0–S10, see donor map)
as its mandatory skeleton. The workflows below are how those stages feel in
the product; the stage gates are the law underneath.

### 7.1 Creative Room (ideation)

1. User enters a title and rough brief on the canvas (Seed node).
2. CSP asks the Raycast bridge for the models currently available in Raycast.
   The response is runtime capability data, not a static model catalog.
3. CSP randomly selects a varied subset from the available pool for the initial
   creative spurt. The user can reshuffle, pin, add, or remove voices before
   dispatch. Desired families include ChatGPT, Gemini, Grok, Kimi, DeepSeek,
   GLM, Qwen, and Claude Haiku, but no family or version is guaranteed.
4. User chooses a creative focus (full room / image-grid / teaser /
   logline-summary), and the bridge prepares the canonical brief.
5. Raycast runs the prompt in fresh chats for the selected models.
6. Each answer is captured verbatim with the exact displayed Raycast model
   label and parsed into the structured package. Model Voice cards fan out from
   the Seed.
7. User approves or rejects each package. Approval is the gate to downstream
   generation.

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
2. CSP uploads the video to `POST https://splitter.serving.cloud/api/jobs`
   using the published multipart OpenAPI schema.
3. CSP polls `GET /api/jobs/{job_id}` until the hosted job reaches a terminal
   state, then reads `GET /api/jobs/{job_id}/result` and resolves returned
   clips/thumbnails through `/api/jobs/{job_id}/assets/{asset_path}`.
4. A Storyboard Grid node appears: one still and playable preview per segment,
   numbered and duration-labeled.
5. CSP stores non-destructive trim and merge choices in its own project model.
   When adjacent keyframes look near-identical, it prompts, "These shots may be
   the same shot — keep separate or merge?"
6. EXTEND starts a separate gated generation task anchored to the segment's
   final frame; it is not sent to an undocumented Splitter route.
7. Selected or extended clips become canvas media nodes with provenance.

CSP must generate its client from or validate it against the live OpenAPI
contract at `https://splitter.serving.cloud/openapi.json`; undocumented routes
or a local Splitter process are not assumed. The verified v0.2.0 contract has
no clip-extension route.

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
- RaycastModelCatalogSnapshot (snapshot_id, harvested_at, exact_labels[],
  bridge_version, content_sha256)
- CreativeRoomRun (run_id, catalog_snapshot_id, models_available[],
  models_selected[], selection_mode, selection_seed, operator_overrides[],
  deliverables[], status)
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

- Frontend: **SvelteKit 5 + Svelte 5 runes + Tailwind 4** (user directive:
  this product is Svelte, matching Directors Cut). Canvas via **Svelte Flow**
  (`@xyflow/svelte` — xyflow's native Svelte port of React Flow, same team and
  same node/edge graph model Storyception uses, without pulling in React).
- Deployment and machine boundaries:
  - Phase 0 web app starts on Racknerd; the durable hosting target is the home
    server. Migration timing is an architecture/operations decision, not a
    feature fork.
  - raycast-pro-bridge exists only on the M3 Mac. CSP must route all Raycast
    capability discovery, randomized creative-spurt dispatch, and capture to
    that machine over the approved bridge contract.
  - SwarmUI and ComfyUI exist only on the desktop. CSP treats the desktop as a
    remote generation capability and must report it unavailable when that
    machine is offline; it never silently substitutes another provider.
- Services consumed, not absorbed:
  - raycast-pro-bridge (typed authenticated bridge) — the only route for
    initial creative spurts, live Raycast model harvesting, randomized roster
    selection, dispatch, and verbatim capture. The current bridge still
    hard-codes ChatGPT/Claude defaults, so Phase 1 must add a typed model-catalog
    operation sourced from the M3's live Raycast UI before CSP relies on random
    rotation.
  - `https://splitter.serving.cloud` — hosted FastAPI service; Swagger at
    `/docs`, machine contract at `/openapi.json`, video jobs under `/api/jobs`
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

Phase 1 — Creative Room: M3 bridge model-catalog harvesting, randomized roster
selection with reshuffle/pin overrides, creative-room run creation, Model Voice
cards, verbatim capture, approve/reject. Acceptance: one real run with five
available model voices selected through the Raycast-only route, exact displayed
labels and catalog snapshot persisted, and zero fabricated content. If Raycast
exposes fewer than five eligible voices, use all available voices and show the
shortfall explicitly.

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

## 13. Kickoff decisions

1. **Canvas:** resolved — Svelte Flow (`@xyflow/svelte`), Svelte end to end,
   with no React.
2. **Repository:** resolved — `creative-studio-pro` is the focused product;
   Pindeck remains a standalone asset/intake layer.
3. **Splitter:** resolved — consume `https://splitter.serving.cloud` through
   its live OpenAPI contract; do not run a local Splitter service.
4. **Creative Room models:** resolved — Raycast-bridge-only for initial
   creative spurts. Harvest current availability, randomly rotate a varied
   subset, let Gordo override it, and record exact displayed model labels.
5. **Hosting:** resolved for kickoff — start Phase 0 on Racknerd and target the
   home server for durable hosting.
6. **Machine boundaries:** resolved — Raycast bridge only on the M3; SwarmUI
   and ComfyUI only on the desktop.
