---
status: accepted (2026-10-25)
---

# The app's copies of the ONE SHOT skills are its own and may fork from the vault

The five ONE SHOT Community Edition skills (`live-action-studio`, `oneshot-image-prompts`, `ghost`, `fresh-idea-community`, `ghostsuno`) are copied into this repo and become the Agent's logic inside the app: how it writes reference specs, references, image prompts, keyframes, video prompts, fresh ideas and score prompts. The operator's own skills (`seedance-higgsfield`, `nano-banana-pro`) are not part of the app's logic, so video prompts follow Ghost rather than a second Seedance format. Changes for the app are made to the app's copy and are not pushed back to the global skills in the Hermes vault, and vault updates are not pulled in automatically. This reverses the earlier rule that the repo's copies are read-only mirrors kept in sync by `skills:sync` and a drift test. We chose a fork because the app needs one stable, tested standard that changes only when the app changes, while the global skills keep serving every other tool and project.
