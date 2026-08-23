---
title: Creative Room provider course correction
type: sprint-change-proposal
status: approved
created: 2026-08-22
approved_by: Gordo
approval_condition: Kimi is the temporary default; retain Raycast as an explicit optional provider
scope: Epic 2 and provider-facing language in Epics 3-5
---

# Sprint Change Proposal — Temporary Kimi Creative Room Provider

## 1. Issue Summary

The Windows Raycast integration is persistent and technically proven, but its native GUI handoff is too slow and fragile to serve as the primary implementation path for completing Creative Studio Pro. Exact model selection requires operator-visible UI steps, and small navigation failures consume disproportionate time without advancing the project canvas, media organization, generation gates, or later BMAD epics.

Gordo directed CSP to use the existing Kimi API credits temporarily for LLM and Creative Room work so development can proceed end to end. Raycast is retained as an optional provider and its completed persistence/provenance work is not rolled back.

Evidence:

- Windows Raycast exact-label capture and restart recovery are proven, including a complete two-voice Bloodrush run.
- The GUI portion is not deterministic enough for unattended throughput on this PC.
- Epics 3-5 depend on Creative Room outputs and provider contracts, not specifically on Raycast GUI operation.
- The current PRD, architecture, UX, and Epic 2 wording incorrectly make M3/Raycast the only Creative Room provider.

## 2. Impact Analysis

### Epic impact

- **Epic 1:** no behavioral change. Project persistence, gates, layouts, and restart recovery remain authoritative.
- **Epic 2:** moderate revision. Replace Raycast-only roster/dispatch wording with an explicit Creative Room provider capability. Kimi is the temporary selected default; Raycast remains selectable when available.
- **Epic 3:** no scope reset. Splitter and character-sheet work remain provider-adapter operations with the same spend and media rules.
- **Epic 4:** no scope reset. Trailer prompt compilation and generation remain gated and provider-explicit. This change does not authorize video generation.
- **Epic 5:** capability UI must show Kimi and Raycast independently and must never imply automatic fallback.

### Artifact impact

- **PRD:** revise Goals, Non-goals, Creative Room workflow, FR-005..FR-010, Phase 1 acceptance, kickoff decisions, and provider glossary.
- **Architecture:** generalize AD-5/AD-10 and the capability map from a Raycast adapter to a Creative Room provider port with Kimi and Raycast adapters.
- **UX:** replace M3-only enablement and copy with explicit provider selection, independent health states, and exact provider/model provenance.
- **Windows Raycast specs/skill:** retain as completed optional-provider operations. Mark the automation spec superseded as the primary path, not deleted.
- **Tests:** add provider-selection, Kimi contract, secret-redaction, durable result, restart, and no-silent-fallback coverage while preserving Raycast and macOS regression tests.

### Technical impact

Introduce a typed `CreativeRoomProvider` capability boundary with:

- non-billable `health` and `catalog` operations;
- exact provider and model identifiers in every catalog snapshot and answer;
- durable, idempotent run/result persistence;
- explicit operator/config selection;
- no automatic provider substitution;
- server-only credentials and redacted logs;
- Kimi OpenAI-compatible chat completion mapping;
- retained Raycast bridge mapping and exact-label capture.

## 3. Recommended Path

**Direct adjustment.** This is a moderate provider-boundary correction, not a rollback or MVP reset.

Why:

- It preserves all completed Raycast, project-store, gate, provenance, and restart work.
- It unlocks the rest of the roadmap without coupling delivery speed to a native GUI.
- It keeps the architecture honest: Creative Room is a capability with explicit providers, not a Raycast-shaped domain concept.
- It is reversible. Switching the selected provider back to Raycast changes configuration/selection, not project data or domain rules.

Estimated risk is medium-low. The main risks are secret handling, response-shape drift, and accidentally treating Kimi as a silent fallback; all are covered by explicit adapter contracts and tests.

## 4. Detailed Change Set

### Product requirements

**Old:** CSP checks M3, fetches a Raycast catalog, and runs the room only through Raycast.

**New:** CSP checks independently configured Creative Room providers. The operator selects one available provider. The selected provider returns an exact catalog and executes the run. Kimi is the temporary default in this deployment. Raycast remains optional. CSP never switches providers automatically.

**Old:** Model voice cards expose an exact Raycast label.

**New:** Model voice cards expose exact provider, model label/ID, raw response, parse state, content hash, and run/catalog provenance.

### Architecture

**Old:** `raycast adapter + jobs + voice UI` owns FR-005..013.

**New:** `creative-room provider port + Kimi/Raycast adapters + jobs + voice UI` owns FR-005..013.

The existing append-only project aggregate and one-job-per-voice idempotency rule remain unchanged. Provider results must survive restart before UI reconciliation; in-memory-only success is not acceptable.

### UX

The Seed node and Capability Drawer gain explicit Creative Room provider state. Unavailable providers remain visible with factual errors. Existing captured Raycast voices remain readable when Kimi is selected, and vice versa. Run actions name the selected provider. No provider logos or friendly aliases replace exact provenance.

### Delivery sequence

1. Revise the PRD/architecture/UX/Epic 2 wording and mark the Raycast automation spec as optional-provider infrastructure.
2. Implement the provider abstraction and Kimi adapter with durable result persistence and secret-safe runtime configuration.
3. Prove a real Kimi health/catalog/completion path using the existing credential source without committing the secret.
4. Run a persistent Bloodrush Creative Room E2E and verify restart/reconciliation.
5. Continue Epics 3-5 and their UI/contracts without generating video.
6. Run repository verification, push both existing branches, and complete the CSP PR review loop.

## 5. Handoff and Approval

Owner: development agent, with product decisions owned by Gordo.

Approval is already explicit in this session: use Kimi temporarily to fill the LLM path and move through the rest of CSP/BMAD as quickly as possible. The approval is conditional: retain Raycast and do not silently fall back between providers.

## 6. Correct-Course Checklist Result

- Trigger and core problem identified: **done**
- Epic impact assessed: **done**
- PRD, architecture, UX, and technical artifact conflicts identified: **done**
- Recommended path selected: **Direct Adjustment**
- MVP viability preserved: **yes**
- Rollback required: **no**
- Scope reduction required: **no**
- User approval: **approved in batch mode**
- Implementation handoff: **development, immediate**

