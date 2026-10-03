---
name: Creative Studio Pro
status: final
updated: 2026-08-22
sources:
  - ../../prds/prd-creative-studio-pro-2026-08-22/prd.md
  - ../../../../docs/UI-UX.md
  - DESIGN.md
---

# Creative Studio Pro — EXPERIENCE.md

## Foundation

Creative Studio Pro is a desktop-first responsive web workbench built with
SvelteKit 2.70.3, Svelte 5 runes, Tailwind 4, and Svelte Flow. The product
starts on Phase 0 deployment host and later moves durable hosting to the home server without
changing its interaction model. `DESIGN.md` owns visual identity; this document owns behavior.

The canvas is the primary product surface. M3-only Raycast, desktop-only
SwarmUI/ComfyUI, hosted Splitter, Higgsfield, Sora, and other providers are
remote capabilities—not invisible local dependencies. Their availability is
part of the interface.

The authoritative creative workflow is super-seed2 S0–S10. Stage state, gate
state, confidence, draft/submit-ready distinction, quote, confirmation, and
provenance remain visible throughout the experience.

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| Project Canvas `/` | App open, project picker | Create and spatially operate one project |
| Board | Default view inside Project Canvas | Arrange Seed, Voice, and connected Story Card nodes spatially |
| Story | Project view switcher | Edit the canonical logline, premise, theme, and story spine |
| Cards | Project view switcher | Review the ordered story beats as compact Text/Image/Video card faces |
| Media | Project view switcher, card face/action | Attach and inspect returned image/video assets and prompts by card |
| Preview | Project view switcher | Play or inspect the ordered card sequence using the same attached assets |
| Export | Project view switcher | Package the canonical story, cards, prompts, media references, and timing |
| Node Focus | Double-click node, inspector Open | Center one node, dim neighbors, preserve lineage context |
| Compare | Multi-select 2–4 Model Voices | Align exact outputs and approve/reject per voice |
| Library `/library` | Top nav, Promote action | Browse versioned SpecCards and approved artifacts |
| Runs `/runs` | Top nav, node audit link | Inspect catalog snapshots, raw responses, jobs, quotes, confirmations, and failures |
| Settings `/settings` | Top nav | Configure and test service contracts without exposing secrets |
| Capability Drawer | Global status control | See Phase 0 deployment host/home host, M3 bridge, desktop stack, Splitter, and provider states |
| Media Lightbox | Artifact/thumbnail click | Review image/video at useful scale with seek/scrub controls |
| Command Palette | `⌘K` / `Ctrl+K` | Navigate, create, focus lanes, and run context-safe actions |

Composition references (spines win on conflict):

- [`mockups/key-project-canvas-creative-room.html`](mockups/key-project-canvas-creative-room.html) — Project Canvas and live roster before catalog fetch.
- [`mockups/key-model-voice-compare.html`](mockups/key-model-voice-compare.html) — Compare with valid, invalid, and pending voice states.
- [`mockups/key-storyboard-grid-scrub.html`](mockups/key-storyboard-grid-scrub.html) — Splitter result, segment preview, seek/scrub, and separate EXTEND action.
- [`mockups/key-trailer-quote-gate.html`](mockups/key-trailer-quote-gate.html) — Target/runtime switcher and quote/confirm separation.
- [`mockups/key-capability-drawer.html`](mockups/key-capability-drawer.html) — Available, planned, and not-checked capability states.

Desktop chrome: 48px top nav, project toolbar, contextual Canvas Layers rail, canvas,
collapsible inspector, and bottom transport strip. Modal stacks stop at one
level. A quote dialog may open over the canvas; it cannot open another dialog.

## Voice and Tone

Microcopy is direct, factual, and production-oriented. Brand posture lives in
`DESIGN.md.Brand & Style`.

