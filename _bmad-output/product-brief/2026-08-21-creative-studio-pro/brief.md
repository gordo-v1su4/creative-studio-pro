---
title: Creative Studio Pro — Product Brief
status: draft
created: 2026-08-21
updated: 2026-08-21
---

# Creative Studio Pro — Product Brief

## What this is

A personal, canvas-first creative OS. One app where any input — a rough idea,
an image, a character sheet, a random picture, or an in-flight project — is
shaped, connected, and carried through a gated production pipeline to a
finished deliverable: a trailer, a cold open, or a first short episode.

## Final goal (user-stated)

Whenever Gordo inputs something — however raw or however developed — the
system flushes it out and connects the pieces that need connecting to make it
a final trailer, cold open, or first short episode.

## Who it's for

Gordo only, for now. Personal production tool. But it is not a single-machine
app: it spans the whole Tailnet.

- **5090 PC** — ComfyUI image/video generation muscle.
- **M3 + M2 Macs** — Raycast bridge (multi-model ideation, free-first
  generation).
- **Dedicated orchestrator agent** — a separate creative-only agent (not the
  daily Hermes instance) running the pipeline, with distinct creative profiles
  per production stage (producer, board artist, cutter, researcher pattern
  from creative-studio-os).

## The shape of the product

The main UI is an infinite canvas (SvelteKit 5 + Svelte Flow, Storyception's
aesthetic DNA). Every project moves through the super-seed2 mandatory stage
map — S0 Intake, S1 Interview, S2 Brief lock, S3 Story spine, S4 Layout pass,
S5 Vibe check (Nano Banana 3x3), S6 Asset registry, S7 LIRA/plates, S8 Prompt
pack, S9 Generate, S10 Assemble — with confidence scoring and hard gates:
nothing generates before its gate clears, and only the operator can
force-advance.

## The brainstorm layer (super-seed2's gap)

super-seed2 deliberately has no brainstorming. That space belongs to:

- **Directors Cut's multi-model creative room** — one brief fanned out to
  many model families via the Raycast bridge (ChatGPT, Claude, Gemini, Grok,
  Kimi), each returning title, logline, summary, image-sequence prompt, 3x3
  grid prompt, and teaser-trailer prompt, captured verbatim with provenance.
- **Pindeck** — stays a standalone app (pindeck.dev + self-hosted Convex);
  used to collect raw images and assemble them into storyboards, then **push**
  that material into Creative Studio Pro as intake for S0/S3/S4.
  [ASSUMPTION] The push is a one-way export (Pindeck → CSP), not live sync.

## What gets blended in (donor map, condensed)

| Donor | Role in CSP |
|---|---|
| super-seed2 | Logic backbone: S0–S10 stage map, gates, confidence scoring, character-sheet + storytelling formats, higgsfield-skills (LIRA, CINEDANCE, ACTING), proven production examples |
| storyception | Canvas environment + aesthetic (dark premium, node cards, reference rail, 2x2→3x3 variant expansion) |
| splitter-pro2 | Source-video split: scene detection → storyboard grid → preview → extend clips |
| directors-cut | Creative room, comparison/capture schemas, approval gate, quote→confirm→generate, spec library, `--dc-*` tokens |
| raycast-pro-bridge | Typed contract to Raycast models on the Macs |
| pindeck | Standalone intake: image collection → storyboard → push into CSP |
| review-room | Frame.io-style video playback/review organization for assembled outputs |
| trailercraft | Trailer assembly workflow patterns |
| creative-studio-os | External ops spine: digest, Linear roadmap, Discord reach |

Donor UIs retire; repos remain as services, history, and reference.

## Hard rules

- Verbatim capture with provenance; nothing fabricated.
- Generation always gated: approve → live quote → explicit confirm. No
  auto-fallback. Raycast/free first, paid providers escalate.
- Svelte only, no React. Bun for JS, uv for Python. No npm.
- No gpt-5.5 for agent work. No spoofing Raycast Pro.

## Success looks like

- Any input type reaches a finished deliverable through one app.
- Idea → five model voices on canvas in under 10 minutes.
- Every generated dollar has a matched human confirm.
- The donor tools stay retired because the OS actually replaced them.

## Open questions / assumptions to correct

1. [ASSUMPTION] CSP itself runs as a local web app reachable over Tailscale;
   the orchestrator agent lives on Racknerd (studio profile) — confirm host.
2. [ASSUMPTION] Pindeck → CSP push is one-way export, format TBD (board JSON
   + image URLs).
3. [ASSUMPTION] Review Room integration is ingest of its review links/embeds
   for assembled cuts, not a rebuild of review inside CSP — confirm.
4. [ASSUMPTION] First-class deliverable set is {trailer, cold open, first
   short episode}; music videos and commercials ride the same pipeline but
   are not launch scope — confirm.
5. [ASSUMPTION] Character sheets arrive via intake (image/Pindeck) and get
   formalized at S6 Asset registry using super-seed2 formats — confirm.
