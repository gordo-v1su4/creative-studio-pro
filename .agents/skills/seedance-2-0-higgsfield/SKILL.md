---
name: seedance-2-0-higgsfield
description: The current (2026-10-02) prompt format for ByteDance Seedance 2.0 as used on Higgsfield. Use when writing, reviewing or fixing any Seedance 2.0 video prompt, or a Trailer House teaser targeted at Seedance 2.0.
---

# Seedance 2.0 on Higgsfield — prompt format

**Current as of 2026-10-02.** This is the format to use from now on for Seedance 2.0. Seedance 2.5 is a different model line with a different format (see `seedance-2-5-higgsfield`). Never mix the two.

The app reads `format.md` in this folder word for word and puts it into the Agent's master prompt (`prompts/trailer-house.md`) whenever the target is Seedance 2.0.

## Model and surface

| | Seedance 2.0 on Higgsfield |
|---|---|
| Length | 4–15 s per generation |
| Aspect | 16:9, 4:3, 1:1, 3:4, 9:16, 21:9 |
| References | up to 9 images, 3 video clips, 3 audio files in one generation |
| Resolution | 480p and 720p (Enhanced Fast for iteration); 1080p on the standard model |
| Multi-shot | real cuts inside one generation; 10 s is the sweet spot for multi-shot, and fewer than ~10 s starves the beats |

## The format

Plain prose with numbered shots. No section headings, and no bracketed timeline (`[0–3s]` blocks render worse on Western surfaces; timestamps belong only as hints inside a shot).

1. **Shot structure first.** The opening line reads `Total: 12s / 3 shots / 16:9`, followed by one sentence of global style (genre, look, film texture, what must not appear) and any atmosphere that persists ("rain throughout, every shot").
2. **References** (when attached): one line each, `@Image_1 = <exact name>: <its one job>`.
3. **Shots**: each starts its own line with `Shot 1:`, `Shot 2:`, … Use two or three shots for 10–15 s (about 4–6 s each), never more than five. Inside each shot, in this order: the subject and one action with a clear endpoint, the setting and light, one camera move, then its sound. Dialogue goes in quotes in the shot where the speaker is on screen. End each shot on its completed beat, and let the next shot open the new one.
4. **Last line:** `SFX:` the ambience and specific sounds, then `no music` unless music is wanted. Put negatives here too ("no 3D, no cartoon, no on-screen text").
5. For one unbroken take, write `single continuous take, no cuts` and no shots. Unlabeled long prompts come out as one continuous take.

Camera terms the model reads directly: dolly in, truck left, arc shot, push in, pull back wide, handheld follow, crane up, orbital move. Give each shot one camera idea and vary the framing between shots.

## Reference rules (operator-verified on Higgsfield)

- Every reference image is at least 2K on the long edge. Use one clean sheet per character, and give the exact sheet name every time; the sheet carries the look.
- Attach an environment reference for every location in the clip. Never attach an annotated reference.
- Refer to each character by the same exact name throughout. No pronouns or stand-ins for anything declared.
- On Higgsfield multi-shot, a face holds best when it's in the first shot.

## House bans (all projects)

House bans (all projects): the banned-word list in the app's prompt linter (`src/lib/domain/prompt-lint.ts`), plus each project's `PROMPT-RULES.md`. Never write a banned word, not even as a negative ("no X" still primes it). Describe glowing signs and city light by their color and source instead.

## Sources (checked 2026-10-02)

- Higgsfield, *Seedance 2.0: Complete Prompting Guide* (modified 2026-08-28): https://higgsfield.ai/blog/seedance-prompting-guide (shot structure first, numbered shots).
- Higgsfield, *Generating with Seedance 2.0*: https://higgsfield.ai/blog/generating-with-seedance-2-0 (subject → setting → camera → mood; 9 / 3 / 3 references; camera terms).
- Higgsfield help center, *How to use Seedance*: https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-seedance.
- ByteDance and fal multi-shot grammar, as collected in directors-cut `skillset/imported-skills/related-local/seedance-2.0/references/multishot-grammar.md` (Shot N labels, 4–6 s per shot, no bracketed timeline on Western surfaces).
- Operator review rules: Blood Rush `files/trailer/PROMPT-RULES.md`.