| Do | Don't |
|---|---|
| `M3 Raycast bridge is offline.` | `Something went wrong.` |
| `3 of 5 voices returned. 2 failed.` | `Almost there!` |
| `DRAFT — not for Studio` | `Ready-ish` |
| `Awaiting S5 vibe approval.` | `Complete the required steps.` |
| `Quote expired. Request a new quote.` | `Please try again.` |
| `No automatic fallback. Choose a provider.` | `We switched providers for you.` |
| `Prompt hash does not match the approved prompt.` | `Provenance issue.` |
| `No model catalog returned by Raycast.` | `No models available.` when the source did not prove that |

No celebratory confetti, AI-assistant cheerleading, invented status language, or
exclamation-mark success copy. Provider errors and parse errors appear verbatim
with a plain-language location label.

## Product-Specific Spine: S0–S10 Stage Control

The transport strip always displays current stage, confidence, gate state, and
next legal action. Selecting it opens the full gate log. Visual state treatment
uses `DESIGN.md` tokens `{colors.gate-pending}`, `{colors.gate-approved}`,
`{colors.gate-quoted}`, `{colors.gate-failed}`, and
`{colors.capability-offline}`; labels remain mandatory.

| State | Meaning | Available actions |
|---|---|---|
| `BLOCKED` | Confidence below threshold or prerequisite absent | Inspect gaps, answer questions |
| `READY FOR REVIEW` | Artifact and confidence meet gate criteria | Review, approve, reject |
| `PASSED` | Operator approved or valid force-advance recorded | Enter next stage |
| `FORCED` | Operator bypassed with reason and prior confidence | Continue with persistent rework warning |
| `DRAFT — not for Studio` | Pre-S4 creative concept prompt | Compare, branch, edit downstream concept—not generate |
| `PILOT ELIGIBLE` | S4/S5 complete and S8 prompt approved | Request quote for one pilot |
| `BATCH ELIGIBLE` | Pilot prompt and pilot generation approved | Request batch quote |

Only the operator sees the Force Advance action. It requires stage, reason, and
confirmation; the system supplies prior confidence and timestamp. Agents never
receive a UI suggestion to force-advance.

## Component Patterns

Behavioral rules; visual tokens live in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
|---|---|---|
| Canvas node | Every project lane | Single click selects; double-click opens Node Focus; drag changes persisted layout only; edge ports expose legal branch/remix actions. |
| Story card | Board and Cards | One canonical beat exposes Text, Image, and Video faces. Arrow keys/buttons or face labels switch the view in place. Missing media shows its prompt placeholder; attaching media replaces only that face. |
| Stage/gate strip | Node and global transport | Opens gate log; exposes only the next legal action; Force Advance is operator-only and requires reason. |
| Inspector | Selected node | Edits user-owned fields inline; exact model output, hashes, quotes, and audit fields remain read-only. |
| Command palette | Global | Fuzzy searches surfaces and context-safe actions; Enter activates, Escape closes, results announce through `aria-live`. |
| Media lightbox | Artifact/segment | Opens one media item with provenance and keyboard/touch seek controls; Escape closes; media failure preserves metadata and error. |
| Canvas Layers rail | Board left | Summarizes Seed, Voices, Story Cards, and Media counts. It appears only on Board and does not duplicate the project view switcher. |
| Seed node | S0/Creative Room | Edits title, brief, focus, requested voice count. Run action remains disabled when M3 catalog is unavailable. |
| Live roster | Seed inspector | Fetch exact Raycast catalog; default random count 5. Reshuffle changes seed, Pin preserves a model, Add/Remove edits operator overrides. Never show unavailable desired families as selectable. |
| Model Voice card | Creative Room result | Exact Raycast label; raw text immutable. Parse state can be valid/invalid. Approve/reject/branch/remix act on stable answer ID. |
| Target prompt switcher | Model Voice/Trailer | Three peers: Sora 2 · 12s, Seedance 2.0 · 15s, Seedance 2.5 · ≤30s. Each preserves its own runtime, syntax, and draft/submit-ready state. |
| Compare workspace | 2–4 voices | Columns align title, logline, summary, image prompts, and each target teaser. Raw toggle and approval are per column. Horizontal page overflow is forbidden; smaller screens stack voices. |
| Capability badge/drawer | Global | Shows available/degraded/offline, last real check, endpoint/machine label, and affected actions. No silent provider switch. |
| Source node | Canvas | Uploads source through SvelteKit server route to hosted Splitter. Displays hash and real job state. |
| Storyboard Grid | Split result | Uses manifest order. Thumbnail hover may preview on pointer devices; click/tap always selects. Trim/merge are CSP metadata. EXTEND creates a separate generation task. |
| Seek/scrub preview | Storyboard/artifact/lightbox | Pointer/touch drag seeks; keyboard arrows step; current/total time always visible. This is review behavior, not a comment/review platform. |
| Character-sheet task | Any image intake/S6 | Offers one task with three separate output slots: front head-removed, back, close-up. Billable providers require quote/confirmation. |
| Trailer node | S8–S10 | Holds approved concept, anchors, pacing, audio arc, title device, target runtime, source methodology commit, and prompt hash. |
| Quote panel | Generation gate | Quote and Confirm are separate. Confirm binds provider, exact model, prompt hash, amount, and expiry. Expired quotes cannot submit. |
| Artifact node | Output | Shows provider/model/cost when returned, target runtime, versions, lineage, and prompt-match state. Hash mismatch blocks promotion. |
| SpecCard | Library | Immutable promoted version with Derive New Version action; never overwrite history. |

