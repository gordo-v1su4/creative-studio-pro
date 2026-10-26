<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->

## Workflow

Commit straight to `main` and push. No feature branches, no PRs, and no
GitHub issue or Linear ticket is needed before starting work. The specs in
`docs/` describe what to build; they are not a ticket queue to work through.

Backend and hosting URLs come from environment variables in `.env.local`
(git-ignored); never hardcode or commit them.

**Every env variable is documented before a chunk is done.** A value lives only
in BWS (`hermes_keys`) and `.env.local`/`.env`. Its name goes in `.env.example`;
secret-like names (`…KEY/TOKEN/PIN/SECRET/PASSWORD`) also go in the env → BWS
table of the Hermes vault note `04-Projects/Creative Studio Pro/README.md`, and
proxmox-home documents where it is and how it works. `bun run check:env` checks
the names (never values); it runs as the git pre-commit hook (`.githooks`, set by
`bun install`) and as a Claude Code Stop hook.

**Chunks and PRs.** This repo commits to `main` when a chunk (ticket) is complete
and verified. Repos that use PRs open one only when the whole chunk is done.

## Agent skills

### Issue tracker

Optional backlog only. Issues live in GitHub (`gordo-v1su4/creative-studio-pro`) via the `gh` CLI; create or close one only when the user asks. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles mapped to GitHub labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `CONTEXT.md` (when present), `docs/adr/`, plus `docs/AGENT-HANDOFF.md` / `HANDOFF.md` for runtime contracts. See `docs/agents/domain.md`.

### Skills install (Matt Pocock / beatsmaxxer pattern)

Canonical skills live in `.agents/skills/` (committed). Lockfile: `skills-lock.json`. After clone: `bun install` runs `skills:link` (`.claude/skills` junctions on Windows). Refresh from lock: `bun run skills:install`. Add skills: `bunx skills@latest add mattpocock/skills --copy -y --agent cursor` then `bun run skills:link`.

### Toolchain

**bun** / **bunx** for JS/TS; **uv** for Python. Never npm, npx, pip.

### The app's Agent skills (ONE SHOT, app-owned)

`agent-skills/` holds the five ONE SHOT Community Edition skills (`live-action-studio`, `oneshot-image-prompts`, `ghost`, `fresh-idea-community`, `ghostsuno`). They are the in-app Agent's logic for references, image prompts, keyframes, video prompts, fresh ideas and score prompts (ADRs 0003, 0004), read through `src/lib/server/agent-skills.ts`. **This copy is the app's own:** edit it here when the app needs a change; it is not synced from the vault and changes are not pushed back. Inside the app, Ghost replaces `seedance-higgsfield` for video prompts: Fit proposes shot specs and writes prompts with Ghost, checked by the Ghost QC (`src/lib/domain/ghost-qc.ts`) instead of the Seedance linter (V1S-375). The Teaser panel still reads the Seedance format and linter until it moves too. `agent-skills/PROMPTING-GUIDE.md` (the CodeOneshot blog condensed into rules) is read with the skills by the Prep writer and Ghost. Character sheets get a scale check when they land (`scripts/panel_scale_check.py`): the rear body laid over the headless front panel, feet on one floor line.

### Prompt skills (global)

`seedance-higgsfield`, `nano-banana-pro` and `seedance-teaser-trailer` come from the Hermes vault (`10-Infrastructure/Agent Skills/skills/`), the source of truth that Syncthing carries to every machine. `.agents/skills/` holds a copy because the app reads the Seedance formats and the linter at runtime. **Never edit the copy, and never edit `src/lib/domain/prompt-lint.ts` here:** edit in the vault, run its `sync-skills.ts`, then `bun run skills:sync` here (`--check` only reports drift; `tests/domain/skills-sync.test.ts` fails on drift when the vault is present). Installing them on a machine, and cleanup: the vault note `10-Infrastructure/Agent Skills/Prompt Skills Runbook.md`.

### Repo-specific skill

Windows Raycast Creative Room: `.agents/skills/raycast-creative-room-windows/SKILL.md`.
