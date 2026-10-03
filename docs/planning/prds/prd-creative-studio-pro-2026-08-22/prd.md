---
title: Creative Studio Pro — Product Requirements Document
status: final
created: 2026-08-21
updated: 2026-08-22
---

# Creative Studio Pro — Product Requirements Document

Version: 1.0.0 (planning final)
Date: 2026-08-22
Owner: Gordo
Status: Final — UX and architecture spines finalized; implementation in repo
Companion UX contracts:
`../ux-designs/ux-creative-studio-pro-2026-08-22/DESIGN.md` and
`../ux-designs/ux-creative-studio-pro-2026-08-22/EXPERIENCE.md` — canonical
visual and behavioral spines; they govern implementation.

---

## 1. Vision

One canvas-first creative studio that takes a rough idea all the way to a
reviewed, reusable trailer, cold open, or first short episode without leaving
the app.

The product's spine:

    IDEA → CREATIVE ROOM (multi-model) → CANVAS (compare/branch/select)
        → SOURCE SPLIT (scene detect → storyboard → extend clips)
        → ASSEMBLE (trailer / cold open / short episode) → GATE
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
    plus parallel teaser prompt variants for Sora 2 (12s), Seedance 2.0 (15s),
    and Seedance 2.5 (up to 30s). Before S4 these are concept drafts marked
    `DRAFT — not for Studio`, not generation-ready prompts.