## State Patterns

### Application and capability states

| State | Treatment |
|---|---|
| Phase 0 deployment host app ready | Open last project or project picker. |
| Home-server target not yet active | Settings labels it `PLANNED`, not offline. |
| M3 offline | Creative Room Run disabled; existing captured voices remain readable. |
| Desktop offline | SwarmUI/ComfyUI actions disabled; Higgsfield/Sora remain separate explicit choices if configured. |
| Splitter offline/timeout | Source job reaches explicit failed terminal state; uploaded source remains attached for retry. |
| Provider offline | Quote/generate disabled for that provider; real error preserved. |
| Partial capability | Mark `DEGRADED`, list the exact unavailable action. |

### Creative Room lifecycle

`CATALOG FETCH` → `ROSTER READY` → `DISPATCHING` → per-voice
`PENDING | RETURNED | INVALID | FAILED` → `AWAITING REVIEW` → `SELECTED`.

The transport strip counts terminal states, not presumed successes. A run can
finish with failures. If Raycast exposes fewer models than requested, the roster
shows the shortfall before dispatch.

### Splitter lifecycle

`UPLOAD` → `QUEUED` → `RUNNING` → `COMPLETED | FAILED` → `RESULT FETCH` →
`STORYBOARD READY`. Reload resumes from the persisted job ID. CSP never invents
percentage completion when the API provides only a state.

### Generation lifecycle

`DRAFT` → `GATE BLOCKED` → `APPROVED` → `QUOTE REQUESTED` → `QUOTED` →
`CONFIRMED` → `GENERATING` → `READY | FAILED`. Quote expiry returns to
`APPROVED`, not `CONFIRMED`.

### Empty states

- New project: `Drop an idea, image, or source video.`
- No Creative Room run: `No voices yet.`
- Empty Library: `No promoted specs yet.`
- No Runs: `No captured runs yet.`
- No available M3 catalog: `No model catalog returned by the M3 Raycast bridge.`

### Surface-specific states

