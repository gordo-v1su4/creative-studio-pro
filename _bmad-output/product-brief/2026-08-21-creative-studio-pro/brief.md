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

- **5090 PC** — ComfyUI image/video generation (back burner, wants ASAP hookup).
- **M3 + M2 Macs** — Raycast bridge (multi-model ideation, free-first
  generation); **Higgsfield** is the primary video/image provider right now.
- **Sora 2** — API closes end of September 2026. CSP must maximize Sora 2
  handoff for short creative chunks before shutdown. This is a time-sensitive
  first-class output lane. [ASSUMPTION] Sora 2 is accessed through the
  existing directors-cut bridge contract, not a new integration.
- **Dedicated orchestrator agent** — a separate creative-only agent (not the
  daily Hermes instance) running the pipeline, with distinct creative profiles
  per production stage (producer, board artist, cutter, researcher pattern
  from creative-studio-os).

## The shape of the product

The main UI is an infinite canvas (SvelteKit 5 + Svelte Flow, Storyception's
aesthetic DNA mixed with Splitter Pro 2's workbench, Pindeck's gallery, and
Directors Cut's editorial tokens). **WebGPU-first for video playback.**
Every project moves through the super-seed2 mandatory stage
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
  [CONFIRMED] The push is a one-way export (Pindeck → CSP), not live sync.
  A brainstorming/clarification moment sits between the push and the next
  pipeline stage.

## The character-sheet interaction

Consistent, reusable character sheets are a first-class system, not a side
effect of generation. The user inputs an image (any path: upload, Pindeck
push, drop on canvas) and the system asks: **"Do you want me to make a
character sheet from this?"**

Yes triggers the Higgsfield-spec character sheet format:

1. **Wide 16:9, full-body front** — person standing, facing front, no head
   (head removed), white/light-gray background.
2. **Full-body back** — the reverse side, head to toe.
3. **Close-up face** — face detail, tight framing, high resolution.

All three images are consistent across runs (same person, same lighting,
same style every time). The system does not mix wide and close-up into the
same generation — pulling from a wide shot into a face-crop has been a
recurring failure. Close-up is a separate generation pass.

[ASSUMPTION] The character-sheet interaction is a built-in workflow, not a
separate app. It lives at S6 Asset registry in the stage map but can be
triggered ad-hoc from any canvas intake.

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
2. [CONFIRMED] Pindeck → CSP push is one-way export with a
   brainstorming/clarification moment before the next pipeline stage.
3. [ASSUMPTION] Review Room integration is ingest of its review links/embeds
   for assembled cuts, not a rebuild of review inside CSP — confirm.
4. [CONFIRMED] First-class deliverable set is {trailer, cold open, first
   short episode}; music videos and commercials are later.
5. [ASSUMPTION] Sora 2 handoff goes through the existing directors-cut bridge
   contract — confirm.
6. [ASSUMPTION] Character sheets arrive at the character-sheet interaction
   via any intake path (image upload, Pindeck push, raw image drop); the
   system recognizes the input and asks "Do you want me to make a character
   sheet from this?" — confirm scope.
