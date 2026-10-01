# Creative Studio Pro

Canvas-first creative studio: one app from rough idea → multi-model creative
room → spatial canvas → source-video split/extend → gated generation →
reusable spec library.

Founding documents (read both before writing code):

- `docs/planning/prds/prd-creative-studio-pro-2026-08-22/prd.md`
  — canonical product requirements, donor blend map, workflows, data
  model, architecture, phases.
- `docs/planning/ux-designs/ux-creative-studio-pro-2026-08-22/DESIGN.md`
  — canonical visual identity and tokens.
- `docs/planning/ux-designs/ux-creative-studio-pro-2026-08-22/EXPERIENCE.md`
  — canonical behavior, states, interactions, accessibility, and flows.
- `docs/planning/architecture/architecture-creative-studio-pro-2026-08-22/ARCHITECTURE-SPINE.md`
  — canonical architecture invariants and dependency rules.

Index: [docs/planning/README.md](docs/planning/README.md). Implementation
specs: [docs/implementation/](docs/implementation/).

Rules (inherited from creative-studio-os and the bridge):

1. Reuse over rebuild — donor repos are called, not forked.
2. No fabricated model output; answers are stored verbatim with provenance.
3. Generation is always gated: approve → live quote → explicit confirm.
4. Bun for JS, uv for Python. No npm/npx — use `bun` / `bunx` (including `bunx skills@latest` for Matt Pocock skills).
5. Do not use gpt-5.5 for agent work on this project.

Agent skills: Matt Pocock engineering set in `.agents/skills/` (see `skills-lock.json`, `AGENTS.md`). After clone: `bun install` links `.claude/skills/`. Refresh skills: `bun run skills:install`.
