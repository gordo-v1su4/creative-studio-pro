---
name: seedance-higgsfield
description: The one prompt format for ByteDance Seedance 2.0 and Seedance 2.5 video on Higgsfield, with the operator's naming rules and the linter that checks them. Use whenever you write, review or fix a Seedance video prompt of any kind (a teaser, a trailer, a shot, a music-video clip, an image-to-video animation), whenever a prompt uses @Image_1 or @Audio_1, or for anything sent to Higgsfield's seedance_2_0 or seedance_2_5 jobs.
---

# Seedance on Higgsfield

Updated: 2026-10-23

This skill is self-contained: the formats, the rules, the run lessons, worked examples and the linter are all in this folder. It is the only Seedance prompt format. If another file anywhere (another skill, a repo doc, an old prompt) describes Seedance differently, this skill wins: follow it, and tell the operator where the other file is so it can be deleted.

## 1. Pick the model

| | Seedance 2.0 | Seedance 2.5 |
|---|---|---|
| Length | 4–15 s; 10 s is the multi-shot sweet spot | 4–30 s, whole seconds |
| Aspect | 16:9, 4:3, 1:1, 3:4, 9:16, 21:9 | the same, plus adaptive |
| References | up to 9 images, 3 videos, 3 audio | up to 30 images (each ≤ 4K), 10 videos, 10 audio (video and audio 30 s total each); 1–8 distinct subjects is the stable range |
| Resolution | 480p, 720p on Enhanced Fast; 1080p on standard | 480p is always a draft |
| Format | plain prose, `Shot 1:` labels, `SFX:` last line | opening line + four sections, `[00:00–00:04] — SECTION` timeline, `Hard cut.` between shots |
| Format file | `format-2-0.md` | `format-2-5.md` |

The two are different model lines. Never mix their formats or numbers in one prompt. With no model named, use 2.5.

## 2. Write the prompt

1. Read the format file for the model and follow it exactly. Creative Studio Pro pastes the same file into its Agent's master prompt, so the app and this skill never disagree.
2. Declare everything first, one per line: `@Image_1 = <exact full name> — <its one job>` for each reference, `No image: <exact name> — <one fixed line>` for every other character and place. Upload order is tag order.
3. From then on, call each one only by its exact declared name. Never a pronoun, a first name alone, or a stand-in ("the man", "the building"). This is the rule that keeps faces on the right characters; see why at the end of `references/lint-rules.md`.
4. Never re-describe a referenced character: the sheet carries the look. A storyboard grid is the one exception: its look goes in its declaration line, after the dash, and nowhere else.
5. One written shot per cut, one action and one camera move per shot, each sound at the moment it happens.
6. Positive palette. To keep something out, count it ("Count of green elements after 00:04: zero"); never repeat "no green", and never write a banned word even as a negative.
7. Lint it (section 3). Fix every error, then send.

Read before writing:

- `format-2-0.md` / `format-2-5.md`: the format, word for word.
- `references/multishot-grammar.md`: how cuts work, shot budgets, timestamps, failure fixes.
- `references/run-lessons.md`: reference, audio and writing rules verified on real runs.
- `references/lint-rules.md`: every linter rule, how the linter reads declarations, the per-project rule packs.
- `examples/the-delivery-man-2-5.md` (2.5, 30 s, storyboard-grid reference) and `examples/the-last-ferry-2-0.md` (2.0, 12 s): lint-clean prompts. Copy their shape, never their names, premise or motifs.

## 3. Lint

```
bun scripts/lint-prompt.ts prompt.txt --target seedance
node scripts/lint-prompt.ts prompt.txt --target seedance --pack blood-rush
```

Run it from this folder (or give the full path). Zero errors is the bar. Warnings (`re-description`, `single-shot`) mean look again. If you can't run code, check the prompt by hand against the table in `references/lint-rules.md`: declarations present, no pronouns, no stand-ins, no partial names, no `@Image 1` with a space, no banned words.

Project bans: a project's own rules (Creative Studio Pro reads `PROMPT-RULES.md` in the project's files) can switch on a rule pack, like `blood-rush`, and quote extra banned words. Pass them with `--pack` and `--ban`.

## 4. Hand it over

The prompt in one fenced code block, then one line of settings: model, seconds, aspect, resolution, and which file goes in which `@` slot, in upload order.

## Sources (checked 2026-10-02 unless noted)

- Higgsfield, *Seedance 2.0: Complete Prompting Guide* (modified 2026-08-28): https://higgsfield.ai/blog/seedance-prompting-guide
- Higgsfield, *Generating with Seedance 2.0*: https://higgsfield.ai/blog/generating-with-seedance-2-0
- Higgsfield, *Seedance 2.5: Complete Prompting Guide*: https://higgsfield.ai/blog/seedance-2-5-prompting-guide
- Higgsfield help center, *How to use Seedance*: https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-seedance
- Seedance docs, *Prompting Guide Part 1*: https://docs.seedance.tv/en/seedance-2-5-prompting-guide
- BytePlus, *Seedance 2.5 prompt guide*: https://ai.byteplus.com/ark/docs/seedance-2-5-prompt-guide (counters over negations, audio reference limits; via super-seed2, 2026-10-20)
- Multi-shot grammar: gordo-v1su4/seedance-2.0 `references/multishot-grammar.md` (MIT)
- Operator runs: Blood Rush (2026-09) and super-seed2 music videos (2026-10)

Handle spelling: Seedance on Higgsfield reads `@Image 1`, `@Image1` and `@Image_1` alike. This skill writes `@Image_1`, `@Audio_1`, `@Video_1` because the app and the linter use that one spelling.
