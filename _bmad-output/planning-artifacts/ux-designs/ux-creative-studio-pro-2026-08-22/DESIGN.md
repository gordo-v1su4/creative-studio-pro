---
name: Creative Studio Pro
description: Canvas-first AI creative workbench. Dark editorial, image-forward, compact, provenance-visible, and gate-led.
status: draft
updated: 2026-08-22
sources:
  - ../../prds/prd-creative-studio-pro-2026-08-22/prd.md
  - ../../../../docs/UI-UX.md
  - directors-cut/src/app.css
  - storyception/app/globals.css
colors:
  surface-base: '#09090b'
  surface-raised: '#111113'
  surface-raised-2: '#18181b'
  border: '#27272a'
  border-subtle: '#202023'
  text-primary: '#fafafa'
  text-muted: '#a1a1aa'
  text-dim: '#71717a'
  focus-ring: 'oklch(0.72 0.18 195)'
  gate-pending: '#fbbf24'
  gate-approved: '#4ade80'
  gate-quoted: '#60a5fa'
  gate-failed: '#f87171'
  capability-offline: '#71717a'
  voice-1: 'oklch(0.72 0.18 195)'
  voice-2: 'oklch(0.65 0.15 175)'
  voice-3: 'oklch(0.8 0.18 85)'
  voice-4: 'oklch(0.627 0.265 303.9)'
  voice-5: 'oklch(0.645 0.246 16.439)'
  voice-6: 'oklch(0.488 0.243 264.376)'
  voice-7: 'oklch(0.696 0.17 162.48)'
  voice-8: '#d4d4d8'
typography:
  body:
    fontFamily: 'Inter, ui-sans-serif, system-ui, Segoe UI, sans-serif'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
  title:
    fontFamily: 'Inter, ui-sans-serif, system-ui, Segoe UI, sans-serif'
    fontSize: 15px
    fontWeight: '600'
    lineHeight: '1.3'
  section:
    fontFamily: 'Inter, ui-sans-serif, system-ui, Segoe UI, sans-serif'
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.3'
  meta:
    fontFamily: 'JetBrains Mono, SF Mono, Cascadia Code, ui-monospace, monospace'
    fontSize: 10px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: 0.08em
  code:
    fontFamily: 'JetBrains Mono, SF Mono, Cascadia Code, ui-monospace, monospace'
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.5'
rounded:
  none: 0px
  sm: 2px
  md: 4px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  '8': 32px
components:
  node:
    background: '{colors.surface-raised}'
    border: '1px solid {colors.border}'
    radius: '{rounded.sm}'
  node-selected:
    border: '1.5px solid var(--voice-accent, {colors.focus-ring})'
  toolbar:
    height: 40px
    background: '{colors.surface-raised}'
  top-nav:
    height: 48px
    background: 'color-mix(in srgb, {colors.surface-base} 88%, transparent)'
  focus-ring:
    outline: '2px solid {colors.focus-ring}'
    offset: 2px
---

# Creative Studio Pro — DESIGN.md

## Brand & Style

Creative Studio Pro is a serious creative workstation, not an AI showcase. The
visual thesis is **dark editorial control room**: Storyception's spatial,
image-forward canvas; Splitter Pro's dense media workbench; Pindeck's gallery
clarity; and Directors Cut's compact editorial tokens. The interface should
feel like a production desk where evidence, lineage, gates, and media are always
visible without competing with the work.

Dark mode is the product surface, not an optional theme. Hierarchy comes from
image scale, tonal layering, thin borders, typography, and spatial grouping.
Glow is restrained to selection/focus. No gradients, glass-card decoration,
fake browser chrome, oversized marketing headings, or ornamental dashboards.

## Colors

The neutral foundation inherits the verified Directors Cut tokens. Near-black
`{colors.surface-base}` is the canvas; `{colors.surface-raised}` and
`{colors.surface-raised-2}` separate nodes, inspector surfaces, and transport
controls. Borders stay thin and low contrast.

State colors have fixed meanings:

- `{colors.gate-pending}` — awaiting operator review or gate approval.
- `{colors.gate-approved}` — approved and eligible for the next action.
- `{colors.gate-quoted}` — a live quote exists but has not been confirmed.
- `{colors.gate-failed}` — a real provider, contract, or generation failure.
- `{colors.capability-offline}` — a machine/service capability is unavailable.

Model colors are dynamic lane identity, not a static provider roster. On each
catalog snapshot, the UI assigns a model family a deterministic token from
`{colors.voice-1}` through `{colors.voice-8}`. The same family keeps the same
color within a project; exact displayed model labels remain text. Unknown or new
families consume the next palette token instead of adding inline CSS.

