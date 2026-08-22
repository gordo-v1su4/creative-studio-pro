---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-creative-studio-pro-2026-08-22/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-creative-studio-pro-2026-08-22/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-creative-studio-pro-2026-08-22/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-creative-studio-pro-2026-08-22/EXPERIENCE.md
  - _bmad-output/planning-artifacts/architecture/architecture-creative-studio-pro-2026-08-22/METHODOLOGY-CONTRACT.md
---

# Creative Studio Pro - Epic Breakdown

## Overview

Complete epic and story breakdown for Creative Studio Pro, derived from final PRD, UX, architecture, and methodology contracts.

## Requirements Inventory

### Functional Requirements

FR-001: Project persistence — CSP shall create and reopen a project as one local-first project folder with stable IDs and reconstructable indexes.

FR-002: Canvas persistence — CSP shall persist node positions, edges, selections, user-authored edits, and lane assignments so reloading restores the same canvas state.

FR-003: Stage state — Every project shall expose the super-seed2 S0–S10 stage, gate status, confidence score, and gate history from one authoritative project state record.

FR-004: Gate enforcement — CSP shall block submit-ready prompts and generation actions until the corresponding super-seed2 gates pass. Only the human operator may force-advance, and every force-advance shall record stage, reason, prior confidence, operator, and timestamp.

FR-005: Live catalog — Before each initial Creative Room run, CSP shall request the model catalog from raycast-pro-bridge on the M3 Mac rather than use a hard-coded provider roster.

FR-006: Catalog snapshot — CSP shall persist the exact displayed Raycast labels, harvest timestamp, bridge version, and catalog hash used by the run.

FR-007: Random rotation — CSP shall use an operator-configurable voice count whose initial default is five, selecting a varied available roster with a persisted random seed. If fewer than the requested count are eligible, it shall select all available voices and show the shortfall.

FR-008: Operator control — Before dispatch, Gordo shall be able to reshuffle, pin, add, or remove models without losing the catalog snapshot.

FR-009: M3-only dispatch — All Raycast model discovery, prompt dispatch, and response capture shall route through the approved M3 bridge contract.

FR-010: Verbatim capture — CSP shall store each raw response unchanged, its exact displayed model label, content hash, prompt hash, parse status, and parse errors. Invalid structure shall remain visible and shall not be silently repaired.

FR-011: Creative package — Each successful voice shall provide title, logline, summary, image-sequence prompt, 3x3-grid prompt, Sora 2 12-second teaser concept, Seedance 2.0 15-second teaser concept, and Seedance 2.5 teaser concept at an approved duration up to 30 seconds.

FR-012: Draft boundary — Before S4, every teaser concept shall display `DRAFT — not for Studio`, and no generation control shall accept it as a submit-ready prompt.

FR-013: Review actions — Gordo shall be able to compare two to four Model Voice cards, inspect raw output, approve, reject with a note, branch, remix, and promote a selected voice into the gated pipeline.

FR-014: Character-sheet trigger — Any image intake shall offer the built-in character-sheet workflow without requiring a separate application.

FR-015: Character-sheet outputs — An approved character-sheet task shall create three identity-consistent, separately generated outputs: 16:9 full-body front with the head removed, full-body back, and high-resolution close-up face. CSP shall never derive the close-up by cropping the wide view. If the selected provider is billable, the task shall require a live quote and matching explicit confirmation. Ad-hoc launch creates or links the task at S6; it does not force-advance the parent project's stage gates.

FR-016: Hosted Splitter client — CSP shall validate against the live `splitter.serving.cloud/openapi.json` contract, upload videos through `POST /api/jobs`, poll job state, retrieve the result, and resolve returned assets through documented routes.

FR-017: Storyboard result — A completed split shall create a Storyboard Grid node containing ordered segment IDs, frame ranges, durations, stills, and playable previews from the returned manifest.

FR-018: Non-destructive edits — CSP shall store trim and merge choices as project metadata without mutating or inventing Splitter service results.

FR-019: Clip extension — EXTEND shall create a separate gated generation task anchored to the selected segment's observed final frame. It shall not call an undocumented Splitter endpoint.

FR-020: Trailer specification — CSP shall assemble an approved concept, selected clips, references, anchors, source methodology commit, target model, runtime, pacing contract, audio arc, and title device into a versioned TrailerSpec.