| Surface | Cold/loading | Empty | Error/offline | Focus/selection |
|---|---|---|---|---|
| Project Canvas | Restore project skeleton and persisted viewport | Seed-only `Drop an idea…` | Project read failure names the file/record; no blank canvas | Selected node + lineage; Node Focus dims neighbors |
| Compare | Skeleton columns only for selected stable IDs | Fewer than two compatible voices returns to canvas | Failed/invalid voices retain raw state per column | Active column and section remain keyboard-visible |
| Library | Rebuild/read index without hiding canonical cards | `No promoted specs yet.` | Index failure offers rebuild; canonical SpecCards remain untouched | Selected version opens detail/lightbox |
| Runs | Load audit rows by stable run ID | `No captured runs yet.` | Read failure preserves filter and names source | Focused row exposes raw/catalog/job links |
| Settings | Per-capability check states independently | Unconfigured capability says `NOT CONFIGURED` | Offline, timeout, auth, and contract errors remain distinct | Focused service exposes test/configure action |
| Media Lightbox | Poster/skeleton while media opens | Metadata remains if media asset is absent | Playback/load error appears beside provenance | Seek focus is visible and keyboard-operable |
| Command Palette | Results update as query changes | `No matching surface or available action.` | Search failure closes no current work | Active result announced and visibly highlighted |

## Interaction Primitives

- Single click/tap selects; double-click opens Node Focus.
- A project opens on Board inside the global Canvas area. Story, Cards, Media,
  Preview, and Export are focused projections of the same project records.
- On a story card, Text/Image/Video labels and previous/next arrows rotate the
  visible face without changing the selected beat or creating new data.
- Space-drag/two-finger pans canvas. Wheel/pinch zooms 25%–200%.
- Shift-click multi-selects up to four compatible Model Voice cards for Compare.
- Drag from an output port to empty canvas opens Branch / Remix / New Seed.
- `⌘K` / `Ctrl+K` opens the command palette.
- `Esc` closes topmost overlay, exits focus mode, or clears selection—in that order.
- `Enter` activates the focused control; Space never conflicts with canvas pan
  while a control has keyboard focus.
- Arrow keys move focus through the node-list fallback; `Shift+Arrow` extends
  multi-selection where supported.
- Undo/redo covers layout and user edits only. It never removes captured model
  output, audit events, quote/confirmation records, or generated artifacts.

Banned: hover-only required actions, page-level horizontal scroll, automatic
provider fallback, automatic gate advance in standard mode, and destructive
history replacement.

## Accessibility Floor

- WCAG 2.2 AA behavior across responsive web surfaces.
- Text contrast ≥4.5:1; focus indicators ≥3:1 using
  `{components.focus-ring}` / `{colors.focus-ring}`; state always includes text.
- Canvas exposes an `application` region plus a DOM node-list fallback in
  reading/lineage order.
- Every node announces type, title, stage/state, and available actions.
- Raw model output, hashes, quotes, and audit events remain reachable without
  pointer gestures.
- `aria-live` announces voice terminal-state changes, generation completion,
  quote expiry, and capability loss without repeating every polling tick.
- Reduced motion removes node entrance, edge-draw, and panel-slide animation.
- Seek/scrub supports keyboard arrows and exposes current time and duration.
- Touch targets are at least 44×44 CSS px on mobile review controls.

## Responsive & Platform

| Viewport | Behavior |
|---|---|
| ≥1024px | Lane rail and inspector visible; canvas is primary; Compare uses columns. |
| 768–1023px | Lane rail icons; inspector overlay; Compare uses two columns or stacked pairs. |
| 375–767px | Top-nav drawer; canvas browse/pan; inspector full-height sheet; Compare stacks voices; create/review/approve allowed. |

Page chrome must not exceed viewport width at 375, 768, or 1440px. The canvas
is an intentional internal pan surface. Mobile is a useful review/control
surface, not a promise of full desktop spatial arrangement parity.

## Inspiration & Anti-patterns

- **Storyception:** lift the spatial canvas, branch behavior, reference rail,
  image-forward nodes, and dark premium restraint. Reject its React/Gemini
  implementation and any static provider catalog.
- **Splitter Pro:** lift source context, truthful job status, numbered storyboard
  grid, preview, and dense inspector. Use the hosted OpenAPI service; do not
  pretend its current contract extends clips.