Color never carries status alone. Every state includes a label, icon/shape, or
textual explanation. Text contrast must meet 4.5:1 and focus indicators 3:1.

## Typography

The interface uses a compact system-sans body and a mono metadata layer.
`{typography.body}` carries descriptions and controls. `{typography.title}` is
for node and panel titles. `{typography.meta}` is uppercase and tracked for
model labels, hashes, runtimes, stage IDs, provider names, and audit data.

Headings are roman, never italic. The product has no decorative display font.
Prompt text and raw model output use `{typography.code}` only when fixed-width
alignment helps; ordinary prose stays in the body face.

## Layout & Spacing

The base scale is 4px with a 12px workbench gutter. Desktop composition has a
48px top nav, 40px project toolbar, collapsible 220px lane rail, infinite
canvas, collapsible 320px inspector, and bottom transport strip. Nodes default
to 320px width; media/storyboard nodes may expand fluidly.

Density is intentional. Related controls use 4–8px gaps; card interiors use
12–16px; lanes and major panels use 20–32px. Empty space separates workflows,
not individual metadata rows.

At 768–959px the lane rail collapses to icons and the inspector becomes an
overlay. At 375–767px the canvas remains internally pannable while page chrome
stays within the viewport. Mobile prioritizes review, status, and approval over
large spatial composition.

## Elevation & Depth

Use tonal layering and border contrast, not shadows, for normal hierarchy.
Nodes sit on `{colors.surface-raised}` over `{colors.surface-base}`. Selected
nodes receive the target voice/lane border and a restrained 8px low-opacity
halo. Popovers and dialogs may use `{colors.surface-raised-2}` plus one subtle
shadow. No stacked card shadows or floating-island treatment.

Edges express lineage. Default edges use `{colors.border}` at 1px. Selected
lineage uses the target lane accent at 1.5px. Failed or mismatched provenance
uses `{colors.gate-failed}` plus a textual warning.

## Shapes

The product inherits Directors Cut's 2px radius. Inputs, buttons, chips, nodes,
and panels are crisp. A 4px radius is reserved for dialogs, lightboxes, and
large media frames. Pills appear only where the shape communicates a compact
status or model-family chip. Never round every surface by default.

Media follows its container radius. Thumbnails are edge-to-edge within nodes;
metadata and controls sit below rather than over decorative image gradients.

## Components

- **Canvas node** — `{components.node}`. Image/content first, metadata second,
  actions last. Selected state uses `{components.node-selected}`.
- **Seed node** — title, brief excerpt, focus, harvested roster, and one compact
  Run Creative Room action.
- **Model Voice card** — dynamic family accent, exact Raycast label, parse state,
  title/logline/summary, target-prompt tabs, hash badge, raw toggle, and gate
  actions. Raw output is visually read-only.
- **Stage/gate strip** — full-width left border plus explicit stage ID and state.
  Pending/approved/quoted/failed use the fixed state tokens.
- **Capability badge** — machine/service name, available/degraded/offline label,
  last check, and no decorative green dot without text.
- **Storyboard Grid** — edge-to-edge numbered thumbnails, mono duration labels,
  selected segment border, and compact seek/scrub preview.
- **Trailer target tabs** — Sora 2 · 12s, Seedance 2.0 · 15s, Seedance 2.5 · ≤30s.
  Runtime and draft/submit-ready state are always in the tab label/header.
- **Quote panel** — provider, exact model, target runtime, prompt hash, cost,
  expiry, and separate Confirm action. Quote and confirm are never one control.
- **Inspector** — details for one selection. User-authored fields may edit
  inline; verbatim/audit fields never become editable.
- **Command palette** — `⌘K`/`Ctrl+K`, full keyboard operation, active result
  uses `{colors.focus-ring}` without introducing another accent.
- **Seek/scrub preview bar** — compact frame-accurate review interaction derived
  from Review Room/Directors Cut; visual review only, not a rebuilt review app.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Extend verified Directors Cut and Storyception tokens | Invent a new visual system mid-component |
| Let media, lineage, and gate state create hierarchy | Add gradients, glass cards, or generic AI sparkle |
| Assign dynamic model colors deterministically | Hard-code the currently available Raycast roster |
| Keep exact model labels and hashes visible in mono text | Replace provenance with logos or friendly aliases |
| Use compact controls with complete interaction states | Hide primary actions behind hover-only affordances |
| Show real empty/offline/failure language | Invent counts, progress, availability, quotes, or costs |
| Keep billable confirmation visually separate from quote | Collapse quote and generation into one CTA |
| Use a 2px tool-like shape language | Turn every control into a rounded pill |
| Preserve one visible focus ring and keyboard order | Depend on canvas pointer gestures alone |
