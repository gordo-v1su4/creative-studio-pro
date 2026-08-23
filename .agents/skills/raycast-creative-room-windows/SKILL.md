---
name: raycast-creative-room-windows
description: Runs and recovers Creative Studio Pro Creative Room captures through native Raycast on Windows. Use when preparing a CSP story-room prompt, selecting an exact Raycast model or Agent, capturing a text-only reply, reconciling a run, or verifying restart persistence.
---

# Raycast Creative Room on Windows

Use this workflow for CSP Creative Room text capture on the trusted Windows workstation.

## Boundaries

- Use the in-app Browser for CSP and Computer for every native Raycast GUI action.
- Use PowerShell Script Commands only for state, validation, prompt clipboard, and answer capture. Never automate Raycast windows with PowerShell, Python, handles, or screenshots.
- Never use Root Search or Search Files as an AI composer.
- Never generate video. In capture chats, never generate images, browse, call tools, invoke extensions, or allow automatic extension discovery.
- Preserve exact visible model labels, Agent names, raw reply text, and hashes. Never fuzzy-match or fabricate a reply.

## Preflight

1. Verify CSP and `raycast-pro-bridge` are running from their configured native Windows roots.
2. Verify the active CSP project and run ID. Do not prepare a different or superseded run.
3. Preserve any user-accepted image still living only in Raycast history before clearing or deleting history. Do not regenerate it.
4. Run **CSP Prepare Story Room Prompt** with the exact run ID.
5. Run **CSP Show Active Capture**. Stop unless it reports `valid: true`, `guard_mode` was prepared, and the next exact label and Agent are unambiguous.

## Capture each pending lane

1. Run **CSP Copy Active Prompt** so the guarded prompt—not a previous answer—is on the clipboard.
2. Open persistent Raycast AI Chat with physical `Ctrl`, `Ctrl`. Synthetic double Ctrl is not proof; ask the user for the physical double tap only if the window does not visibly open.
3. Start a fresh, empty chat. If the composer contains any text, clear it before model selection.
4. Type `/`, type the exact `active_agent` from **CSP Show Active Capture**, then press `Enter`.
5. Visibly verify the AI Chat header equals that exact model or Agent. Verify automatic extension discovery is off. Stop on any mismatch or uncertainty.
6. Paste the guarded prompt. Confirm its first line begins `TEXT ONLY.` and submit once.
7. Wait until the assistant reply is terminal. Do not capture a spinner, partial stream, image, tool call, or extension result.
8. Verify the same exact header remains visible. Use Raycast's visible native Copy Response action to copy the complete last assistant reply; do not rely on an assumed shortcut.
9. Run **CSP Confirm Active Model** with the exact roster label and exact visible header. This command records the bounded Computer verification; never invoke it without that visible proof.
10. Run **CSP Capture Last Text Reply** with the exact roster label.
11. Run **CSP Show Active Capture**. If another lane is pending or invalid, repeat from step 1 using its exact next label and Agent. For an invalid reply, correct it through a new model reply and capture the correction; never edit raw captured text.

## Reconcile and restart proof

1. In the CSP in-app Browser, reconcile the active Creative Room run.
2. Verify every exact voice card contains the captured title, logline, hook, and 12-second text prompt; pending count must be zero. Invalid structure remains explicit.
3. Restart the bridge and CSP using their normal native Windows launch path.
4. Reopen the same project, run **CSP Show Active Capture**, and reconcile again.
5. Confirm the same run, hashes, answers, and terminal state return without duplicate capture or resubmission.

## Stop conditions

Stop without capture when the run ID, project root, prompt hash, roster hash, label, Agent/header, composer, or response completeness cannot be proven exactly. Report the rejected layer and keep the existing state intact.
