# Creative Studio Pro — UI/UX Specification

Version: 0.1.0 (founding spec)
Date: 2026-08-21
Companion document: `docs/PRD.md` — read both before implementing.

---

## 1. Design DNA (extracted from donors, not copied pixel-for-pixel)

### From Storyception (the aesthetic anchor)

- Dark premium creative tool: near-black surfaces, subtle dot-grid canvas
  background, thin borders, restrained glow on selection.
- Mono micro-labels (uppercase, letter-spaced, ~10px) for section headers
  and node metadata; larger confident type for titles.
- Semantic accent palette: one hue per lane/role (cyan = story/flow,
  magenta/pink = characters/identity, yellow = attention/gate, teal = media).
- Image-forward: every creative object shows its visual (keyframe, still,
  poster) before its text.
- Canvas is the home: nodes with visible connection edges, selected-branch
  highlighting, a bottom transport/timeline strip.
- Reference/character rail above the flow: identity and style references sit
  spatially above the story they constrain.

### From Splitter Pro 2 (the workbench pattern)

- Dark, minimalist, zero clutter: top bar with source context, main preview
  panel, pipeline status line (percent + what happened, e.g. "32 cuts"),
  storyboard grid below, file metadata panel right.
- Storyboard grid: numbered thumbnails with duration labels — one still per
  segment, hover/click to preview.
- Everything derives from frames; the UI shows seconds derived from fps.

### From Directors Cut (the token baseline)

- Inherit the `--dc-*` dark editorial tokens as the base theme and extend:
  compact density, 2px radius, system sans body, mono for metadata.