FR-021: Proven pacing — Teaser specifications shall preserve the selected super-seed2 production-type outline and the successful Directors Cut pacing: hook in the first 2 seconds, accelerating montage, 0.3–0.8-second cuts, 0.2–0.3-second climax flashes, audio-led silence beat, and hard title/CTA.

FR-022: Model-specific compilation — After S4 layout and S5 vibe approval, S8 shall compile the selected concept into the chosen target format: Sora 2 at 12 seconds, explicit Seedance 2.0 at 15 seconds, or Seedance 2.5 strict format at up to 30 seconds.

FR-023: Pilot gate — S8 shall permit one pilot prompt and one pilot generation. Batch generation shall remain blocked until both are approved.

FR-024: Spend confirmation — Every billable generation shall require an approved concept, current live quote, quote expiry display, and explicit human confirmation tied to that quote.

FR-025: No automatic fallback — A failed or unavailable provider shall produce its real error and an explicit operator choice. CSP shall never silently submit to another provider or model.

FR-026: Desktop routing — SwarmUI and ComfyUI jobs shall route only to the desktop. When the desktop is unavailable, those actions shall be disabled and labeled unavailable.

FR-027: Artifact provenance — Every returned artifact shall record its parent node, source brief hash, approved prompt hash, provider, exact model, job ID, quote/confirmation event, cost when reported, target runtime, aspect ratio, and methodology source commit.

FR-028: Prompt-match guard — CSP shall flag an artifact when its submitted prompt hash does not match the approved prompt hash and shall prevent that artifact from being promoted as an approved result.

FR-029: Spec promotion — Gordo shall be able to promote an approved concept or artifact into a reusable SpecCard containing final prompt text, target-specific settings, references, pacing contract, and provenance.

FR-030: Version history — CSP shall retain every artifact and SpecCard version and preserve parent/child lineage rather than overwrite prior accepted work.

FR-031: Operations read model — creative-studio-os shall be able to read project stage, gate, due/stalled state, and approved artifact references without becoming the owner of project data.

FR-032: Capability state — CSP shall expose whether the Racknerd app, home-server target, M3 bridge, desktop generation stack, Splitter service, and configured generation providers are available, degraded, or offline.

### NonFunctional Requirements

NFR-001: Raw model responses, gate events, quotes, confirmations, prompt hashes, and artifact provenance shall be append-only audit records.

NFR-002: No user-facing count, model label, provider status, quote, cost, or generated output may be fabricated or inferred when its source did not return that value.

NFR-003: A project reload shall preserve all committed project, canvas, gate, and provenance state; a rebuildable index may be regenerated, but the canonical records shall not depend on index survival.

NFR-004: Bridge and provider credentials shall remain server-side and outside browser bundles, logs, project artifacts, and Git history.

NFR-005: Raycast access shall use only the approved bridge contract—no Raycast2API, account spoofing, or arbitrary shell/AppleScript input from CSP.

NFR-006: External service calls shall use explicit allowlisted origins, per-service configured connection and operation timeouts, and real error propagation. A timeout shall become an explicit terminal failure state rather than an indefinite spinner; architecture owns the numeric defaults.

NFR-007: CSP shall not broaden a machine or service boundary when a capability is offline; unavailable M3 or desktop features remain unavailable.

NFR-008: The Splitter client shall be generated from or checked against the live OpenAPI schema. CI shall fail when required job/result/asset routes disappear or become incompatible.

NFR-009: Raycast catalog and response contracts shall tolerate models appearing, disappearing, or changing displayed versions without code changes to a static enum.

NFR-010: Every Creative Room run shall be reproducible from its catalog snapshot, selection seed, operator overrides, canonical brief, and prompt hash, subject to the historical models still being available.

NFR-011: Page chrome shall have no horizontal overflow at 375px, 768px, or 1440px; the canvas itself may pan internally.

NFR-012: Interactive controls shall provide default, hover, focus-visible, active, disabled, loading, error, and success states.

NFR-013: Text contrast shall meet 4.5:1, focus indicators shall meet 3:1, and status shall never be communicated by color alone.

NFR-014: Model answers and audit records shall remain keyboard-accessible and readable without requiring canvas pointer gestures.

NFR-015: Reduced-motion mode shall replace decorative canvas and panel animations with instant state changes.

NFR-016: A normal initial creative-spurt run shall reach five returned or explicitly failed Model Voice terminal states within the product success target of 10 minutes; pending voices shall show their real state.