- **Directors Cut:** lift tokens, verbatim provenance, comparison, quote →
  confirm → generate, and immutable audit. Replace its wide table as the primary
  surface with Compare.
- **Pindeck:** lift gallery clarity and one-way intake. Reject live-sync coupling.
- **Review Room:** lift only easy video review and compact seek/scrub preview.
  Do not rebuild comments, collaboration, or Review Room integration.
- **Rejected:** generic AI gradients, chat-first layout, static model logos as
  catalog truth, invented progress percentages, and automatic "smart" fallback.

## Key Flows

### Flow 1 — Rough idea to varied Creative Room (Gordo, beginning a new teaser)

1. Gordo creates a project; the canvas opens with one Seed node at S0.
2. He enters a title, rough idea, and `full room` focus.
3. CSP checks the M3 capability and fetches the live Raycast catalog.
4. The roster shows five random available voices. He pins DeepSeek, reshuffles
   the others, and removes one voice he does not want.
5. He runs the room. Voice cards appear as real terminal states arrive.
6. One answer is invalid; its raw response and parse errors remain visible.
7. He selects three valid voices and opens Compare.
8. **Climax:** aligned Sora/Seedance prompt variants reveal three genuinely
   different directions, each with exact model label and provenance. He approves
   one without confusing it for a generation-ready prompt.

Failure: M3 goes offline before dispatch → roster remains visible but Run is
disabled with `M3 Raycast bridge is offline.` Existing work is not lost.

### Flow 2 — Source video to extendable segment (Gordo, refining reference footage)

1. Gordo drops a video onto the canvas.
2. Source node uploads through the server to Splitter and stores the job ID.
3. He leaves and reloads; polling resumes from the same ID.
4. A Storyboard Grid appears from the real result manifest.
5. He scrubs previews, merges two adjacent shots as CSP metadata, and trims one.
6. He selects a segment and chooses EXTEND.
7. **Climax:** CSP creates a separate gated generation task anchored to the
   observed final frame—without claiming Splitter performed the extension.

Failure: Splitter times out → the Source node reaches Failed with the real error
and Retry. No invented percentage or discarded upload.

### Flow 3 — Image intake to reusable character sheet (Gordo, locking identity)

1. Gordo drops a character image at any stage.
2. CSP asks whether to make a character sheet and links the task to S6.
3. He sees three required outputs and the selected provider.
4. A billable provider returns a quote; he confirms that exact quote.
5. Front head-removed, back, and close-up run as separate generations.
6. **Climax:** all three approved slots become one reusable Character identity
   without a low-resolution face crop from the wide image.

Failure: one slot fails → successful slots remain; only the failed slot can be
requoted/retried. Parent project gates do not force-advance.

### Flow 4 — Approved concept to pilot teaser (Gordo, after vibe approval)

1. S4 layout and S5 vibe gates show Passed.
2. At S8, Gordo opens the approved concept's target switcher.
3. He chooses Sora 2 · 12s, Seedance 2.0 · 15s, or Seedance 2.5 · ≤30s.
4. CSP recompiles the draft using the target's syntax and proven pacing contract.
5. He reviews anchors, source methodology commit, prompt hash, audio arc, and
   title device.
6. He requests a live quote, then separately confirms it.
7. One pilot generates; batch controls stay blocked.
8. **Climax:** the returned artifact attaches to the Trailer node with matching
   prompt hash and provenance, making pilot approval an informed decision.

Failure: artifact hash differs from approved prompt → red mismatch state;
promotion and batch remain blocked.

### Flow 5 — Service loss without hidden substitution (Gordo, returning later)

1. Gordo opens the Capability Drawer.
2. Phase 0 deployment host is available, M3 is offline, desktop is offline, Splitter is ready,
   and Higgsfield has a real provider error.
3. Canvas, captured runs, and local project state remain readable.
4. Actions requiring unavailable capabilities are disabled with explanations.
5. **Climax:** Gordo can decide what to reconnect or postpone with confidence
   that CSP has not spent credits or switched providers behind his back.
