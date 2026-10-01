---
title: 'Lock the Owner Brief Before the Stage Interview'
type: 'feature'
created: '2026-08-23'
status: 'done'
baseline_commit: '12060af9f86f86cca14e2310ca84358f2bf016d0'
review_loop_iteration: 0
context:
  - 'docs/implementation/epic-1-context.md'
  - 'docs/planning/architecture/architecture-creative-studio-pro-2026-08-22/METHODOLOGY-CONTRACT.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** CSP currently opens the Stage Agent before the owner can finalize the formal brief, then asks the owner to create and lock that brief after the interview. The interview can therefore reason from a mutable seed instead of a deliberate owner-approved source.

**Approach:** Make the complete versioned brief the S0 prerequisite: the owner edits, saves, and explicitly locks it first. Only a lock matching the current brief hash enables S1; the Stage Agent reads that locked version, and a passing interview immediately satisfies S2 because its brief is already approved.

## Boundaries & Constraints

**Always:** Preserve append-only brief versions, hashes, expected-version commands, authenticated operator attribution, confidence thresholds, and completed projects. Show the editor before Agent access, keep the lock readable, and evaluate only the locked version plus recorded answers. A changed brief becomes a new version requiring a new lock before another interview. All scrollbars and resize chrome use a thin dark teal/blue treatment—never native white/light gray—and are approximately half the current width.

**Ask First:** Resetting already-recorded interview rounds after a replacement brief, migrating historical ledgers, changing confidence thresholds, or changing authentication requirements.

**Never:** Silently lock, fabricate owner decisions, interview against unsaved text, mutate a locked version, bypass authentication, generate media, implement the Story tree, or rebuild pilot/teaser cards in this slice.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First project | S0 project with no formal brief | Inspector shows editable brief and no enabled Agent entry | Incomplete brief stays editable and cannot lock |
| Brief lock | Current version plus valid operator credential | Append lock, advance to S1 BLOCKED, expose Agent | Stale/invalid input changes nothing |
| Interview | S1 project with matching locked brief | Agent evidence includes that exact brief and accepted answers | Missing/mismatched lock returns a clear 409/400 and records no round |
| Interview pass | Valid round meets all existing thresholds | Persist round and expose S2 as PASSED without a second lock | Model prose cannot advance the gate without gateway success |
| Existing completion | Historical S2 PASSED project | Reopens unchanged with its prior approval and interview | No migration or duplicate approval event |

</frozen-after-approval>

## Code Map

- `src/lib/domain/schemas.ts:125-170,281-305,444-500` -- reuse brief/approval records and keep old projects readable.
- `src/lib/domain/gates.ts:80-155` -- change legal progression so the current brief lock enables S1 and a passing interview completes S2; retain thresholds and protected stages.
- `src/lib/application/gateway.ts:208-310` -- allow pre-interview save/lock while enforcing immutable versions and append events.
- `src/lib/server/stage-agent-handler.ts:30-105` and `src/lib/server/stage-agent.ts:45-150` -- reject interviews without a matching lock and use locked evidence.
- `src/lib/ui/StageGatePanel.svelte:88-125` and `src/lib/ui/BriefPanel.svelte` -- brief-first inspector ordering, locked-source status, and Agent enablement.
- `src/routes/+page.svelte:457-545` and `src/routes/layout.css:3-13` -- preserve the collapsed rail cell so the inspector remains right.
- `src/routes/layout.css` -- apply compact dark-mode scrollbar/resizer styling across editable and scrollable surfaces.
- `tests/domain/s1-s2-gates.test.ts`, `tests/integration/{s1-s2-persistence,brief-route,stage-agent-handler}.test.ts` -- cover stage order, stale/auth failures, compatibility, and restart.
- `docs/planning/architecture/architecture-creative-studio-pro-2026-08-22/METHODOLOGY-CONTRACT.md` -- record the owner-approved brief-first interpretation of S0-S2.

## Tasks & Acceptance