NFR-017: No billable request shall execute without a confirmation event matching the same provider, model, prompt hash, quote amount, and unexpired quote displayed to the operator.

NFR-018: Phase 0 shall pass browser verification at 1440px and 375px and shall prove project/canvas persistence across a real application restart.

### Additional Requirements

- AR-01: Epic 1 Story 1 must scaffold with official `sv create`, TypeScript, adapter-node, Tailwind, Svelte 5, SvelteKit, Svelte Flow, Zod, and Bun lockfile; no React/npm.

- AR-02: Preserve local-first hexagonal modular-monolith direction: routes/UI → application ports → domain; adapters point inward.

- AR-03: One project folder is the aggregate; append-only JSONL is canonical, indexes disposable, canvas layout a separate last-writer-wins document.

- AR-04: Every canonical mutation uses the typed project command gateway with expected version and atomic append.

- AR-05: Zod 4 versioned schemas validate persisted/external records; migrations are explicit and forward-only.

- AR-06: External systems implement typed health/capability/operation ports; health is non-billable and no adapter silently falls back.

- AR-07: Jobs persist inside the owning project, use stable IDs/idempotency/correlation, and rebuild the in-memory queue after restart.

- AR-08: One gate module owns S0–S10, force-advance, character-sheet S6 linkage, and pilot/batch eligibility.

- AR-09: Quote confirmation binds provider, exact model, prompt hash, amount, and expiry; dispatched jobs remain authorized after later expiry.

- AR-10: Accepted media enters one ingest port and persists stable asset ID, object key, canonical byte hash, MIME, and dimensions/duration.

- AR-11: One read-model/index builder serves UI and creative-studio-os; operations never mutate project truth.

- AR-12: Phase 0 is Tailnet-private on Racknerd; runtime/config/store contracts remain portable to the home server.

- AR-13: Default resilience: connect 10s, sync 120s, submit/quote 60s, poll 30s, 3 idempotent-read retries, async deadline 1800s.

- AR-14: Persisted paths are project-relative or object keys; absolute roots/secrets exist only in runtime server config/BWS injection.

- AR-15: Release gates include schema/contract, restart recovery, gate/spend/provenance, adapter fake, and 1440px/375px browser tests.

- AR-16: Offline CI uses the vendored methodology contract; credentialed agents verify private super-seed2 before methodology changes.

### UX Design Requirements

UX-DR01: Implement exact DESIGN.md dark editorial tokens, dynamic voice palette, 2px shapes, typography, spacing, and state colors.

UX-DR02: Build responsive Canvas chrome: top nav, toolbar, lane rail, Svelte Flow canvas, inspector, transport strip.

UX-DR03: Implement selection, Node Focus, persisted drag layout, lineage edges, branch/remix ports, DOM node-list fallback.

UX-DR04: Implement live roster controls for catalog fetch, count, reshuffle, pin, add, remove, and shortfall display.

UX-DR05: Implement Model Voice cards with exact label, immutable raw text, parse state/errors, target tabs, hashes, review actions.

UX-DR06: Implement Compare for 2–4 voices with aligned sections, mobile stack, raw toggle, per-column decisions.

UX-DR07: Implement S0–S10 states: BLOCKED, READY, PASSED, FORCED, DRAFT, PILOT ELIGIBLE, BATCH ELIGIBLE.

UX-DR08: Implement Capability Drawer with available, degraded, offline, planned, not-configured, not-checked states.

UX-DR09: Implement Source node and truthful Splitter lifecycle without invented percentages.

UX-DR10: Implement Storyboard manifest order, preview, keyboard/touch scrub, trim/merge metadata, separate EXTEND task.

UX-DR11: Implement Character Sheet task with three persistent slots and per-slot retry.

UX-DR12: Implement Trailer target tabs for Sora 12s, Seedance 2.0 15s, Seedance 2.5 ≤30s with runtime/syntax/draft state.

UX-DR13: Implement separate quote/confirm controls with provider/model/hash/amount/expiry validation.

UX-DR14: Implement Artifact node, immutable SpecCard versions, lightbox, provenance, prompt-mismatch promotion block.

UX-DR15: Implement Canvas, Library, Runs, Settings, Capability Drawer, Node Focus, Compare, Lightbox, Command Palette surfaces/states.

