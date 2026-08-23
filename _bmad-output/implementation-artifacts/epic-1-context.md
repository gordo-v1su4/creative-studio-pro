# Epic 1 Context: Project Canvas & Gated Pipeline

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Deliver a durable, local-first Creative Studio Pro project canvas where Gordo can preserve creative work across restarts, arrange it spatially, and move through the authoritative super-seed2 S0-S10 methodology without agents, providers, or UI shortcuts bypassing required human decisions. Board, focused Story views, and the Stage Agent are projections of the same canonical project rather than independent workflows.

## Stories

- Story 1.1: Scaffold the Private CSP Workbench
- Story 1.2: Create and Reopen Durable Projects
- Story 1.3: Arrange and Persist the Canvas
- Story 1.4: Enforce the S0-S10 Gate System

## Requirements & Constraints

- One project folder is the canonical aggregate. Stable IDs, append-only audit events, reconstructable indexes, and persisted canvas layout must survive a real process restart.
- Every project exposes one authoritative stage, gate state, confidence result, legal next actions, and gate history for S0 Intake through S10 Final assembly.
- Generation and submit-ready prompts remain blocked until their methodology prerequisites pass. Only the human operator may force-advance, with stage, reason, previous confidence, operator, and timestamp recorded.
- Owner-authored brief content and interview answers remain distinct evidence. Interviews capture only unresolved owner decisions; the system may calculate confidence and identify gaps, but it may not fabricate answers or inflate confidence. Brief promotion requires an explicit authenticated lock of a complete current version.
- Canonical records, raw model responses, gate decisions, approvals, and provenance are append-only. Reload must reproduce committed state without depending on a disposable client cache.
- Credentials and provider calls remain server-side. Unavailable capabilities expose truthful errors and never silently fall back.
- The product is SvelteKit and Svelte 5 with Tailwind and Svelte Flow. React and npm are excluded.
- Page chrome must not overflow at 375, 768, or 1440 pixels. Controls require keyboard access, visible focus, text labels for state, reduced-motion behavior, and WCAG 2.2 AA contrast.

## Technical Decisions

- Routes and UI call application ports; adapters point inward toward the domain. One typed project command gateway owns canonical mutations and requires an expected project version.
- Zod versioned schemas validate commands, events, and external boundaries. Migrations are explicit and forward-only.
- The project event ledger is canonical. Canvas layout is a separate last-writer-wins document, and indexes/read models are rebuildable projections.
- One domain gate engine owns stage derivation, confidence thresholds, legal actions, force-advance rules, and later pilot/batch eligibility.
- Server state is canonical and client state is a projection. Conversation UI may stream transient presentation state, but accepted answers and resulting gate changes must pass through the project gateway.
- Capability adapters own provider and machine details. External operations have explicit timeouts, terminal failure states, idempotency where applicable, and no automatic fallback.
- Persisted filesystem references are project-relative or stable object keys; absolute roots and secrets exist only in runtime configuration.

## UX & Interaction Patterns

- The canvas remains the primary workspace. Board arranges Seed and connected Story Card nodes; Story edits canonical narrative material; Cards, Media, Preview, and Export project the same ordered records. One persistent beat owns Text, Image, and Video faces rather than creating duplicate cards.
- Focused Stage Agent overlays or inspectors may collect a required decision, but they must return the user to the spatial project context rather than replace the product with a generic chat-first layout. After an initial open intake, agent questions become concise A-E choices with an explicit recommended default and optional voice/text detail.
- Desktop uses a contextual left rail, main workspace, and stable right inspector. The inspector becomes an overlay below the desktop breakpoint, while page chrome remains within 375, 768, and 1440 pixel viewports.
- Gate states use explicit text such as BLOCKED, READY, PASSED, and FORCED. A blocked stage offers concrete legal next actions rather than optimistic assistant language.
- Escape closes the topmost overlay first. Enter activates focused controls, required actions are never hover-only, and audit/model records remain readable without canvas pointer gestures.
- At desktop widths the inspector may remain visible or docked; smaller widths use a full-height sheet. The same canonical conversation and project state must survive changing presentation modes.
- Status changes that matter are announced through an aria-live region without repeating polling noise.

## Cross-Story Dependencies

- Story 1.4 depends on Story 1.2 project persistence and command versioning; it must not create a second conversation-only source of truth.
- Story 1.4 projects its state into the Story 1.3 canvas and inspector surfaces while keeping canvas layout persistence independent from gate events.
- Epic 2 Creative Room and later generation epics consume Epic 1 gate state and cannot weaken or reinterpret it.