**Execution:**
- [x] Domain/gateway files above -- enforce locked-current-brief as the interview prerequisite and make a passing interview complete S2.
- [x] Stage Agent boundary/evidence files -- use the locked brief and fail closed before it exists.
- [x] Brief/Stage UI and work-area grid -- present save/lock first, reveal Agent second, keep the inspector anchored right, and replace light native scrollbar/resizer chrome with thin dark teal/blue styling.
- [x] Contract and focused tests -- document and prove the sequence without touching media or the deferred Story tree.

**Acceptance Criteria:**
- Given a new or existing S0 project, when the owner edits and saves a complete brief, then CSP persists a new hashed version but keeps the interview unavailable until explicit authenticated lock.
- Given a matching locked brief, when the owner opens Agent, then every question and score is grounded in that immutable version and the recorded answers.
- Given the interview passes, when the canonical gateway persists the round, then S2 displays PASSED immediately and survives a real application restart.
- Given Board or Story at desktop width, when the view changes, then the same 300px inspector remains in the right grid column.
- Given any scrollable editor or panel, when overflow appears, then its scrollbar/resizer remains thin and dark teal/blue without white or light-gray native chrome.

## Spec Change Log

## Design Notes

The stage labels remain `S0 Intake → S1 Interview → S2 Brief`; the lock happens at the end of S0, S1 operates against it, and S2 becomes the confirmation that both owner brief and interview evidence passed. The proposed `Project → Season → Episode → Teaser` Story tree is intentionally the next slice.

## Verification

**Commands:**
- `bun run check` -- passed with zero Svelte/TypeScript diagnostics.
- `bun test` -- passed 32 tests across 8 files.
- `bun run build` -- production adapter-node build succeeded.
- `git diff --check` -- passed.

**Manual checks (if no CLI):**
- In the in-app Browser, edit/save/lock the TikTok Drug Dynasty brief, confirm Agent is unavailable before lock and available after it, switch Board/Story without inspector movement, pass one interview flow, reload, and confirm S2 remains PASSED. Do not generate media.

**Browser evidence:** Board and Story both keep a 300px right inspector; the Agent entry is disabled before lock; overflow uses a 6px teal/blue gradient scrollbar and dark resizer; the approved pilot-first TikTok brief was saved as v1. Live authenticated lock is pending because `CSP_OPERATOR_TOKEN` and `CSP_OPERATOR_ID` are not configured in the running local app.

## Suggested Review Order

**Gate contract**

- Start with the authoritative brief-lock and interview progression rules.
  [`gates.ts:117`](../../src/lib/domain/gates.ts#L117)

- Persist pre-interview versions while preserving append-only and legacy behavior.
  [`gateway.ts:243`](../../src/lib/application/gateway.ts#L243)

**Agent boundary**

- Fail closed before Kimi sees any project without an exact current lock.
  [`stage-agent-handler.ts:48`](../../src/lib/server/stage-agent-handler.ts#L48)

- Serialize the locked brief and authenticated approval as model evidence.
  [`stage-agent.ts:57`](../../src/lib/server/stage-agent.ts#L57)

**User flow and layout**

- Present the owner brief first and retain a readable locked-source summary.
  [`BriefPanel.svelte:49`](../../src/lib/ui/BriefPanel.svelte#L49)

- Reveal the Stage Agent only after the brief lock exists.
  [`StageGatePanel.svelte:95`](../../src/lib/ui/StageGatePanel.svelte#L95)

- Preserve the left grid cell so Story cannot displace the right inspector.
  [`+page.svelte:458`](../../src/routes/+page.svelte#L458)

- Replace native light overflow chrome with compact dark teal styling.
  [`layout.css:131`](../../src/routes/layout.css#L131)

**Proof and contract**

- Prove save-lock-interview-pass survives a real store restart.
  [`s1-s2-persistence.test.ts:35`](../../tests/integration/s1-s2-persistence.test.ts#L35)

- Prove model evidence contains the exact approved brief and hash.
  [`stage-agent.test.ts:29`](../../tests/server/stage-agent.test.ts#L29)

- Record the approved S0-S2 methodology interpretation for later slices.
  [`METHODOLOGY-CONTRACT.md:16`](../planning-artifacts/architecture/architecture-creative-studio-pro-2026-08-22/METHODOLOGY-CONTRACT.md#L16)
