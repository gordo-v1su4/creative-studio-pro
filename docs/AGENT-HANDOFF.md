# Agent Handoff — Creative Studio Pro

For any agent picking up this repo.

## Read first (in order)

1. `README.md` — rules.
2. `docs/planning/prds/prd-creative-studio-pro-2026-08-22/prd.md`
   — canonical requirements; the donor map tells you exactly which existing
   repo owns which pattern.
3. `docs/planning/ux-designs/ux-creative-studio-pro-2026-08-22/DESIGN.md`
   and `EXPERIENCE.md` — canonical visual and behavioral UX contracts.
4. `docs/planning/architecture/architecture-creative-studio-pro-2026-08-22/ARCHITECTURE-SPINE.md`
   — canonical build invariants; every epic/story must cite governing ADs.
5. `gordo-v1su4/super-seed2` — authoritative production methodology. Read its
   `AGENTS.md`, `pipeline/creative-stages.md`, and the active production-type
   playbook before changing story, teaser, prompt, or generation behavior.

## Donor repos (GitHub)

Inspect these repositories on GitHub; do not rely on machine-local clone paths
in committed docs. Service URLs and credentials belong in `.env.local` only.

| Donor | GitHub | Inspect |
|---|---|---|
| storyception | `gordo-v1su4/storyception` (or upstream as listed in PRD) | Flow canvas and node components |
| splitter-pro2 | `gordo-v1su4/splitter-pro2` | OpenAPI job API, scene detect, clip assets |
| trailercraft | `gordo-v1su4/trailercraft` | Trailer assembly patterns |
| directors-cut | `gordo-v1su4/directors-cut` | Creative Room tokens, schemas, comparisons |
| raycast-pro-bridge | `gordo-v1su4/raycast-pro-bridge` | `TOOL_CONTRACT.md`, tool contracts, script commands |
| creative-studio-os | `gordo-v1su4/creative-studio-os` | Ops read model and external coordination |
| super-seed2 | `gordo-v1su4/super-seed2` | Stages, gates, Seedance prompt format, production types |

## Definition of done per phase

Every PR: names the canonical PRD workflow + UI-UX section it implements,
passes type checks, is browser-verified at 1440px and 375px, and stores no
fabricated model output. Phases and acceptance criteria are in canonical PRD
§11.

## Kickoff

Canonical PRD §13 records the resolved kickoff decisions. First build task is
Phase 0: SvelteKit 5 scaffold + Svelte Flow canvas shell + Seed node + local
persistence, per canonical PRD §11 acceptance criteria.