UX-DR16: Meet WCAG 2.2 AA: contrast, focus, labels, keyboard, aria-live, reduced motion, 44px mobile controls.

UX-DR17: Pass no-overflow checks at 375px, 768px, 1440px; canvas may pan internally.

UX-DR18: Use five promoted HTML mocks as composition references; DESIGN.md/EXPERIENCE.md remain authoritative.

### FR Coverage Map

FR-001: Epic 1 — Project persistence
FR-002: Epic 1 — Canvas persistence
FR-003: Epic 1 — S0–S10 stage state
FR-004: Epic 1 — Gate enforcement
FR-005: Epic 2 — Live Raycast catalog
FR-006: Epic 2 — Catalog snapshot
FR-007: Epic 2 — Random roster rotation
FR-008: Epic 2 — Operator roster control
FR-009: Epic 2 — M3-only dispatch
FR-010: Epic 2 — Verbatim capture
FR-011: Epic 2 — Structured creative package
FR-012: Epic 2 — Draft boundary
FR-013: Epic 2 — Review and compare actions
FR-014: Epic 3 — Character-sheet trigger
FR-015: Epic 3 — Character-sheet outputs
FR-016: Epic 3 — Hosted Splitter client
FR-017: Epic 3 — Storyboard result
FR-018: Epic 3 — Non-destructive edits
FR-019: Epic 3 — Clip extension
FR-020: Epic 4 — Trailer specification
FR-021: Epic 4 — Proven pacing
FR-022: Epic 4 — Model-specific compilation
FR-023: Epic 4 — Pilot gate
FR-024: Epic 4 — Spend confirmation
FR-025: Epic 4 — No automatic fallback
FR-026: Epic 4 — Desktop routing
FR-027: Epic 4 — Artifact provenance
FR-028: Epic 4 — Prompt-match guard
FR-029: Epic 5 — Spec promotion
FR-030: Epic 5 — Version history
FR-031: Epic 5 — Operations read model
FR-032: Epic 5 — Capability state

## Epic List

### Epic 1: Project Canvas & Gated Pipeline
Gordo can create and reopen a durable canvas project, arrange creative state spatially, and operate the authoritative S0–S10 pipeline without bypassing gates.
**FRs covered:** FR-001–FR-004

### Epic 2: Dynamic Creative Room
Gordo can harvest the live M3 Raycast catalog, rotate and control a varied model roster, capture exact responses, compare voices, and select a concept.
**FRs covered:** FR-005–FR-013

### Epic 3: Visual Assets & Source Preparation
Gordo can create reusable character sheets, submit footage to hosted Splitter, review storyboard segments, make non-destructive edits, and start properly gated extension tasks.
**FRs covered:** FR-014–FR-019

### Epic 4: Teaser Assembly & Controlled Generation
Gordo can assemble model-specific teaser specs, preserve proven pacing, pass pilot/spend gates, generate through explicit providers, and receive provenance-verified artifacts.
**FRs covered:** FR-020–FR-028

### Epic 5: Reusable Library & Operations
Gordo can promote and version approved specs, inspect lineage, expose project status to creative operations, and understand real capability availability.
**FRs covered:** FR-029–FR-032

## Epic 1: Project Canvas & Gated Pipeline

Gordo can create and reopen a durable canvas project, arrange creative state spatially, and operate the authoritative S0–S10 pipeline without bypassing gates.

### Story 1.1: Scaffold the Private CSP Workbench

As Gordo,
I want the CSP application shell available privately,
So that I can open the creative workspace across my Tailnet.

**Requirements:** AR-01, AR-02, AR-05, AR-12, UX-DR01, UX-DR02, UX-DR15–18, NFR-004, NFR-011–015, NFR-018

**Acceptance Criteria:**

**Given** the current documentation-only repository
**When** the official SvelteKit scaffold is created
**Then** it uses Bun, TypeScript, Svelte 5, SvelteKit 2, adapter-node, Tailwind 4, Svelte Flow, and Zod 4
**And** Canvas, Library, Runs, and Settings routes render using canonical design tokens; React/npm are absent; 1440px and 375px checks show no page-level overflow.

### Story 1.2: Create and Reopen Durable Projects

As Gordo,
I want projects to survive restarts,
So that my creative state is never temporary.

**Requirements:** FR-001, AR-03–05, AR-07, NFR-001–003

**Acceptance Criteria:**

