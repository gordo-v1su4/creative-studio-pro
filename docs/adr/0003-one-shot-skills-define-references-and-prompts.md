---
status: accepted (2026-10-25)
---

# The ONE SHOT skills define every reference and prompt, written from an approved spec

Prompts written freely by the Agent drifted: names changed between shots, the same look line was pasted into every shot, and sheets made by different recipes did not match. From now on the app's copies of the ONE SHOT skills (ADR 0004) set the one standard for character, location and prop references, image prompts, 2×2 keyframes and video prompts, in every project. The Agent first writes a spec (a shot spec, or a reference spec for a reference), the operator approves it, and only then is the prompt written from it to the standard; references are tagged the way Ghost tags them (`image 1 = <exact name>`), a QC check runs, and the operator approves every send with its references in attach order and its predicted cost. A prompt edited by hand afterwards is marked and kept. Existing pictures become source images and are never attached to shots; the reference ONE SHOT makes from them is the look from then on. Stills are made with GPT Image 2.5 at 2K on paid credits, because its sheets come out consistent run after run. We chose this over keeping the old per-project recipes (inconsistent) and over letting the model write prompt text with no approved spec in front of it (drift).