G3. Source video splitting through the hosted `the hosted Splitter service` OpenAPI
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
| splitter-pro2 / `the hosted Splitter service` | Hosted FastAPI/OpenAPI service for PySceneDetect video jobs, job polling, result manifests, clip/thumbnail assets, and image-grid splitting; CSP ports the storyboard/preview UX onto the canvas | Its standalone UI or a local M3 deployment; CSP consumes the published service contract |
| trailercraft (M3 Mac) | Trailer assembly workflow, trailer-specific pacing/structure steps | React/Vite implementation details; license is absent — conceptual transfer only |
| directors-cut (M3 Mac) | Comparison runs + answers.jsonl schema, concept approval gate, quote→confirm→generate flow, prompt-card library, `--dc-*` dark editorial token baseline | The table-first Projects UI as the primary metaphor (canvas replaces it) |
| raycast-pro-bridge (M3 Mac) | Typed tool contract, Script Commands, multi-model creative-room run schema (`creative_concept_v1` extended with image_sequence_prompt + image_grid_prompt + teaser_trailer_prompt), auth/allowlist/audit | The HTTP server itself — CSP calls it, doesn't absorb it |
| creative-studio-os (Phase 0 deployment host) | Ops spine: cron digest, Linear roadmap, Discord reach, gates-as-review-blocks | Nothing UI — it coordinates from outside |
| [`gordo-v1su4/super-seed2`](https://github.com/gordo-v1su4/super-seed2) | **Authoritative production methodology, not an optional donor:** `AGENTS.md`; mandatory S0–S10 gates and confidence math in `pipeline/creative-stages.md`; teaser/commercial story shape in `pipeline/production-types/commercial.md`; Seedance 2.5 strict prompt format; LIRA/CINEDANCE/ACTING skills; and proven project pacing/examples. Agents must inspect the live repository before changing story, prompt, or generation requirements. Baseline reviewed: `84f61f1`. | Production project media itself; CSP references the methodology and service contracts rather than copying active project trees |

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
    SORA 2 TEASER CONCEPT — 12 SECONDS
    SEEDANCE 2.0 TEASER CONCEPT — 15 SECONDS
    SEEDANCE 2.5 TEASER CONCEPT — UP TO 30 SECONDS

All three teaser variants express the same concept at model-appropriate duration
and syntax. They inherit the proven super-seed2 commercial/teaser outline:
hook in the first 2 seconds, montage middle accelerating toward the drop, and a
readable title/CTA ending. They also preserve the successful Directors Cut
savage-cut language: fast 0.3–0.8-second cuts, 0.2–0.3-second climax flashes,
audio driving the edit, a dead-silence beat, and a hard title slam.

- **Sora 2 / 12s:** compact savage-cut trailer prompt; connective shots remain
  the model's director's liberty.
- **Seedance 2.0 / 15s:** compress the same causal arc into one 15-second clip;
  use the explicit 2.0 workflow and never silently apply 2.5-only syntax.
- **Seedance 2.5 / ≤30s:** use the strict four-block format — asset roles,
  one-sentence summary, consecutive timeline/shot plan, and continuity plus
  exclusions. For a 30-second arc, follow the 0–6 / 6–12 / 12–18 / 18–25 /
  25–30 state-change map; shorter jobs compress it proportionally.

Before S4 these are idea-room drafts labeled `DRAFT — not for Studio`. After S4
layout and S5 vibe approval, S8 recompiles the selected concept into a
submit-ready prompt and requires one approved pilot generation before batch.

### 7.2 Canvas compare / branch

- Model Voice cards can be branched ("take this logline, re-pitch the teaser
  through model X"), remixed (drag a summary from card A onto card B to create
  a merge task), or parked.
- Selection promotes a card into the Pipeline lane.

### 7.3 Source Split lane

1. User drops source video onto the canvas (Source node).
2. CSP uploads the video with `POST /api/jobs` on the hosted Splitter service
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
contract at `the Splitter OpenAPI document (from `CSP_SPLITTER_URL`)`; undocumented routes
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

- Approved concepts promote to spec cards (Directors Cut schema): final prompt
  text plus target-specific container settings — Sora 2 at 12s, Seedance 2.0
  at 15s, or Seedance 2.5 at the approved duration up to 30s — with resolution,
  aspect ratio, mode, references, and pacing contract preserved.
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
- TrailerSpec (concept ref, clip refs, anchors, methodology source commit,
  pacing contract, and target variants: sora_2_12s, seedance_2_0_15s,
  seedance_2_5_up_to_30s)
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
  - Phase 0 web app starts on Phase 0 deployment host; the durable hosting target is the home
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
  - `the hosted Splitter service (`CSP_SPLITTER_URL`)` — hosted FastAPI service; Swagger at
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
3. **Splitter:** resolved — consume `the hosted Splitter service (`CSP_SPLITTER_URL`)` through
   its live OpenAPI contract; do not run a local Splitter service.
4. **Creative Room models:** resolved — Raycast-bridge-only for initial
   creative spurts. Harvest current availability, randomly rotate a varied
   subset, let Gordo override it, and record exact displayed model labels.
5. **Hosting:** resolved for kickoff — start Phase 0 on Phase 0 deployment host and target the
   home server for durable hosting.
6. **Machine boundaries:** resolved — Raycast bridge only on the M3; SwarmUI
   and ComfyUI only on the desktop.

## 14. Functional requirements

### Project, canvas, and stage control

- **FR-001 — Project persistence:** CSP shall create and reopen a project as one
  local-first project folder with stable IDs and reconstructable indexes.
- **FR-002 — Canvas persistence:** CSP shall persist node positions, edges,
  selections, user-authored edits, and lane assignments so reloading restores
  the same canvas state.
- **FR-003 — Stage state:** Every project shall expose the super-seed2 S0–S10
  stage, gate status, confidence score, and gate history from one authoritative
  project state record.
- **FR-004 — Gate enforcement:** CSP shall block submit-ready prompts and
  generation actions until the corresponding super-seed2 gates pass. Only the
  human operator may force-advance, and every force-advance shall record stage,
  reason, prior confidence, operator, and timestamp.

### Creative Room and Raycast roster

- **FR-005 — Live catalog:** Before each initial Creative Room run, CSP shall
  request the model catalog from raycast-pro-bridge on the M3 Mac rather than
  use a hard-coded provider roster.
- **FR-006 — Catalog snapshot:** CSP shall persist the exact displayed Raycast
  labels, harvest timestamp, bridge version, and catalog hash used by the run.
- **FR-007 — Random rotation:** CSP shall use an operator-configurable voice
  count whose initial default is five, selecting a varied available roster with
  a persisted random seed. If fewer than the requested count are eligible, it
  shall select all available voices and show the shortfall.
- **FR-008 — Operator control:** Before dispatch, Gordo shall be able to
  reshuffle, pin, add, or remove models without losing the catalog snapshot.
- **FR-009 — M3-only dispatch:** All Raycast model discovery, prompt dispatch,
  and response capture shall route through the approved M3 bridge contract.
- **FR-010 — Verbatim capture:** CSP shall store each raw response unchanged,
  its exact displayed model label, content hash, prompt hash, parse status, and
  parse errors. Invalid structure shall remain visible and shall not be
  silently repaired.
- **FR-011 — Creative package:** Each successful voice shall provide title,
  logline, summary, image-sequence prompt, 3x3-grid prompt, Sora 2 12-second
  teaser concept, Seedance 2.0 15-second teaser concept, and Seedance 2.5 teaser
  concept at an approved duration up to 30 seconds.
- **FR-012 — Draft boundary:** Before S4, every teaser concept shall display
  `DRAFT — not for Studio`, and no generation control shall accept it as a
  submit-ready prompt.
- **FR-013 — Review actions:** Gordo shall be able to compare two to four Model
  Voice cards, inspect raw output, approve, reject with a note, branch, remix,
  and promote a selected voice into the gated pipeline.

### Character-sheet system

- **FR-014 — Character-sheet trigger:** Any image intake shall offer the
  built-in character-sheet workflow without requiring a separate application.
- **FR-015 — Character-sheet outputs:** An approved character-sheet task shall
  create three identity-consistent, separately generated outputs: 16:9
  full-body front with the head removed, full-body back, and high-resolution
  close-up face. CSP shall never derive the close-up by cropping the wide view.
  If the selected provider is billable, the task shall require a live quote and
  matching explicit confirmation. Ad-hoc launch creates or links the task at S6;
  it does not force-advance the parent project's stage gates.

### Source Split lane

- **FR-016 — Hosted Splitter client:** CSP shall validate against the live
  `the Splitter OpenAPI document (from `CSP_SPLITTER_URL`)` contract, upload videos through
  `POST /api/jobs`, poll job state, retrieve the result, and resolve returned
  assets through documented routes.
- **FR-017 — Storyboard result:** A completed split shall create a Storyboard
  Grid node containing ordered segment IDs, frame ranges, durations, stills,
  and playable previews from the returned manifest.
- **FR-018 — Non-destructive edits:** CSP shall store trim and merge choices as
  project metadata without mutating or inventing Splitter service results.
- **FR-019 — Clip extension:** EXTEND shall create a separate gated generation
  task anchored to the selected segment's observed final frame. It shall not
  call an undocumented Splitter endpoint.

### Teaser assembly and generation

- **FR-020 — Trailer specification:** CSP shall assemble an approved concept,
  selected clips, references, anchors, source methodology commit, target model,
  runtime, pacing contract, audio arc, and title device into a versioned
  TrailerSpec.
- **FR-021 — Proven pacing:** Teaser specifications shall preserve the selected
  super-seed2 production-type outline and the successful Directors Cut pacing:
  hook in the first 2 seconds, accelerating montage, 0.3–0.8-second cuts,
  0.2–0.3-second climax flashes, audio-led silence beat, and hard title/CTA.
- **FR-022 — Model-specific compilation:** After S4 layout and S5 vibe approval,
  S8 shall compile the selected concept into the chosen target format: Sora 2
  at 12 seconds, explicit Seedance 2.0 at 15 seconds, or Seedance 2.5 strict
  format at up to 30 seconds.
- **FR-023 — Pilot gate:** S8 shall permit one pilot prompt and one pilot
  generation. Batch generation shall remain blocked until both are approved.
- **FR-024 — Spend confirmation:** Every billable generation shall require an
  approved concept, current live quote, quote expiry display, and explicit
  human confirmation tied to that quote.
- **FR-025 — No automatic fallback:** A failed or unavailable provider shall
  produce its real error and an explicit operator choice. CSP shall never
  silently submit to another provider or model.
- **FR-026 — Desktop routing:** SwarmUI and ComfyUI jobs shall route only to the
  desktop. When the desktop is unavailable, those actions shall be disabled
  and labeled unavailable.
- **FR-027 — Artifact provenance:** Every returned artifact shall record its
  parent node, source brief hash, approved prompt hash, provider, exact model,
  job ID, quote/confirmation event, cost when reported, target runtime, aspect
  ratio, and methodology source commit.
- **FR-028 — Prompt-match guard:** CSP shall flag an artifact when its submitted
  prompt hash does not match the approved prompt hash and shall prevent that
  artifact from being promoted as an approved result.

### Library and operations

- **FR-029 — Spec promotion:** Gordo shall be able to promote an approved
  concept or artifact into a reusable SpecCard containing final prompt text,
  target-specific settings, references, pacing contract, and provenance.
- **FR-030 — Version history:** CSP shall retain every artifact and SpecCard
  version and preserve parent/child lineage rather than overwrite prior
  accepted work.
- **FR-031 — Operations read model:** creative-studio-os shall be able to read
  project stage, gate, due/stalled state, and approved artifact references
  without becoming the owner of project data.
- **FR-032 — Capability state:** CSP shall expose whether the Phase 0 deployment host app,
  home-server target, M3 bridge, desktop generation stack, Splitter service,
  and configured generation providers are available, degraded, or offline.

## 15. Nonfunctional requirements

### Integrity and auditability

- **NFR-001:** Raw model responses, gate events, quotes, confirmations, prompt
  hashes, and artifact provenance shall be append-only audit records.
- **NFR-002:** No user-facing count, model label, provider status, quote, cost,
  or generated output may be fabricated or inferred when its source did not
  return that value.
- **NFR-003:** A project reload shall preserve all committed project, canvas,
  gate, and provenance state; a rebuildable index may be regenerated, but the
  canonical records shall not depend on index survival.

### Security and service boundaries

- **NFR-004:** Bridge and provider credentials shall remain server-side and
  outside browser bundles, logs, project artifacts, and Git history.
- **NFR-005:** Raycast access shall use only the approved bridge contract—no
  Raycast2API, account spoofing, or arbitrary shell/AppleScript input from CSP.
- **NFR-006:** External service calls shall use explicit allowlisted origins,
  per-service configured connection and operation timeouts, and real error
  propagation. A timeout shall become an explicit terminal failure state rather
  than an indefinite spinner; architecture owns the numeric defaults.
- **NFR-007:** CSP shall not broaden a machine or service boundary when a
  capability is offline; unavailable M3 or desktop features remain unavailable.

### Contract compatibility

- **NFR-008:** The Splitter client shall be generated from or checked against
  the live OpenAPI schema. CI shall fail when required job/result/asset routes
  disappear or become incompatible.
- **NFR-009:** Raycast catalog and response contracts shall tolerate models
  appearing, disappearing, or changing displayed versions without code changes
  to a static enum.
- **NFR-010:** Every Creative Room run shall be reproducible from its catalog
  snapshot, selection seed, operator overrides, canonical brief, and prompt
  hash, subject to the historical models still being available.

### UX, accessibility, and responsiveness

- **NFR-011:** Page chrome shall have no horizontal overflow at 375px, 768px,
  or 1440px; the canvas itself may pan internally.
- **NFR-012:** Interactive controls shall provide default, hover,
  focus-visible, active, disabled, loading, error, and success states.
- **NFR-013:** Text contrast shall meet 4.5:1, focus indicators shall meet 3:1,
  and status shall never be communicated by color alone.
- **NFR-014:** Model answers and audit records shall remain keyboard-accessible
  and readable without requiring canvas pointer gestures.
- **NFR-015:** Reduced-motion mode shall replace decorative canvas and panel
  animations with instant state changes.

### Product performance and spend safety

- **NFR-016:** A normal initial creative-spurt run shall reach five returned or
  explicitly failed Model Voice terminal states within the product success
  target of 10 minutes; pending voices shall show their real state.
- **NFR-017:** No billable request shall execute without a confirmation event
  matching the same provider, model, prompt hash, quote amount, and unexpired
  quote displayed to the operator.
- **NFR-018:** Phase 0 shall pass browser verification at 1440px and 375px and
  shall prove project/canvas persistence across a real application restart.

## 16. Counter-metrics

The product is failing even if output volume rises when any of these occur:

- Any fabricated model output, label, status, count, quote, or cost.
- Any billable generation without a matching human confirmation.
- Any silent model/provider substitution.
- Any submit-ready prompt or video generation that bypasses its super-seed2
  stage gate.
- Any loss of accepted project or provenance state after restart.
- Any Creative Room run whose selected roster cannot be explained from its
  persisted catalog snapshot and selection record.

## 17. Glossary

- **Creative spurt:** Initial Raycast-only ideation run that returns several
  contrasting Model Voice packages.
- **Model Voice:** One model's exact captured response and parsed creative
  package, always paired with its raw text and displayed Raycast label.
- **Catalog snapshot:** Immutable record of the models Raycast exposed when a
  Creative Room run was created.
- **Gate:** Human or confidence-controlled transition in the authoritative
  super-seed2 S0–S10 pipeline.
- **Draft concept prompt:** Pre-S4 teaser language for ideation only, visibly
  marked `DRAFT — not for Studio`.
- **Submit-ready prompt:** Model-specific prompt compiled after required gates
  and eligible for the S8 pilot.
- **TrailerSpec:** Versioned contract joining concept, anchors, references,
  target model/runtime, pacing, provenance, and generation settings.
- **SpecCard:** Promoted reusable creative specification derived from an
  approved concept or artifact.
