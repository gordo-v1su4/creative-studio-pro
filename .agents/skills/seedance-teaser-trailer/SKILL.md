---
name: seedance-teaser-trailer
description: Turns ONE input image (a single frame, a character sheet, or a grid/storyboard of panels) into a complete teaser trailer for an invented Netflix-style show: an original title, a hidden twist shown through one visual contradiction, a soundtrack, and a finished, lint-clean Seedance 2.0 or 2.5 prompt in the house format. Use whenever someone gives an image and wants a teaser, a trailer, a fake-show concept, or "make a Netflix trailer from this", even if they just say "make a teaser from this frame", "turn this storyboard into a trailer" or "what show could this be". Also use when someone wants a Seedance prompt built around inventing a concept and a twist from a reference image rather than from a written scene.
---

# Image-to-Seedance Teaser Trailer

One image in; a show concept and a Seedance prompt out. Same structure and creative depth every time.

This skill is self-contained. The Seedance formats in `references/` are exact copies of the `seedance-higgsfield` skill's, and `scripts/` holds the operator's linter. If another file anywhere describes a teaser or a Seedance prompt differently, this skill wins.

## Inputs

- `image` (required): one image. A single frame, a clean character sheet, or a grid of panels.
- `model` (optional): Seedance `2.5` (default) or `2.0`.
- `seconds` (optional): 12 for 2.5 (4–30 allowed), 10 for 2.0 (4–15 allowed, 10–15 for three shots).
- `aspect` (optional): 16:9 (default), 9:16, or any the model supports.
- `genre_hint` (optional): nudges the concept ("horror", "crime", "sci-fi"). Without one, infer it from the image's mood.

## The process

### 1. Read the image

Decide what kind of reference it is, because it changes the prompt:

- **Clean character sheet:** it carries the look. The prompt never describes the character's face, hair or clothing.
- **Grid or storyboard, or a single moody frame:** it doesn't hold a look the way a sheet does. Lock the look once, in the reference's declaration line after the dash (the grid exception), and nowhere else. A grid's panels are candidate beats: use the strongest three to five, never all of them, and add "Render every shot as full-screen moving footage; the grid itself never appears."
- **Offer, once:** a dark still makes the video model invent whatever the shadows hide. If the image is moody or partial, offer to make a clean identity sheet first (the `nano-banana-pro` or `oneshot-image-prompts` skill) and use that as `@Image_1`. Don't block on it: write the teaser either way.

Then pull out:

- **The lead:** invent a full name (first and last) and use it exactly, every time. Supporting characters get full names too.
- **The place:** name it and pin it with four landmarks: a centre floor feature, a left vertical, a right structure, a far end at a distance in metres, plus the floor material (dark and readable). That's what keeps one corridor the same corridor across hard cuts.
- **Text, numbers, signage** in the image: plot hooks (a door number, a date).
- **Recurring objects:** motif candidates. One becomes the signature object.

### 2. Invent the concept

- **TITLE:** one to three words, tied to the signature object or something visible in the image.
- **Logline:** one sentence: who, the threat, what they want, what happens if they fail.
- **The twist:** exactly one impossible thing, shown as a single visual contradiction (the lead's own face on a missing poster, a duplicate of the lead in the background, a clock that resets). Never explained, never narrated. The teaser ends on the unanswered question. Restraint: if two spectacular ideas compete, cut one.
- **The accent colour:** one hex, and it appears only on the contradiction. Everything else is desaturated around the grade. The eye then finds the twist without a word of explanation. Write it positively ("the only yellow in the teaser, #E8D44D, is the missing poster") and count out the rest ("Count of other yellow objects: zero").
- **The signature object** appears in all three acts.
- **Two or three alternate titles.**

Within one conversation, never reuse a title, an accent hex, or a twist type from an earlier teaser.

### 3. The soundtrack

Concrete instrumentation and dynamics ("warped half-time trap pulse with a reversed choir, rising through the escalation"), and the drop-out: the music cuts completely on the contradiction, and the title lands in silence or on one final sound. Place sound the way the chosen format says: in the timeline at its moment for 2.5, inside each shot plus the closing `SFX:` line for 2.0.

### 4. Three acts on the format

| Act | 2.5 (timeline sections) | 2.0 (shots) |
|---|---|---|
| Setup: the lead, the place, slow build | first section, 2–3 written shots | `Shot 1:` |
| Escalation: faster cuts, rising tension | middle section, one written shot per cut | `Shot 2:` |
| Twist, then the title on the drop-out | last section: the contradiction, `Hard cut to black.`, `Title: "<TITLE>"`, the final sound | `Shot 3:` ending on the white title card in silence |

For 2.5, every cut is its own written shot with `Hard cut.` between them. Fast cutting with too few written shots makes the model pad with filler. For 2.0, three shots, one action and one camera move each, at 10–15 seconds.

Camera doctrine: a real camera at a real height, no hero shots or low-angle worship, one camera idea per shot, and the twist lands mid-motion (the lead still moving) before the hard cut, never on a held pose.

### 5. Write it in the format

Follow `references/format-2-5.md` or `references/format-2-0.md` exactly. In short:

- **2.5:** the opening line `Create a <N>-second, <aspect> cinematic live-action <genre> teaser for "<TITLE>."`, then REFERENCE AND CONTINUITY (declarations, continuity locks), STORY AND TONE, the timeline, VISUALS AND SOUND.
- **2.0:** `Total: <N>s / 3 shots / <aspect>`, one global style sentence, the declarations, `Shot 1:` to `Shot 3:`, the `SFX:` line.
- Declarations first: `@Image_1 = <the lead's full name> — definitive identity lock` (with the look after the dash only for a grid or moody frame), `No image: <name> — <one line>` for the place, the signature object if it matters, and every other character.
- Then only the exact declared names. No pronouns, no first name alone, no "the man" or "the building".
- Positive palette, counted exclusions, and never a banned word, not even as a negative.

### 6. Lint and fix

```
bun scripts/lint-prompt.ts teaser.txt --target seedance
```

(`node` works too.) Fix until zero errors. If you can't run code, check by hand against `references/lint-rules.md`.

## Output

Three blocks, in this order, with no preamble:

1. `## The Concept`: title, logline, the twist (one line on what the contradiction is and what it implies), the accent hex and where it appears, two or three alternate titles.
2. `## The Seedance Prompt`: the prompt in one fenced code block, ready to paste.
3. `## Notes`: one settings line (model, seconds, aspect, 720p or higher, and `@Image_1` = which file, in upload order); one QC line (run two or three; reject any where the contradiction doesn't read at a glance or the lead's face drifts after a cut); the filename `<TITLE>_teaser_v1`; and one optional variation offer.

## Example

`examples/nine-floors-2-5.md`: a lint-clean 12-second Seedance 2.5 teaser from a grid of a violet-haired man in a red apartment corridor. Copy the shape, never the names, premise or motifs.
