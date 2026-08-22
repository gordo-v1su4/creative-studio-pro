# Agent Handoff — Creative Studio Pro

For any agent picking up this repo.

## Read first (in order)

1. `README.md` — rules.
2. `_bmad-output/planning-artifacts/prds/prd-creative-studio-pro-2026-08-22/prd.md`
   — canonical requirements; the donor map tells you exactly which existing
   repo owns which pattern.
3. `_bmad-output/planning-artifacts/ux-designs/ux-creative-studio-pro-2026-08-22/DESIGN.md`
   and `EXPERIENCE.md` — canonical visual and behavioral UX contracts.
4. `gordo-v1su4/super-seed2` — authoritative production methodology. Read its
   `AGENTS.md`, `pipeline/creative-stages.md`, and the active production-type
   playbook before changing story, teaser, prompt, or generation behavior.

## Source material on disk

| Donor | Location | Inspect |
|---|---|---|
| storyception | M3 Mac: `/Users/robertspaniolo/Documents/Github/storyception` | `components/storyception/flow-canvas.tsx`, `components/storyception/nodes/*`, donor report at `/root/storyception_donor_report.md` (Racknerd) |
| splitter-pro2 | Racknerd: `/root/Github/splitter-pro2` | `docs/screenshot.webp`, `backend/src/backend/config.py` (SPLITTER_* tuning), `frontend/` |
| trailercraft | M3 Mac: `/Users/robertspaniolo/Documents/Github/trailercraft` | subagent report in Hermes session cache (2026-08-21, deleg_9965d17e task 2) |
| directors-cut | M3 Mac: `/Users/robertspaniolo/Documents/Github/directors-cut` | `src/app.css` (`--dc-*` tokens), `schemas/`, `content/comparisons/` |
| raycast-pro-bridge | M3 Mac: `/Users/robertspaniolo/Documents/Github/raycast-pro-bridge` | `TOOL_CONTRACT.md`, `src/contracts/tools.ts`, `script-commands/` |
| creative-studio-os | Racknerd: `/root/Github/creative-studio-os` | `docs/ARCHITECTURE.md` |
| super-seed2 | Racknerd: `/root/Github/super-seed2`; GitHub: `gordo-v1su4/super-seed2` | `AGENTS.md`, `pipeline/creative-stages.md`, `pipeline/production-types/commercial.md`, `.cursor/skills/cubenatic-pipeline/SKILL.md`, `.cursor/skills/seedance-2.5-prompt-format/SKILL.md`, proven projects |

Remote access: `ssh robertspaniolo@100.107.134.15` (M3 Mac over Tailscale).
Note: non-login SSH shells lack bun/node — use `$HOME/.bun/bin` or `zsh -lc`.

## Definition of done per phase

Every PR: names the canonical PRD workflow + UI-UX section it implements,
passes type checks, is browser-verified at 1440px and 375px, and stores no
fabricated model output. Phases and acceptance criteria are in canonical PRD
§11.

## Kickoff

Canonical PRD §13 records the resolved kickoff decisions. First build task is
Phase 0: SvelteKit 5 scaffold + Svelte Flow canvas shell + Seed node + local
persistence, per canonical PRD §11 acceptance criteria.