**Given** no existing project
**When** Gordo creates one
**Then** CSP creates one project folder with UUIDv7 ID, versioned schema, and append-only event ledger
**And** mutations use the command gateway with expected version; restart reconstructs identical canonical state; disposable indexes rebuild without data loss.

### Story 1.3: Arrange and Persist the Canvas

As Gordo,
I want to arrange creative nodes spatially,
So that the canvas reflects my working thought process.

**Requirements:** FR-002, AR-03–04, UX-DR02–03, UX-DR16–18, NFR-003, NFR-011–015, NFR-018

**Acceptance Criteria:**

**Given** an open project
**When** Gordo creates, selects, connects, or moves a Seed node
**Then** Svelte Flow renders the node and lineage correctly
**And** layout persists separately through the gateway, refresh restores positions/edges/viewport/lanes, and keyboard users can access the node-list fallback.

### Story 1.4: Enforce the S0–S10 Gate System

As Gordo,
I want the real production stage and legal next action visible,
So that no agent or provider skips methodology gates.

**Requirements:** FR-003–004, AR-08, AR-16, UX-DR07, NFR-001–002

**Acceptance Criteria:**

**Given** a project at any super-seed2 stage
**When** project events or confidence change
**Then** one domain gate engine derives stage, confidence, gate state, and legal actions
**And** generation remains blocked before gates, only Gordo can force-advance with reason/prior confidence, and character-sheet tasks can link at S6 without advancing the parent project.

## Epic 2: Dynamic Creative Room

Gordo can harvest the live M3 Raycast catalog, rotate and control a varied model roster, capture exact responses, compare voices, and select a concept.

### Story 2.1: Connect to the M3 Raycast Capability

As Gordo,
I want CSP to detect the M3 bridge,
So that Creative Room actions reflect real availability.

**Requirements:** FR-005, FR-009, AR-06, AR-13, UX-DR08, NFR-006–007

**Acceptance Criteria:**

**Given** CSP is running
**When** capability health is checked
**Then** M3 state is available, degraded, or offline
**And** health is non-billable/time-bounded and never triggers fallback.

### Story 2.2: Harvest and Control the Live Model Roster

As Gordo,
I want a varied current roster,
So that each creative spurt gets contrasting voices.

**Requirements:** FR-006–008, UX-DR04, NFR-009–010

**Acceptance Criteria:**

**Given** the M3 bridge is available
**When** CSP fetches the Raycast catalog
**Then** it persists exact labels, timestamp, bridge version, and catalog hash
**And** it selects the configurable default count with a persisted seed and supports reshuffle, pin, add, remove, and shortfall display.

### Story 2.3: Dispatch Durable Per-Voice Jobs

As Gordo,
I want each voice independently tracked,
So that failures never erase successful responses.

**Requirements:** FR-009, AR-07, AR-13, NFR-006, NFR-010

**Acceptance Criteria:**

**Given** an approved roster and brief
**When** the Creative Room runs
**Then** CSP creates one idempotent project-owned job per exact label
**And** restart reconciles without duplicate dispatch and every voice ends returned, failed, or cancelled truthfully.

### Story 2.4: Capture Verbatim Creative Packages

As Gordo,
I want exact model output preserved,
So that every idea remains auditable.

**Requirements:** FR-010–012, AR-04–05, UX-DR05, UX-DR12, NFR-001–002

**Acceptance Criteria:**

**Given** a Raycast response arrives
**When** CSP captures and parses it
**Then** raw text, exact label, hashes, parse state, and errors are stored
**And** valid packages expose all prompt variants as pre-S4 drafts and invalid packages are never silently repaired.

### Story 2.5: Compare and Select Model Voices

As Gordo,
I want aligned comparison and review tools,
So that I can choose the strongest direction.

**Requirements:** FR-013, UX-DR06, UX-DR16–17, NFR-011–016

**Acceptance Criteria:**

**Given** two to four voices are captured
**When** Compare opens
**Then** equivalent sections and target variants align
**And** raw text is inspectable; approve, reject-with-note, branch, remix, and promote work; mobile stacks without overflow.

## Epic 3: Visual Assets & Source Preparation

Gordo can create reusable character sheets, submit footage to hosted Splitter, review storyboard segments, make non-destructive edits, and start properly gated extension tasks.

### Story 3.1: Start a Character-Sheet Task from Image Intake