- Compact controls: small pill/2px-radius buttons, `text-xs`/`text-sm`,
  subtle borders over big filled CTAs (user's established preference).

### Hard anti-slop rules (Hallmark discipline)

- No invented metrics or fake counts — empty states say "No X yet."
- All colors/fonts via named tokens; no inline improvisation mid-component.
- No re-drawn fake OS/browser chrome.
- Interactive elements ship all states: default, hover, focus-visible,
  active, disabled, loading, error, success.
- Headings roman, never italic. Emphasis via weight/accent/underline.
- Responsive floor: no horizontal page scroll at 375/768px; canvas itself may
  pan internally, page chrome must not overflow.

## 2. Information architecture

One primary surface, four supporting views:

```
/                       Project canvas (THE product — default route)
/library                Promoted spec cards (table + drawer)
/runs                   Creative-room run history + audit
/settings               Bridges, services, providers, tokens (server-side)
```

Global top nav (48px, blurred near-black): brand mark, Canvas / Library /
Runs / Settings. No duplicate in-content nav. On mobile: hamburger drawer
(same pattern as Directors Cut TopNav).

## 3. The Canvas (main UI)

### 3.1 Macro layout

```
┌──────────────────────────────────────────────────────────────┐
│ TOP NAV (48px)                                                │
├──────────────────────────────────────────────────────────────┤
│ TOOLBAR: project title · +Seed · +Source · focus · zoom · ⌘K │
├──────────┬───────────────────────────────────────┬───────────┤
│ LANE     │                                       │ INSPECTOR │
│ RAIL     │           INFINITE CANVAS             │ (right,   │
│ (left,   │   dot-grid bg, pan/zoom, nodes +      │ 320px,    │
│ 220px,   │   edges; reference rail across top    │ collaps.) │
│ collaps.)│                                       │           │
├──────────┴───────────────────────────────────────┴───────────┤
│ TRANSPORT STRIP: pipeline status · gate state · timeline     │
└──────────────────────────────────────────────────────────────┘
```

- Lane rail (left): lanes for SEEDS, VOICES, SOURCES, STORYBOARD, TRAILERS,
  OUTPUT. Clicking a lane focuses/filters the canvas. Collapses to icons.
- Inspector (right): full detail for the selected node — editable where the
  data model allows editing, verbatim-read-only where it must not be edited
  (model answers are NEVER editable; copy, branch, approve/reject only).
- Transport strip (bottom): current pipeline stage, gate state
  (e.g. "AWAITING APPROVAL — 3 of 5 voices captured"), media timeline when a
  Source/Trailer node is selected.

### 3.2 Canvas behavior

- Dot-grid background, pan (space-drag / two-finger), zoom (pinch/wheel,
  25%–200%), ⌘K quick-actions, minimap at >8 nodes.
- Nodes: rounded-2px cards on the grid; drag to arrange; edges show lineage
  (which answer came from which brief, which artifact came from which prompt).
- Auto-layout per lane: Seeds top-left → Voices fan right → Pipeline flows
  downward. User drag overrides persist per project.
- Selection: single click selects (inspector); double click opens focus mode
  (node centered, neighbors dimmed); shift-click multi-select for compare.
- Branch: drag from a card's edge port to empty canvas → branch menu
  (Re-pitch via model / Merge with… / New seed from this).
- Undo/redo for layout and user edits; model answers and audit events are
  append-only.

### 3.3 Node types

SEED node
- Title, brief excerpt, creative focus chip, model-family chips, status.
- Primary action: "Run creative room" (bridge call).
- Empty state: the only node on a new project; canvas prompts "Drop an idea."

MODEL VOICE card (one per captured model answer)
- Header: exact model label (e.g. "GPT-5.6 Luna", "Gemini 3.5 Flash",
  "Grok-4.5 Low") + family color chip + structure status (VALID / INVALID —
  invalid shows parse errors, raw text preserved).
- Body: title, logline, summary (collapsed to 2 lines each, expand affordance).
- Tabs or stacked slots for the three prompts: IMAGE SEQUENCE / 3X3 GRID /
  TEASER 12S — each with copy button and hash badge.
- Footer actions: Approve (gate), Reject (with note), Branch, Copy package.
- Verbatim rule: text renders exactly as captured; a "raw" toggle shows the
  untouched answer text.

SOURCE node
- Video thumbnail, filename, fps/frames/duration, hash.
- Action: "Detect scenes" → progress inline (percent + current stage, the
  splitter status-line pattern).

STORYBOARD GRID node
- The splitter-pro2 grid as a canvas node: numbered stills with duration
  labels, one per segment; hover plays preview; click selects segment.
- Segment selection opens inspector: start/end frames, trim handles,
  Merge-with-next, "Looks like the same shot?" merge prompt when adjacent
  keyframes are near-identical, and EXTEND.
- Extend: choose length; creates a generation task anchored to the segment's
  final frame; result returns as a new versioned segment linked by edge.

TRAILER node
- Assembled from an approved voice + selected segments/references.
- Shows the teaser-trailer prompt (screenplay or compact savage-cut form),
  anchor shot list, cadence spec, title device.
- Gate strip: APPROVED ✓ → GET QUOTE → CONFIRM & GENERATE — each step
  explicit, costs visible before confirm. No auto-fallback badge always shown.

ARTIFACT node
- Versioned media (image grid, clip, teaser render) with thumbnail/poster,
  provider + model + cost badges, version switcher (prev/next + dropdown),
  lightbox on click.
- Provenance badge traces to source prompt hash; mismatch = red flag state.

### 3.4 Gate visuals

The human-approval gate is a first-class visual, not a button buried in a row:

- Pending approval: yellow left-border strip on the card, "AWAITING REVIEW".
- Approved: green state, unlocks Quote.
- Quoted: teal state with cost + expiry countdown.
- Generating: progress in transport strip.
- Ready: artifact appears attached to the node that caused it.
- Failed: red state with the real provider error verbatim.

### 3.5 Compare mode

- Select 2–4 Model Voice cards → Compare: side-by-side columns, one per model,
  sections aligned (TITLE/LOGLINE/SUMMARY/prompts), exact labels pinned on top,
  approve/reject per column.
- This replaces the Directors Cut 1990px-wide horizontal table as the primary
  comparison surface; the table view remains available in /runs for audit.

## 4. Design tokens (extends `--dc-*`)

Base: inherit Directors Cut `:root` (--dc-bg #09090b, --dc-bg-elev,
--dc-border, text scale, --dc-radius 2px, --dc-font-mono). Add:

```
--csp-canvas-bg:        dot-grid pattern over --dc-bg
--csp-lane-seed:        neutral zinc
--csp-lane-voice-chatgpt:  cyan family
--csp-lane-voice-claude:   violet family
--csp-lane-voice-gemini:   blue family
--csp-lane-voice-grok:     pink family
--csp-lane-voice-kimi:     teal family
--csp-gate-pending:     amber
--csp-gate-approved:    green
--csp-gate-quoted:      teal
--csp-gate-failed:      red
--csp-edge:             1px, --dc-border
--csp-edge-selected:    accent of target lane, 1.5px
--csp-node-w:           320px (voice/seed), grid node fluid
```

Model-family colors are lane identity, not decoration: every chip, edge, and
badge for a family uses its token. New families get a new token, never an
inline color.

Typography: system sans body 13px; mono micro-labels 10px uppercase .08em
tracking for node metadata and lane headers; node titles 14–15px / 600.
No italic headings anywhere.

## 5. Interaction inventory (each ships all 8 states)

Buttons: primary compact (Approve, Run creative room, Detect scenes),
secondary ghost (Copy, Branch, Expand), destructive (Reject — needs note or
confirm), gate buttons (Get quote → Confirm & generate — two separate
controls, never one).
Inputs: brief textarea, title, threshold tuners (scene detection), note field
on reject.
Canvas gestures: pan, zoom, drag node, drag-from-port branch, multi-select,
double-click focus.
Overlays: lightbox (media), compare mode, ⌘K palette, merge-suggestion prompt,
quote dialog (cost, provider, expiry, confirm).
Feedback: pipeline status line (splitter pattern: "100% — 32 cuts detected"),
toast only for copy actions; generation progress lives in transport strip, not
toasts.

## 6. Motion

- Under 3 primitives: node fade/scale-in (150ms), edge draw on new lineage,
  drawer/panel slide.
- transform/opacity only. Reduced-motion: instant swaps.
- Focus ring instant, ≥3:1 contrast, never animated in.

## 7. Responsive & accessibility

- Desktop-first workbench; at ≤960px inspector becomes overlay panel, lane
  rail collapses to icons; canvas remains pannable.
- Mobile (375px): canvas read/browse + approve/reject; creation flows
  (creative room launch) allowed but compare mode is desktop-first with a
  stacked fallback.
- All nodes keyboard-reachable (arrow-key canvas navigation), ⌘K covers every
  toolbar action; ARIA roles on canvas (application + node list fallback).
- Text contrast ≥4.5:1 on cards; family colors never the sole carrier of
  status (always paired with label text).

## 8. ASCII wireframes

Creative room in progress:

```
SEED: AFTER CHECKOUT ──┬── [VOICE · GPT-5.6 Luna      ✓ VALID]  [Approve]
   "hotel evacuation   ├── [VOICE · Claude Haiku 4.5  ✓ VALID]  [Approve]
    social thriller"   ├── [VOICE · Gemini 3.5 Flash  ✓ VALID]  [Reject…]
   focus: full room    ├── [VOICE · Grok-4.5 Low      … pending]
                       └── [VOICE · Kimi K2.7         … pending]
TRANSPORT: CAPTURING — 3 of 5 voices returned · gate: AWAITING REVIEW
```

Storyboard grid node (source split):

```
SOURCE: club-night.mp4 · 24fps · 3,214 frames
[Detect scenes ▶]  status: 100% — 32 cuts detected
┌─────┬─────┬─────┬─────┬─────┬─────┐
│ 01  │ 02  │ 03* │ 04  │ 05  │ 06  │   *selected: trim · merge? · EXTEND
│0:04 │0:11 │0:07 │0:09 │0:05 │0:12 │
└─────┴─────┴─────┴─────┴─────┴─────┘
```

Gate strip on a Trailer node:

```
TRAILER: CHECKOUT · 12s · 16:9
anchors: 3 frames from grid node · cadence 0.4–0.8s → flash frames
[ APPROVED ✓ ] → [ GET QUOTE ] → quote: 40 credits · expires 14:32
              → [ CONFIRM & GENERATE ]   (no automatic fallback)
```

## 9. Agent build notes

- SvelteKit 5 + Tailwind 4, Bun only. Existing `--dc-*` token file is the
  starting stylesheet (directors-cut `src/app.css`); extend, don't replace.
- Canvas library: Phase 0 spike — prefer a Svelte-native flow library; only
  wrap React Flow if the spike fails. Record the decision in the repo.
- Data: JSONL + file artifacts per project folder (Directors Cut pattern);
  index rebuilt on write; stable IDs.
- All generation calls through raycast-pro-bridge typed contract; UI calls
  bridge via SvelteKit server routes (token never in browser bundle).
- Every PR must state which PRD workflow and which UI-UX section it
  implements, and include a browser check at 1440px and 375px.
