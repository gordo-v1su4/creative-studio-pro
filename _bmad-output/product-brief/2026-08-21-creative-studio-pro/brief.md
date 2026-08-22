---
title: Creative Studio Pro — Product Brief
status: final
created: 2026-08-21
updated: 2026-08-22
---

# Creative Studio Pro — Product Brief

## What this is

Creative Studio Pro is a personal, canvas-first creative OS: one app where any
input — a rough idea, image, character sheet, random picture, or in-flight
project — is shaped, connected, and carried through a gated production pipeline
to a finished trailer, cold open, or first short episode.

Whenever Gordo inputs something — whether raw or developed — the system fleshes
it out and connects the pieces needed to turn it into a finished deliverable.

## Who it is for

Gordo only, for now. It is a personal production tool operated by one creative
director with AI models and specialist agents as the production team. It spans
the whole Tailnet rather than living on one machine.

## Critical runtime and platform constraints

- **Deployment** — start the CSP web app on Racknerd for Phase 0, then move
  durable hosting to the home server. The creative orchestrator can remain a
  separate Racknerd service unless later architecture work moves it.
- **Desktop only** — SwarmUI and ComfyUI image/video generation are reachable
  only through the desktop; CSP must treat that machine as a remote capability,
  never as a local dependency.
- **M3 Mac only** — the Raycast bridge is available only from the M3. All
  Raycast model discovery, creative-spurt dispatch, and verbatim capture route
  through that bridge. The bridge harvests the models Raycast actually exposes
  at run time; CSP does not hard-code provider versions.
- **Splitter service** — CSP consumes the hosted API at
  `https://splitter.serving.cloud` using its published OpenAPI/Swagger
  contract; it does not require a local M3 Splitter process.
- **Higgsfield** — remains the primary image and video provider today, reached
  through its existing service/CLI contracts rather than the desktop runtime.
- **Sora 2 deadline** — API access closes at the end of September 2026. CSP must
  maximize Sora 2 handoffs for early teaser and trailer exploration before the
  shutdown. It uses the existing Directors Cut bridge contract, not a new
  integration.
- **Dedicated creative orchestrator** — a separate creative-only agent, not the
  daily Hermes profile, with reusable producer, board-artist, cutter, and
  researcher profiles for production stages.

## The product shape

The main UI is an infinite canvas: SvelteKit 5 + Svelte Flow, with
Storyception's aesthetic DNA, Splitter Pro 2's workbench, Pindeck's gallery,
and Directors Cut's editorial tokens. Video playback is WebGPU-first.

Every project moves through the mandatory super-seed2 stage map: S0 Intake, S1
Interview, S2 Brief lock, S3 Story spine, S4 Layout pass, S5 Vibe check (Nano
Banana 3x3), S6 Asset registry, S7 LIRA/plates, S8 Prompt pack, S9 Generate,
and S10 Assemble. Confidence scoring and hard gates control advancement.
Nothing generates before its gate clears, and only the operator can
force-advance.

## Hard rules

- Capture model output verbatim with provenance; never fabricate or silently
  repair it.
- Gate all generation through approve → live quote → explicit confirmation.
  Never auto-fallback. Use Raycast/free generation first, then escalate to paid
  providers.
- Use Svelte end to end, Bun for JavaScript, and uv for Python. Do not use React
  or npm.
- Do not use GPT-5.5 for agent work on this project.

## Brainstorm layer

super-seed2 deliberately has no brainstorming stage. Two systems fill that gap:

- **Directors Cut's multi-model creative room** — the Raycast bridge first
  harvests the models currently available in Raycast, then randomly rotates a
  varied subset for each initial creative spurt. Candidate voices include
  ChatGPT, Gemini, Grok, Kimi, DeepSeek V4 Flash, GLM 5.3, the newest available
  Qwen family, and Raycast's latest available Claude Haiku. Exact versions are
  never assumed: unavailable models are omitted, every run records the exact
  displayed Raycast labels, and Gordo can override the random selection. Each
  response returns a title, logline, summary, image-sequence prompt, 3x3 grid
  prompt, and teaser-trailer prompt, captured verbatim with provenance.
- **Pindeck** — remains a standalone app for collecting raw images and building
  storyboards. It pushes material one way into CSP as intake for S0, S3, or S4.
  A brainstorming and clarification moment sits between that push and the next
  pipeline stage.

## Character-sheet system

Character sheets are a first-class built-in workflow at S6 and can also launch
ad hoc from any canvas intake. When an image arrives, CSP asks, "Do you want me
to make a character sheet from this?"

Selecting Yes creates three consistent Higgsfield-spec outputs in separate
generation passes:

1. **Wide 16:9, full-body front** — person standing and facing front, with the
   head removed, on a white or light-gray background.
2. **Full-body back** — person shown from behind, head to toe.
3. **Close-up face** — tightly framed, high-resolution facial detail.

The wide and close-up views must never come from the same generation. Removing
the face from the wide view prevents CDance 2.5 from using a low-resolution
head crop.

## Donor map

| Donor | Role in CSP |
|---|---|
| super-seed2 | Logic backbone: S0–S10 stages, confidence scoring, hard gates, character/story formats, and Higgsfield production methods |
| storyception | Infinite-canvas environment, branching node behavior, reference rail, and dark premium aesthetic |
| splitter-pro2 | Source-video splitting, storyboard grid, clip preview, and extend/split interactions |
| directors-cut | Creative room, provenance schemas, approval and quote gates, spec library, review patterns, and editorial tokens |
| raycast-pro-bridge | Typed contract to Raycast models running on the Macs |
| pindeck | Standalone image collection and storyboard intake that exports into CSP |
| review-room | Visual reference only: easy video review and compact seek/scrub preview-bar interaction; no v1 dependency or integration |
| trailercraft | Trailer-specific assembly and pacing workflow patterns |
| creative-studio-os | External operations spine: digest, Linear roadmap, Discord reach, and production-team coordination |

Donor UIs retire as primary products; their repos remain services, history, and
reference material.

## Success looks like

- Any supported input reaches a trailer, cold open, or first short episode
  through one app.
- A rough idea produces five contrasting model voices on the canvas in under
  10 minutes.
- Every dollar spent on generation has a matching human confirmation.
- Donor tools can sit quietly because Creative Studio Pro has replaced the
  fragmented workflow with one coherent production OS.