As Gordo,
I want any image intake to offer the character workflow,
So that identity preparation stays inside CSP.

**Requirements:** FR-014, AR-08, UX-DR11

**Acceptance Criteria:**

**Given** an image is added at any project stage
**When** Gordo accepts the character-sheet offer
**Then** CSP creates or links one task at S6 with three persistent slots
**And** the parent project stage is unchanged and the task records source asset identity/provenance.

### Story 3.2: Generate and Approve the Three Character Views

As Gordo,
I want separate front, back, and close-up outputs,
So that I get a reusable high-quality identity set.

**Requirements:** FR-015, AR-09–10, UX-DR11, UX-DR13–14, NFR-017

**Acceptance Criteria:**

**Given** a character-sheet task and provider are selected
**When** a live billable quote is confirmed and generation runs
**Then** front head-removed, back, and close-up are separate identity-consistent artifacts
**And** successful slots persist, failed slots retry independently, and the close-up is never cropped from the wide view.

### Story 3.3: Submit and Resume Hosted Splitter Jobs

As Gordo,
I want source footage processed by the hosted Splitter service,
So that I can leave and return without losing work.

**Requirements:** FR-016, AR-06–07, AR-13, NFR-006, NFR-008

**Acceptance Criteria:**

**Given** a source video is attached
**When** CSP submits through the documented OpenAPI job route
**Then** the project stores job/idempotency/correlation state and polls documented status/result/assets routes
**And** restart resumes reconciliation, timeout becomes terminal failure, and no undocumented route is called.

### Story 3.4: Review Storyboard Segments and Edit Non-Destructively

As Gordo,
I want a truthful storyboard grid with preview, trim, and merge choices,
So that I can prepare usable shots without altering source results.

**Requirements:** FR-017–018, UX-DR09–10, UX-DR16, NFR-002

**Acceptance Criteria:**

**Given** a Splitter result manifest is complete
**When** the Storyboard Grid opens
**Then** segments preserve manifest order, frames, durations, stills, clips, and provenance
**And** keyboard/touch scrub works and trim/merge choices persist only as CSP metadata.

### Story 3.5: Create a Gated Clip-Extension Task

As Gordo,
I want EXTEND to start from a segment’s observed final frame,
So that continuation generation is honest and controllable.

**Requirements:** FR-019, AR-06–10, UX-DR10, UX-DR13, NFR-006–007, NFR-017

**Acceptance Criteria:**

**Given** a segment is selected
**When** Gordo chooses EXTEND
**Then** CSP creates a separate project-owned generation job with final-frame asset and lineage
**And** it obeys gate, quote, confirmation, provider availability, idempotency, and never claims Splitter extended the clip.

## Epic 4: Teaser Assembly & Controlled Generation

Gordo can assemble model-specific teaser specs, preserve proven pacing, pass pilot/spend gates, generate through explicit providers, and receive provenance-verified artifacts.

### Story 4.1: Assemble a Versioned Trailer Specification

As Gordo,
I want approved concepts, clips, references, and anchors assembled,
So that the teaser has one auditable creative contract.

**Requirements:** FR-020–021, AR-08, AR-16, UX-DR12, NFR-001–002

**Acceptance Criteria:**

**Given** an approved concept and selected assets exist
**When** Gordo creates a Trailer node
**Then** CSP stores a versioned TrailerSpec with methodology commit, target, runtime, pacing, audio arc, title device, references, and hashes
**And** the proven hook/montage/flash/silence/title pacing remains explicit and source lineage resolves.

### Story 4.2: Compile the Selected Model-Specific Prompt

As Gordo,
I want a submit-ready prompt for the chosen video model,
So that each target receives correct duration and syntax.

**Requirements:** FR-022, AR-08, AR-16, UX-DR07, UX-DR12

**Acceptance Criteria:**

**Given** S4 layout and S5 vibe gates have passed
**When** S8 compiles a selected draft
**Then** CSP produces Sora 2 at 12s, explicit Seedance 2.0 at 15s, or Seedance 2.5 strict format up to 30s
**And** draft labels clear only for that compiled version and all prompt/reference hashes are recorded.

### Story 4.3: Run and Approve One Pilot Before Batch

As Gordo,
I want one pilot prompt and generation evaluated first,
So that batch spend happens only after evidence.

**Requirements:** FR-023, AR-07–09, UX-DR07, UX-DR13, NFR-017

