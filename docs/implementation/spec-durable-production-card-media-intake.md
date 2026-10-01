---
title: 'Durable Production Card Media Intake'
type: 'feature'
created: '2026-08-22'
status: 'draft'
review_loop_iteration: 0
context:
  - 'docs/planning/ux-designs/ux-creative-studio-pro-2026-08-22/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story cards show prompts and remote URLs, but users cannot attach local image/video files that survive reload. That blocks the intended Text → Image → Video workflow.

**Approach:** Add project-owned binary storage and multipart upload/read routes, then attach returned asset metadata to the canonical card projected across Board, Cards, Media, Preview, and Export.

## Boundaries & Constraints

**Always:** Keep files inside the CSP project root; validate IDs, MIME family, and size; use opaque path-safe asset IDs; preserve version checks and append-only project events; use project-scoped read URLs; keep picker/drop controls accessible; preserve remote URL intake.

**Ask First:** Raise limits above 30 MB image/250 MB video; delete stored binaries; call external generators; expand the production schema beyond asset metadata.

**Never:** Generate video, spend credits, expose filesystem paths, accept executable/HTML payloads, create duplicate face cards, or overwrite history.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Local image | Allowed image, existing card, current version | Store file; attach asset; update Image face/Preview | Structured 4xx/409; no project mutation |
| Local video | Allowed video within ceiling | Project URL supports playback | Reject before writing |
| Reload | Persisted local asset URL | Every card projection resolves it | Missing binary 404; metadata remains |
| Replacement | New same-kind asset | Latest asset becomes active; no implicit delete | Failed upload keeps prior asset |
| Remote result | User pastes remote URL | Existing URL path persists | Reject blank/invalid visibly |

</frozen-after-approval>

## Code Map

- `src/lib/adapters/project-store.ts:28` -- add safe binary write/read beside ledger/layout persistence.
- `src/lib/domain/schemas.ts:243` -- reuse canonical `productionAssetSchema` metadata and production event.
- `src/lib/application/gateway.ts:192` -- reuse versioned `saveProduction` after binary write.
- `src/routes/api/projects/[projectId]/production/+server.ts:1` -- response/version-conflict conventions.
- `src/routes/api/projects/[projectId]/assets/+server.ts` -- new validated multipart intake.
- `src/routes/api/projects/[projectId]/assets/[assetId]/+server.ts` -- new scoped byte/range delivery.
- `src/lib/ui/ProductionWorkspace.svelte:57` -- add picker/drop upload state; preserve URL intake.
- `src/lib/ui/nodes/StoryCardNode.svelte:1` -- already consumes asset URLs; no duplicate model.

## Tasks & Acceptance

**Execution:**
- [ ] `src/lib/adapters/project-store.ts` -- add project-asset binary storage/read primitives.
- [ ] `src/routes/api/projects/[projectId]/assets/**` -- add multipart upload and byte/range delivery.
- [ ] `src/lib/ui/ProductionWorkspace.svelte` -- add compact picker/drop controls and feedback.
- [ ] `tests/server/production-assets.test.ts` -- cover validation, conflicts, reload, and ranges.

**Acceptance Criteria:**
- Given a generated story card, when a user selects or drops an allowed image, then the same card's Image face displays it on Media, Cards, Board, and Preview after reload.
- Given a locally attached video, when Preview selects its card, then the project-scoped media endpoint provides playable bytes without any generation call.
- Given an export after attachments, when the manifest downloads, then it contains stable project-scoped asset URLs and canonical card associations.

## Spec Change Log

## Design Notes

Binary files are project-owned but stay outside JSONL. The ledger stores metadata and scoped URLs. Replacement changes the latest card/kind record without deleting older bytes.

## Verification

**Commands:**
- `bun run check` -- expected: zero Svelte/TypeScript diagnostics.
- `bun test` -- expected: all existing tests plus production-asset boundary tests pass.
- `bun run build` -- expected: production adapter-node build succeeds.

**Manual checks:**
- In the in-app Browser, attach an image to one TikTok Drug Dynasty card, reload, flip Text/Image/Video faces on Board and Cards, select the card in Preview, and confirm Export retains the same asset URL. Do not generate video.
