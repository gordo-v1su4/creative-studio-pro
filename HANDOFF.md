# HANDOFF — Creative Studio Pro S1/S2 + Creative Room Providers

Last updated: 2026-08-22. Companion repo: `gordo-v1su4/raycast-pro-bridge`.

## What this branch is

Windows-first S1 Interview and S2 Brief lock on top of the durable CSP canvas and Creative Room. S1 records no more than five owner-decision questions per round, exact answers, all eight confidence dimensions, overall/lowest scores, and resolutions. It passes only at overall ≥80 with every dimension ≥70; a third loop below 60 persists `STALLED`. S2 stores immutable brief versions and passes only when the configured operator authenticates and locks the exact current version/hash.

## Native Windows run

Use PowerShell, not WSL, Git Bash, or macOS commands.

```powershell
# Bridge
Set-Location ..\raycast-pro-bridge
$env:RAYCAST_BRIDGE_TOKEN = '<bridge-token>'
$env:DIRECTORS_CUT_PATH = '<absolute-directors-cut-path>'
bun src/server.ts

# CSP (second PowerShell)
Set-Location ..\creative-studio-pro
$env:CSP_PROJECT_ROOT = '<absolute-project-data-path>'
$env:CSP_RAYCAST_BRIDGE_URL = '<bridge-base-url>'
$env:CSP_RAYCAST_BRIDGE_TOKEN = '<same-bridge-token>'
$env:CSP_OPERATOR_ID = '<operator-id>'
$env:CSP_OPERATOR_TOKEN = '<operator-credential>'
bun run dev -- --port 5174
```

`CSP_M3_BRIDGE_URL` and `CSP_M3_BRIDGE_TOKEN` remain supported aliases. Prefer the host-neutral names above. All tokens remain server-only.

## Temporary Kimi provider

Kimi is the temporary default for completing the remaining BMAD epics. Raycast remains an explicit optional provider and never becomes an automatic fallback.

Set `KIMI_API_KEY`, `KIMI_API_BASE`, and `KIMI_MODEL` in your local `.env.local` (git-ignored) before starting the bridge. The bridge uses the OpenAI-compatible chat-completion endpoint, sends the text-only/no-tools story contract, and persists the verbatim answer plus hashes inside the same durable comparison-run folder. A restart reads the terminal result and never resubmits it. Never commit keys or service URLs.

## Windows Raycast capture contract

1. CSP calls `prepare_concept_capture`. The bridge runs `directors-cut-prepare-automated-capture.ps1`, atomically records the exact roster and prompt hashes, and copies a structured prompt beginning with the text-only/no-tools guard.
2. Run **CSP Show Active Capture** and **CSP Copy Active Prompt**. Use its exact next label and Agent; do not infer either from an older run.
3. With Computer, open persistent Raycast AI Chat using physical `Ctrl`, `Ctrl`. Start an empty chat, type `/`, type the exact model or Agent name, press `Enter`, verify the visible header, and verify automatic extension discovery is off. `Search Files`, `No Results`, and Root Search are never composers or fallback targets.
4. Paste/send the prepared prompt once. Wait for a terminal text response and use Raycast's visible native Copy Response action to copy the complete last reply.
5. Run **CSP Confirm Active Model** with the exact label and visible header, then **CSP Capture Last Text Reply** with the exact label. The commands fail closed on stale prompt/roster hashes, wrong labels, unconfirmed headers, empty replies, or duplicates.
6. Repeat for remaining lanes, then CSP reconciles `get_concept_capture_status` + `read_concept_answers`. Matching is exact-label only; raw text and SHA-256 are preserved unchanged. Restart reuses the same active state without resubmitting completed lanes.

`run_concept_capture` deliberately rejects Windows GUI automation because opening, selecting, and copying are legal only after Computer has visibly verified persistent AI Chat and the exact header. The repo-level `.agents/skills/raycast-creative-room-windows/SKILL.md` owns the complete operator workflow. No capture chat may browse, invoke extensions, or generate image/video media.

## macOS compatibility

The existing Bash/AppleScript and Shortcuts drivers remain intact. On Darwin, `prepare_concept_capture` still selects `directors-cut-prepare-automated-capture.sh`; CI syntax-checks the retained capture library and runs the shared contract suite. Windows code is selected only on `win32`.

## S1/S2 API surfaces

| Operation | Route | Rule |
|---|---|---|
| Record S1 round | `POST /api/projects/:id/interview` | Expected version, 1–5 complete Q/A, eight exact dimension scores |
| Save S2 brief version | `PATCH /api/projects/:id/brief` | S1 passed; every methodology brief field required |
| Lock current brief | `POST /api/projects/:id/brief` | Bearer operator auth plus current brief version/hash |

Canonical records live in each project ledger and reconstruct identically after restart. The browser is a projection; it never supplies the approval identity.

## Persistent Windows example

The live example project is `The Midnight Archive`, project id
`01a02aa1-3f1e-75b3-b882-48f237813bfc`, under the configured
`CSP_PROJECT_ROOT`. Its ledger reconstructs at S2 `PASSED`, confidence 88, brief
v1 locked by `gordo`, with two exact-label Creative Room replies.

The accepted image examples live beside that ledger in `assets/`. The asset
folder contains three Nano Banana Pro 2K 16:9 plates plus `manifest.json` and a
visual `README.md`. The manifest records the Higgsfield Hearted-assets quality
bar, the Unlimited-on observation, immutable SHA-256 values, and the rejected
UI-heavy generation. These are persistent project examples, not promoted
Library artifacts; promotion remains a later epic.

## Verification

```powershell
# CSP
bun test
bun run check
bun run build

# Bridge
bun run verify
```

Do not paste prompts into Root Search, fuzzy-match Raycast labels, commit environment secrets/project data, skip S1, or lock S2 without the authenticated current brief.