**Acceptance Criteria:**

**Given** an S8 prompt is approved
**When** Gordo generates a pilot
**Then** only one pilot job is eligible and batch controls remain blocked
**And** pilot artifact review records approve/reject and batch eligibility appears only after both prompt and generation approval.

### Story 4.4: Authorize Spend with Quote and Confirmation

As Gordo,
I want every billable request bound to a live quote,
So that CSP never spends against changed terms.

**Requirements:** FR-024–025, AR-09, AR-13, UX-DR13, NFR-006–007, NFR-017

**Acceptance Criteria:**

**Given** an eligible prompt/provider is selected
**When** Gordo requests and confirms a quote
**Then** confirmation binds provider, exact model, prompt hash, amount/credits, and expiry
**And** expired/mismatched quotes cannot dispatch, dispatched jobs remain authorized through completion, and no automatic fallback occurs.

### Story 4.5: Route Generation Through Explicit Capabilities

As Gordo,
I want provider and machine routing visible,
So that I control where generation runs.

**Requirements:** FR-025–026, AR-06, UX-DR08, UX-DR15, NFR-006–007

**Acceptance Criteria:**

**Given** a generation action is eligible
**When** CSP evaluates capability state
**Then** desktop-only SwarmUI/ComfyUI routes only to the desktop and other providers use their explicit adapter
**And** offline/degraded actions disable with real errors and require an operator choice rather than substitution.

### Story 4.6: Ingest and Verify Generated Artifacts

As Gordo,
I want results ingested with complete provenance,
So that only trustworthy media becomes approved work.

**Requirements:** FR-027–028, AR-09–10, UX-DR14, NFR-001–003

**Acceptance Criteria:**

**Given** a provider returns a result
**When** the media-store ingest port accepts it
**Then** CSP computes canonical hash, stores stable asset identity/object key/media metadata, and links job/quote/confirmation/source/methodology
**And** prompt-hash mismatch blocks promotion and versions never overwrite earlier artifacts.

## Epic 5: Reusable Library & Operations

Gordo can promote and version approved specs, inspect lineage, expose project status to creative operations, and understand real capability availability.

### Story 5.1: Promote Approved Work into the Spec Library

As Gordo,
I want approved concepts and artifacts promoted,
So that successful creative patterns become reusable.

**Requirements:** FR-029, UX-DR14–15, NFR-001–002

**Acceptance Criteria:**

**Given** an artifact or concept is approved and provenance-valid
**When** Gordo selects Promote
**Then** CSP creates an immutable SpecCard with final prompt, target settings, references, pacing, source IDs, and hashes
**And** unapproved or mismatched artifacts are rejected and the Library empty/loading/error states remain truthful.

### Story 5.2: Derive New Versions Without Losing History

As Gordo,
I want new spec and artifact versions linked to their parents,
So that experimentation never destroys accepted work.

**Requirements:** FR-030, AR-10, UX-DR14, NFR-001–003

**Acceptance Criteria:**

**Given** a SpecCard or Artifact exists
**When** Gordo derives a new version
**Then** CSP creates a new stable ID and parent/child lineage while preserving all prior versions
**And** the lightbox/version selector exposes provenance and no update overwrites immutable history.

### Story 5.3: Expose a Read-Only Operations Projection

As Gordo,
I want creative-studio-os to read honest project status,
So that digests and planning can reference work without owning it.

**Requirements:** FR-031, AR-11, NFR-001–003

**Acceptance Criteria:**

**Given** projects contain canonical events
**When** the operations projection is requested
**Then** one project-store read-model builder returns versioned stage, gate, due/stalled, and approved artifact references
**And** UI and operations share definitions and Linear/Discord/digest integrations cannot mutate project truth.

### Story 5.4: Inspect Real Capability Availability

As Gordo,
I want one capability view for hosts, machines, services, and providers,
So that I know what can run before acting.

**Requirements:** FR-032, AR-06, AR-13, UX-DR08, UX-DR15, NFR-002, NFR-006–007

**Acceptance Criteria:**

**Given** CSP opens or refreshes Settings/Capability Drawer
**When** non-billable health/capability checks complete
**Then** each capability reports available, degraded, offline, planned, not-configured, or not-checked with last real check
**And** affected actions disable without losing existing work and no status, quote, progress, or fallback is fabricated.

