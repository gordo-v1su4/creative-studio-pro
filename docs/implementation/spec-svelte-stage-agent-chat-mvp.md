---
title: 'Svelte Stage Agent Chat MVP'
type: 'feature'
created: '2026-08-22'
status: 'in-progress'
review_loop_iteration: 0
baseline_commit: '26ff6da7ad9604c6b53bf1ca8883c26f59a8be93'
context:
  - 'docs/implementation/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The current Agent drawer is a read-only interview record, while the inspector requires Gordo to author both sides of the interview and manually score the model's confidence. This does not feel like an IDE agent and makes S1 slower than the creative work it is meant to clarify.

**Approach:** Replace the primary S1 form with a Svelte-only conversational Stage Agent that opens as a focused central window or docks on the right, asks one unresolved owner-decision question at a time through Kimi, accepts typed or push-to-talk dictated answers, and records evidence-based confidence through the existing project gateway. Present it as the `NERATE STORYHELPER™` terminal: near-black, dense mono typography, teal/cyan with restrained blue-violet, and no pink.

## Boundaries & Constraints

**Always:** Use Svelte 5/SvelteKit only, with no React dependency or compatibility layer. Keep `KIMI_API_KEY` server-only and use the official Kimi OpenAI-compatible endpoint through Vercel AI SDK primitives. Existing interview rounds, project versions, gate thresholds, and append-only project events remain canonical. The agent generates questions and confidence; Gordo supplies only answers. Dictation fills an editable composer and never auto-submits. Preserve keyboard access, visible focus, aria-live status, reduced-motion behavior, and responsive no-overflow behavior.

**Ask First:** Expanding the MVP beyond S1, changing confidence thresholds, adding autonomous tools, enabling a paid or alternate provider, or adding any action that can generate images/video or spend money.

**Never:** Add React, assistant-ui, CopilotKit, AI Elements, or embed Jcode as the product runtime. Never expose credentials, silently fall back from Kimi, fabricate confidence, advance S2 without a passing recorded round, trap the user in an inaccessible modal, or generate media. Full hands-free voice mode, server transcription, spoken agent replies, resumable streaming, attachments, and tool execution are deferred from this quick version.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open agent | S0/S1 project with seed and saved rounds | Centered conversation reconstructs saved Q/A, then requests one relevant unresolved question | Missing project is an explicit empty state; unavailable Kimi retains existing transcript |
| Answer | Nonblank typed or dictated answer plus current pending question and expected version | Kimi returns an acknowledgement, eight evidence-based scores, overall confidence, resolutions, and at most one next question; gateway appends one canonical round | Invalid structure or provider failure records no false round and leaves the answer editable for retry |
| Passing answer | Overall at least 80 and every dimension at least 70 | Project advances to S2 and agent explains that the brief is next | Gateway result, not model prose, determines the displayed stage |
| Voice input | Browser supports speech recognition and user grants microphone permission | Push-to-talk transcript is inserted into the composer for review | Unsupported/denied/error state is labeled; normal typing remains available |
| Presentation mode | Agent open on desktop or narrow viewport | Same conversation toggles between centered focus and right dock; mobile uses a full-height sheet | Escape closes the topmost agent surface without losing saved rounds |

</frozen-after-approval>

## Code Map

- `package.json`, `bun.lock` -- add only the current Svelte-compatible Vercel AI SDK core/client and OpenAI-compatible provider packages; preserve Bun and verify no React package enters the graph.
- `src/lib/server/stage-agent.ts` -- new server-only Kimi adapter and strict Zod response contract; build prompts from seed, current stage, and recorded rounds without exposing secrets.
- `src/routes/api/projects/[projectId]/agent/+server.ts` -- new start/answer boundary; validate input, call the stage agent, and route accepted scoring through `ProjectCommandGateway.recordInterviewRound`.
- `src/lib/application/gateway.ts`, `src/lib/domain/gates.ts` -- reuse existing expected-version mutation, eight-dimension scoring, PASS/BLOCKED/STALLED rules; do not create a second gate engine.
- `src/lib/ui/chat/AgentChat.svelte` -- replace the read-only drawer with transcript, composer, push-to-talk control, busy/error states, and center/dock presentation.
- `src/lib/ui/InterviewPanel.svelte`, `src/lib/ui/StageGatePanel.svelte` -- remove the manual question/score form from the primary path and retain only compact status/history plus an Open Agent action or advanced read-only detail.
- `src/lib/ui/app-state.svelte.ts`, `src/routes/+layout.svelte`, `src/routes/+page.svelte` -- retain global open/mode state and adopt returned canonical project state in the canvas without shadow project truth.
- `tests/domain`, `tests/integration` -- cover response validation, server-only routing, gateway persistence, version conflict, provider failure, PASS transition, and absence of React dependencies.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `bun.lock`, `src/lib/server/stage-agent.ts` -- add the minimal provider-neutral AI layer and strict Kimi response schema.
- [x] `src/routes/api/projects/[projectId]/agent/+server.ts` -- implement start/answer requests and canonical gateway reconciliation.
- [x] `src/lib/ui/chat/AgentChat.svelte`, `src/lib/ui/app-state.svelte.ts`, `src/routes/+layout.svelte`, `src/routes/+page.svelte` -- build the centered/docked Svelte conversation and native dictation composer.
- [x] `src/lib/ui/InterviewPanel.svelte`, `src/lib/ui/StageGatePanel.svelte` -- replace manual scoring with concise agent-owned status and history.
- [x] `tests/**` -- test the matrix, stage invariants, and no-React dependency boundary.

**Acceptance Criteria:**
- Given an S0/S1 project, when Gordo opens Agent, answers through text or supported dictation, and receives a valid Kimi evaluation, then the conversation shows one question at a time and the canonical project records the round without any user-editable confidence controls.
- Given the same project is reloaded, when Agent opens again, then saved questions, raw owner answers, scores, and stage state reconstruct from the project store.
- Given Kimi is unavailable, returns invalid data, or the project version is stale, when an answer is submitted, then CSP displays the real error, preserves the answer for retry, and does not append or advance anything.
- Given desktop and mobile viewport checks, when Agent switches between focus and dock modes, then all controls remain keyboard-operable, labeled, and free of page-level horizontal overflow.

## Spec Change Log

- 2026-08-22: Gordo selected the Crush-terminal visual reference and the `NERATE STORYHELPER™` identity, then deferred per-slice adversarial review until CSP has a complete end-to-end vertical path.

## Verification

**Commands:**
- `bun test` -- all domain, integration, provider-contract, and dependency-boundary tests pass.
- `bun run check` -- Svelte and TypeScript report zero errors and warnings.
- `bun run build` -- the production server build succeeds and no secret is bundled client-side.

**Manual checks (if no CLI):**
- In the in-app Browser at 1440px and 375px, verify central/docked chat, typed answer, microphone unsupported/permission states, Kimi failure preservation, saved-round reconstruction, and S1-to-S2 transition without manual scoring fields.
