---
title: 'Automate the Windows Raycast Creative Room handoff'
type: 'feature'
created: '2026-08-22'
status: 'optional-provider-infrastructure'
baseline_commit: '808c5f096b7d52f49fc8bf07f947950d045b7fc4'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-epics-1-2-cross-platform-raycast.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-creative-studio-pro-2026-08-22/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Windows Creative Room capture is technically persistent but operationally fragile: preparation copies only the raw brief, Raycast model selection and text-only safety are uncodified, and generic commands invite improvised GUI steps or accidental media generation.

**Approach:** Turn the proven manual-assisted path into a deterministic Windows state machine with CSP-named Raycast Script Commands and a project skill. Prove it end to end with a persistent Bloodrush story-room run that captures structured text, reconciles after restart, and preserves the user-accepted Raycast image without generating video.

## Boundaries & Constraints

**Always:** Work on the existing CSP and bridge branches. Use Computer only for native Raycast UI steps, the in-app Browser for CSP, and Chrome only for Higgsfield. Open persistent AI Chat with physical `Ctrl`, `Ctrl` when needed; start an empty chat, select an exact visible model or Agent through `/name`, verify the header, enforce text-only/no-tools, capture the complete reply under the exact roster label, and retain raw text plus hashes. Use Trailer House mode and the supplied Bloodrush premise and references for the live prompt.

**Ask First:** Bridge contract breaks, schema migrations, public exposure, billable calls, or replacing/deleting accepted project assets.

**Never:** Generate video; invoke image/video tools or automatic extension discovery in capture chats; use PowerShell/Python GUI automation, synthesized window handles, screenshots as automation, Root Search, Search Files, fuzzy labels, fabricated replies, silent provider fallback, new branches, or new PRs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Prepare | Active run with exact roster and raw brief | Atomic state records phase/model/label and copies one structured text-only prompt containing the untouched brief | Missing/ambiguous run, roster, or brief stops before clipboard/state claim |
| Native chat | Empty persistent AI Chat plus exact `/name` | Visible header matches; guarded prompt is submitted once | Dirty composer, wrong header, or unavailable model halts for reacquisition |
| Capture | Complete copied assistant text plus exact label | Verbatim answer, content hash, parse result, and next phase persist | Empty/duplicate/wrong-label clipboard is explicit and non-destructive |
| Resume | Process restarts during a partial two-voice run | Show-active reports the same pending lane and reconciliation never resubmits completed work | Stale/mismatched state blocks capture |

</frozen-after-approval>

## Code Map

- `.agents/skills/raycast-creative-room-windows/SKILL.md` -- new concise project workflow; invokes Script Commands and confines GUI work to Computer.
- `C:/Users/Gordo/Documents/Github/raycast-pro-bridge/src/directors-cut/concept-run.ts:160` -- existing prepare/status service and active-state contract; reuse rather than add a second state store.
- `C:/Users/Gordo/Documents/Github/raycast-pro-bridge/script-commands/directors-cut-prepare-automated-capture.ps1` -- currently writes the raw question to `active-capture-prompt.txt`; wrap it in the text-only structured response contract while preserving the brief verbatim.
- `C:/Users/Gordo/Documents/Github/raycast-pro-bridge/script-commands/directors-cut-capture-active-answer.ps1` -- existing exact-label, lock, hash, correction, and parser path; extend state validation without weakening verbatim capture.
- `C:/Users/Gordo/Documents/Github/raycast-pro-bridge/script-commands/` -- add CSP Prepare Story Room Prompt, CSP Show Active Capture, and CSP Capture Last Text Reply commands as safe Windows entry points.
- `C:/Users/Gordo/Documents/Github/raycast-pro-bridge/tests/windows-capture.test.ts` and `tests/platform-contract.test.ts` -- cover prompt guards, phases, exact labels, restart, stale state, and unchanged Darwin selection.
- `HANDOFF.md` and bridge `README.md` -- replace obsolete `Ctrl+Space`/generic-command instructions with the verified persistent-AI-Chat contract.
- `C:/Users/Gordo/Documents/Creative Studio Pro/raycast-state` and Bloodrush download folders -- live evidence only; never commit project state or source references.

## Tasks & Acceptance

**Execution:**
- [ ] Bridge prepare/capture services and PowerShell commands -- implement atomic prepare → model-ready → reply-captured state with a strict `TITLE`, `LOGLINE`, `HOOK`, `SORA PROMPT - 12 SECONDS` text response contract and exact-label safeguards.
- [ ] `.agents/skills/raycast-creative-room-windows/SKILL.md` -- encode the verified Windows sequence, safety boundaries, recovery rules, and Script Command calls under 500 lines.
- [ ] Bridge tests/docs and CSP `HANDOFF.md` -- validate and document the durable flow without claiming GUI automation by scripts.
- [ ] Browser + Computer -- create/reconcile a persistent Bloodrush workspace, capture a stronger text-only Trailer House story blueprint, preserve the accepted Raycast image, restart, and verify no duplicate work or video generation.

**Acceptance Criteria:**
- Given a prepared Bloodrush run, when the operator follows the skill through exact model selection and capture, then CSP shows the verbatim structured reply under the exact voice with hashes and a terminal zero-pending run.
- Given a partial or completed run, when bridge and CSP restart, then show-active and reconciliation reconstruct the same phase and never resubmit a completed lane.
- Given either repository, when its full verification suite runs, then Windows additions pass and retained macOS contracts remain green.

## Spec Change Log

- 2026-08-22: Gordo approved a BMAD course correction making Kimi the temporary default Creative Room provider so the remaining CSP workflow can advance without depending on native Raycast GUI throughput. This specification remains authoritative for the optional Raycast provider and its exact-label Windows recovery path; it is no longer the primary delivery path.

## Design Notes

Script Commands manage files, clipboard, validation, and state only. Computer owns every GUI transition. The prompt must begin with the text-only/no-tools prohibition, embed the canonical brief unchanged, demand the existing four parser headers exactly once, and direct a concise cinematic story plus Trailer House blueprint—not media generation.

## Verification

**Commands:**
- CSP `bun test && bun run check && bun run build` and `git diff --check` -- all pass.
- Bridge `bun run verify` and `git diff --check` -- all pass, including native Windows capture and platform isolation.
- Git/PR checks -- both required branches are pushed; if CSP head changes, PR #1 returns to 5/5 with zero unresolved GraphQL review threads within five iterations.

**Manual checks:**
- Raycast header, exact `/name`, text-only response, accepted image preservation, CSP reconciliation, and restart persistence are visibly verified on the mandated surfaces; no video is generated.
