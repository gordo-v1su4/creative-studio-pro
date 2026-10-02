---
name: seedance-2-5-higgsfield
description: The current (2026-10-02) prompt format for ByteDance Seedance 2.5 as used on Higgsfield. Use when writing, reviewing or fixing any Seedance 2.5 video prompt, a Trailer House teaser targeted at Seedance 2.5, or anything sent to Higgsfield's seedance_2_5 job.
---

# Seedance 2.5 on Higgsfield — prompt format

**Current as of 2026-10-02.** This is the format to use from now on for Seedance 2.5. Seedance 2.5 is a different model line from 2.0. Never apply 2.0 rules or numbers to it (see `seedance-2-0-higgsfield` for 2.0).

The app reads `format.md` in this folder word for word and puts it into the Agent's master prompt (`prompts/trailer-house.md`) whenever the target is Seedance 2.5. Change the format there, and every Trailer House teaser follows it.

## Model and surface

| | Seedance 2.5 on Higgsfield |
|---|---|
| Length | 4–30 s in one generation, whole seconds |
| Aspect | any from 9:16 to 21:9 (16:9, 4:3, 1:1, 3:4, 9:16, 21:9, adaptive) |
| References | up to 50: 30 images (each ≤ 4K), 10 videos, 10 audio files (video and audio 30 s total each). 1 to 8 distinct subjects is the stable range |
| Audio | generated in the same pass as the picture |
| App job | `seedance_2_5` through the Higgsfield CLI; 480p is always sent as a draft |

## The format: an opening line and four sections

Seedance 2.5 is the structured one; 2.0 is looser. The canonical example is the operator's own Higgsfield prompt, `example-the-delivery-man.md` in this folder. It matches ByteDance's four parts (asset mapping, brief, timeline, global constraints):

0. **Opening line**: `Create a 30-second, 16:9 cinematic live-action action teaser for "THE DELIVERY MAN."`
1. **REFERENCE AND CONTINUITY**: `@Image_1 defines <name>'s exact identity…` per reference and what it must not supply, then the continuity locks (props that stay put, wardrobe, screen direction).
2. **STORY AND TONE**: a short paragraph covering who, where, what happens, the stakes, the tone, and what the performances must not do.
3. **The timeline**: sections in continuous ranges, each headed `[00:00–00:05] — THE INTERRUPTION`. Inside, short paragraphs in shot order, joined by `Cut to …`. The last section ends `Hard cut to black.` / `Title: <TITLE>` / the final sound.
4. **VISUALS AND SOUND**: the global look and optics, camera coverage rules, the exact number of slow-motion accents, the score, ambience and effects, the mix, and the dialogue rule.

### Where dialogue and sound go (placement matters)

- **Dialogue** is its own block inside the timeline section where it is spoken. A speaker line gives the name, where they are or who they speak to, and the delivery; the words go in quotes on the next line:

  ```
  LEAD ATTACKER, behind him, casually confident:
  "You gonna hand over the package?"
  ```

  Follow it with the listener's reaction ("The courier keeps drinking. No reply."). Then VISUALS AND SOUND repeats the rule: `Speak only the three scripted lines, verbatim, with natural delivery and synchronized mouths. No narration or additional dialogue.`
- **Sound effects and music cues** go inside the timeline at the moment they happen, each as its own short sentence: `The beat drops.`, `The music cuts completely. Only rain, a faint call-connection click, and the engine turning over.` The overall score, ambience and mix (`Duck the music beneath dialogue.`) go in VISUALS AND SOUND.
- **Slow motion** gets labeled moments (`FIRST MICRO SLOW-MOTION HOLD: …`, then `snap back to full speed`), and VISUALS AND SOUND states the exact count ("Exactly three brief slow-motion accents; everything else plays at full speed").
- **Music** is the project's call. THE DELIVERY MAN scores it; Blood Rush generates sound effects and dialogue only (`no music, no score`) and lays the song on in the edit, because `@Audio_1` is a rhythm guide, not the soundtrack.
- **Text on screen**: `No subtitles. Only the final title appears onscreen.`

### What the runs taught (Blood Rush, 2026-09)

- Name every character with the exact same full name every time, plus their reference.
- Write one concrete story shot per cut. With fast pacing and too few written shots, the model pads with filler; fast cutting at 15 s wanted about 20 written shots.
- "Flicker" reads as an edit strobe between cuts, so never ask for it.
- If a run is blocked by the content filter, suspect the reference images first, not the text.
- Blood Rush used a shorter variant: reference lines, one brief paragraph, `SHOT 1 (0–3 s), full speed: … HARD CUT.`, then a closing audio line. It works too, but the sectioned form above is the default.

**Alternative (Higgsfield's published long form):** labeled sections GLOBAL STYLE, SCENE, CHARACTERS, LOCATION, FIRST FRAME AND BLOCKING, Shot 1… ("Hard cut."), OPTICS, CAMERA, PHYSICS, LIGHTING, AUDIO. ByteDance's grammar also has bracket channels (`{ }` dialogue, `< >` effects, `( )` music, `【 】` on-screen text). Use one form per prompt.

## Reference rules (operator-verified on Higgsfield)

- Every reference image is at least 2K on the long edge. Never HD, chat-paste copies or upscales.
- Use one clean sheet per character, and give the exact sheet name every time. The sheet carries the look, so never re-describe hair, clothes or eyes. (A storyboard grid reference is different: DELIVERY MAN describes the courier because its reference is a grid of panels, not a sheet.)
- Attach an environment reference for every location in the clip. Locations described only in text drift.
- Never attach an annotated reference: the model draws the annotations.
- Write references as `@Image_1` with an underscore: the Creative Studio Pro linter enforces it on Seedance. Higgsfield's blog and the operator's DELIVERY MAN prompt write `@Image 1`, and both reach the model.
- Refer to each character by the same exact name throughout. No pronouns or stand-ins ("the guy", "the building") for anything declared.

## House bans (all projects)

House bans (all projects): the banned-word list in the app's prompt linter (`src/lib/domain/prompt-lint.ts`), plus each project's `PROMPT-RULES.md`. Never write a banned word, not even as a negative ("no X" still primes it). Describe glowing signs and city light by their color and source instead.

## Sources (checked 2026-10-02)

- Higgsfield, *Seedance 2.5: Complete Prompting Guide*: https://higgsfield.ai/blog/seedance-2-5-prompting-guide (the labeled-section order).
- Higgsfield help center, *How to use Seedance*: https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-seedance (limits; 2.0 vs 2.5 reference counts).
- Higgsfield, *Seedance 2.5 on Higgsfield in 2026*: https://higgsfield.ai/blog/seedance-2-5-on-higgsfield-2026.
- ByteDance's published grammar as summarized by Segmind (2026-08-12): https://blog.segmind.com/the-official-seedance-2-5-prompt-guide-bytedances-six-part-formula-explained-with-examples/ (six-part slot order, bracket channels, 4–30 s).
- Seedance docs, *Prompting Guide Part 1*: https://docs.seedance.tv/en/seedance-2-5-prompting-guide (asset mapping, continuous whole-second ranges, input limits).
- Operator review rules: Blood Rush `files/trailer/PROMPT-RULES.md`.
