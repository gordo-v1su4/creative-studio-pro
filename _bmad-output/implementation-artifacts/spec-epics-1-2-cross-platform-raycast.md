---
title: 'Complete S1 and S2 with Windows-first Raycast'
type: 'feature'
created: '2026-08-22'
status: 'in-review'
baseline_commit: '421a2e07f0768fbb0e108c045c4f9638f6afe5b9'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-creative-studio-pro-2026-08-22/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-creative-studio-pro-2026-08-22/METHODOLOGY-CONTRACT.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** CSP displays/forces stages but lacks the authoritative S1 Interview loop and auditable S2 Brief lock. Raycast runs on this PC, yet the bridge rejects Windows paths and assumes macOS Bash/AppleScript.

**Approach:** E2E S1/S2 on Windows first with native PowerShell, verified Quick AI/Agent use, exact capture, persisted confidence, versioned brief, and authenticated lock. Keep the Bun core host-neutral and retain the macOS driver through tests and macOS CI.

## Boundaries & Constraints

**Always:** Use native Windows Raycast and PowerShell for this machine—never WSL/Git Bash. S1 asks at most five owner-decision questions per round; PASS requires overall ≥80 and every dimension ≥70. S2 requires all brief fields plus explicit authenticated operator approval. Persist stage, confidence, brief, and approval events append-only. Keep exact Raycast labels/raw text/hashes, server-only secrets, one bridge, explicit failures, legacy `CSP_M3_*` aliases, and the macOS driver.

**Ask First:** Public exposure or multi-user auth, destructive schema migration, billable calls, bridge contract breaks, or methodology changes.

**Never:** Skip S1, auto-pass S2, inflate confidence, fabricate Raycast state/output, fuzzy-match labels, treat Search Files as a composer, remove macOS, absorb the bridge, or implement S3+.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| S1 round | Owner answers at S0/S1 | Persist ≤5 questions, answers, eight scores, overall, lowest gap, and resolutions | Overall <80 or any score <70 stays BLOCKED |
| S1 stall | Three loops and overall <60 | Persist STALLED blockers without guessing | S2 transition remains illegal |
| S2 lock | Passed S1 and complete current brief | Authenticated operator lock appends audit and shows S2 PASSED after restart | Missing/stale/unauthorized lock is rejected |
| Windows capture | Native bridge plus verified Quick AI/Agent composer | PowerShell prepare/capture preserves exact label, raw answer, and hash | Missing agent/composer/clipboard is unavailable; no fallback |
| macOS regression | Darwin driver contract suite | Existing guarded Script Command flow remains compatible | Darwin failure is explicit and does not alter Windows behavior |

</frozen-after-approval>

## Code Map

- `C:/Users/Gordo/Documents/Github/super-seed2/pipeline/creative-stages.md` -- read-only source for S1/S2 confidence, artifacts, and gates.
- `src/lib/domain/schemas.ts`, `src/lib/domain/gates.ts` -- model confidence rounds, S1 transition, versioned brief, S2 lock, and legal actions.
- `src/lib/application/gateway.ts`, `src/lib/adapters/project-store.ts` -- enforce expected-version append-only interview/brief/approval commands.
- `src/routes/api/projects/[projectId]/**`, `src/lib/server/operator-auth.ts` -- add stage endpoints and server-derived S2 audit identity.
- `src/routes/+page.svelte`, `src/lib/ui/StageGatePanel.svelte`, `src/lib/ui/chat/AgentChat.svelte` -- accessible S1 rounds, gaps, brief editor, and explicit lock UX.
- `src/lib/adapters/m3-bridge.ts`, `src/lib/adapters/capability.ts`, `src/lib/server/config.ts` -- host-neutral Raycast config/provenance with legacy aliases.
- `C:/Users/Gordo/Documents/Github/raycast-pro-bridge/src/**`, `script-commands/**` -- shared Bun services, safe path containment, native Windows PowerShell driver, retained Darwin driver.
- CSP `tests/**` and bridge test/CI files -- cover every matrix row, restart/auth, Windows paths, exact capture, and macOS regression.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/domain/{schemas,gates}.ts`, `src/lib/application/gateway.ts` -- implement exact S1 confidence and S2 lock rules from the live methodology.
- [x] `src/routes/api/projects/[projectId]/**`, `src/lib/ui/{StageGatePanel,chat/AgentChat}.svelte`, `src/routes/+page.svelte` -- implement persisted interview/brief/lock UX.
- [x] CSP bridge/config files and `HANDOFF.md` -- expose truthful Windows-first Raycast setup with host-neutral names and legacy compatibility.
- [x] Bridge `src/**`, `script-commands/**` -- continue the existing feature branch with portable services, Windows PowerShell usage, fixed path security, and unchanged macOS capability.
- [ ] Both repositories' tests/CI -- cover the matrix, then run Browser + Computer E2E on this Windows PC.

**Acceptance Criteria:**
- Given a project at S0/S1, when answers are recorded, then CSP loops with at most five questions until overall ≥80 and every dimension ≥70, or persists the defined STALLED state.
- Given S1 PASS, when the current complete brief is locked by the authenticated operator, then S2 becomes PASSED and survives restart; stale or unauthenticated requests cannot advance it.
- Given native Windows Raycast, when Computer and Browser execute prepare → verified composer → exact capture → reconcile, then the same project reaches S1 PASS and S2 PASSED without duplicate work or fallback.
- Given macOS CI, when the retained Darwin suites run, then the existing guarded capture contract remains green while Windows-specific behavior stays isolated.

## Spec Change Log

- 2026-08-22: Windows implementation, exact-label correction handling, S1/S2 persistence, and authenticated brief locking were verified against the live persistent project `The Midnight Archive`. The final E2E task remains open until Computer can target and visibly verify the native Raycast Quick AI/Agent composer; manual-assisted PowerShell capture is proven but is not represented as native composer proof.

## Design Notes

Windows is the implementation and live E2E priority. Manual-assisted capture is the portable baseline; UI automation is used only after Computer verifies Quick AI or the named Agent composer, never Root Search. macOS remains supported by the same Bun contract and its platform suite.

## Verification

**Commands:**
- CSP `bun test`, `bun run check`, and `bun run build` -- S1/S2 domain, integration, type, and production checks pass.
- Bridge Windows contract/security/server/path/platform suites -- all pass natively in PowerShell/Bun.
- macOS CI driver/contract suites -- retained Darwin behavior passes without a Windows host.
- Restart harness -- confidence rounds, brief version, approval identity, and S2 state remain unchanged.

**Manual checks:**
- Browser at 1440px and 375px proves accessible interview, brief, lock, persisted confidence, and truthful bridge-offline states.
- Computer targets the native Windows Raycast window, verifies Quick AI/Agent rather than Search Files, captures the complete answer through native commands, and observes CSP reach S2 PASSED.

**Live Windows evidence (2026-08-22):**
- CSP: 15 tests / 46 assertions, Svelte check with zero errors and warnings, production build, and `git diff --check` all pass.
- Bridge: 6 tests / 38 assertions with 3 Darwin-only skips, TypeScript, contract 25/25, security 29/29, concept decisions 13/13, image 8/8, video 28/28, and Hermes 7/7 all pass.
- Persistent Browser walkthrough: corrected exact-label voice captures reconcile to full title/logline; S1 passes at confidence 88; S2 brief v1 locks as `gordo`; a fresh CSP process reopens the same project at S2 PASSED.
- Native Raycast application is installed and running on Windows, but Computer currently reports no targetable Raycast window. The bridge/PowerShell path and provenance are verified as manual-assisted only; no Quick AI/Agent composer claim is made.
