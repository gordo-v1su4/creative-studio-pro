# Agent Handoff — Creative Studio Pro

For any agent picking up this repo.

## Read first (in order)

1. `README.md` — rules.
2. `docs/PRD.md` — what we're building and why; the donor map in §5 tells you
   exactly which existing repo owns which pattern.
3. `docs/UI-UX.md` — how it looks and behaves.

## Source material on disk

| Donor | Location | Inspect |
|---|---|---|
| storyception | M3 Mac: `/Users/robertspaniolo/Documents/Github/storyception` | `components/storyception/flow-canvas.tsx`, `components/storyception/nodes/*`, donor report at `/root/storyception_donor_report.md` (Racknerd) |
| splitter-pro2 | Racknerd: `/root/Github/splitter-pro2` | `docs/screenshot.webp`, `backend/src/backend/config.py` (SPLITTER_* tuning), `frontend/` |
| trailercraft | M3 Mac: `/Users/robertspaniolo/Documents/Github/trailercraft` | subagent report in Hermes session cache (2026-08-21, deleg_9965d17e task 2) |
| directors-cut | M3 Mac: `/Users/robertspaniolo/Documents/Github/directors-cut` | `src/app.css` (`--dc-*` tokens), `schemas/`, `content/comparisons/` |
| raycast-pro-bridge | M3 Mac: `/Users/robertspaniolo/Documents/Github/raycast-pro-bridge` | `TOOL_CONTRACT.md`, `src/contracts/tools.ts`, `script-commands/` |
| creative-studio-os | Racknerd: `/root/Github/creative-studio-os` | `docs/ARCHITECTURE.md` |

Remote access: `ssh robertspaniolo@100.107.134.15` (M3 Mac over Tailscale).
Note: non-login SSH shells lack bun/node — use `$HOME/.bun/bin` or `zsh -lc`.

## Definition of done per phase

Every PR: names the PRD workflow + UI-UX section it implements, passes type
checks, browser-verified at 1440px and 375px, and stores no fabricated model
output. Phases and acceptance criteria are in `docs/PRD.md` §11.

## Kickoff

PRD §13 lists the remaining open decisions. First build task is Phase 0:
SvelteKit 5 scaffold + Svelte Flow canvas shell + Seed node + local
persistence, per PRD §11 acceptance criteria.
