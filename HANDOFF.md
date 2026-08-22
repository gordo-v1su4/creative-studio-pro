# HANDOFF — Creative Studio Pro

Last updated: 2026-08-22. Companion repo: `gordo-v1su4/raycast-pro-bridge`.

## What this branch is

SvelteKit app for the S0–S1 Creative Room: live M3 catalog harvest, seed + Voice canvas, and verbatim reply pull through the local Raycast bridge. No fabricated model labels, counts, or replies.

## Run it

```bash
# 1. Bridge (required)
cd ../raycast-pro-bridge
RAYCAST_BRIDGE_TOKEN=dc-e2e-session-20260815-01 \
DIRECTORS_CUT_PATH="$HOME/Documents/Github/directors-cut" \
bun src/server.ts
# listens on http://127.0.0.1:8787

# 2. App
cd ../creative-studio-pro
# .env.local must have:
#   CSP_PROJECT_ROOT=.../creative-studio-pro/data/projects
#   CSP_M3_BRIDGE_URL=http://127.0.0.1:8787
#   CSP_M3_BRIDGE_TOKEN=<same token>
bun run dev -- --port 5174
```

Open `http://localhost:5174/`. Token stays on the SvelteKit server only.

## Proven capture path (do this)

`run_concept_capture` / AppleScript / root-search typing **pastes the brief into Raycast file search**. Do not use it.

Official bridge next step after `create_comparison_run`:

1. `prepare_concept_capture` — prompt on clipboard + `~/.raycast-pro-bridge/active-capture.json`
2. In **Raycast Beta**, Tab from empty root search → **Quick AI** (composer, not Search Files)
3. ChatGPT lane: GPT-5.6 Luna (or slash `/Sora 2 - ChatGPT`)
4. Paste the prepared brief, send, wait, **Paste Response**
5. Raycast Script Command: **Capture Active Run — ChatGPT**
6. New Chat (`⌘N`), model **Claude Haiku 4.5** (or `/Sora 2 - Haiku`), repeat
7. **Capture Active Run — Claude**
8. CSP `reconcile_creative_room` (page polls ~3s)

CSP `start_creative_room` now **prepares only**. It does not call `run_concept_capture`.

## Last successful run

- Project: `01a027bb-ac8d-7a53-b5b3-f8ffc5fbf0e0`
- Bridge run: `20260822-070629-untitled-creative-spurt`
- Room: **succeeded · 2 valid · 0 invalid · 0 pending**
- ChatGPT → **THE FIRST CUT** (valid)
- Claude → **INSPECTOR** (valid)
- Answers: `directors-cut/content/comparisons/20260822-070629-untitled-creative-spurt/answers.jsonl`

Claude first refused the meta test brief (“A first test brief, now edited inline…”). A follow-up that the meta edit *is* the premise produced INSPECTOR. Persist that verbatim; do not rewrite it.

## Layout (CSP)

| Area | Path |
|---|---|
| Commands | `src/lib/application/gateway.ts` |
| M3 client | `src/lib/adapters/m3-bridge.ts` |
| Store | `src/lib/adapters/project-store.ts` (`data/projects/`, gitignored) |
| Gates / roster | `src/lib/domain/gates.ts`, `roster.ts`, `schemas.ts` |
| Canvas | `src/routes/+page.svelte`, `src/lib/ui/nodes/*` |
| APIs | `src/routes/api/projects/**`, `api/capabilities` |

## Bridge tools CSP calls

`get_model_catalog` · `create_comparison_run` · `prepare_concept_capture` · `get_concept_capture_status` · `read_concept_answers`

`run_concept_capture` exists on the bridge (shortcuts / computer-use drivers). Leave it unused from CSP until an opener can prove agent chat is open (AX composer + not Search Files / No Results / CURRENT IDEA in the search field).

## Do not

- Paste the brief into Raycast root search
- Invent catalog labels or repair model text
- Commit `.env.local` or `data/projects/`
- Treat pre-S4 teasers as Studio-ready (DRAFT)

## Next

- Land companion PR on `raycast-pro-bridge` (`get_model_catalog`, `read_concept_answers`, capture-lib guards) so harvest works against published main
- Import remaining Shortcuts only if customized to *your* agent openers — stock “DC Open Sora 2 *” scripts still type into root search
- Optional: Raycast agent hotkeys / aliases so capture does not depend on Quick AI Tab
