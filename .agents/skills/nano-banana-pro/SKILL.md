---
name: nano-banana-pro
description: The prompt format for Google's Nano Banana Pro (Gemini 3 Pro Image, nano_banana_pro on Higgsfield) — character plates, location plates, 2x2 and 3x3 shot grids, edits and anything with reference images. Use whenever a prompt is going to Nano Banana Pro, whenever someone says Nano Banana, NBP or Gemini image, or when an image prompt written for GPT Image or Seedream has to work on Nano Banana Pro instead. Nano Banana Pro is strict about how references are named, so never send it a prompt written for another model without this skill.
---

# Nano Banana Pro

This skill is self-contained: the format, the reference rules, worked examples and the linter are in this folder. It is the only Nano Banana Pro prompt format. If another file anywhere describes Nano Banana Pro differently (another skill, a repo doc, an old prompt), this skill wins: follow it, and tell the operator where the other file is so it can be deleted.

Current as of 2026-10-23, from the operator's free Higgsfield tests (2026-10-20), the Blood Rush and Drown in This River work in super-seed2, and Google's own guidance.

## Why it needs its own skill

Nano Banana Pro is an image-editing model first. References are the visual truth; the words only steer. It binds a reference to a character only through the exact words that name it, so a prompt that is fine on GPT Image (pronouns, "the man", "@Image 1", long look descriptions, a negative list) makes Nano Banana Pro swap faces, copy a whole reference into the frame, or invent a new person. Everything below exists to stop that.

## The format

Plain text. No `@` anywhere, no Markdown, no JSON.

1. **Declarations first, one per line, in upload order:**
   - `Image 1 = <exact full name> — definitive identity and wardrobe lock` (a character)
   - `Image 2 = <the place's exact name> — exact location lock` (a place)
   - `Image 3 = <the prop's name> — exact prop lock`
   - `Image 4 = <what it is> — colour grade only` (a style reference: say exactly the one thing to take from it)
   - `No image: <exact name> — <one fixed line>` for every character or place without a picture.
2. **The shot:** one opener line saying what the picture is ("A live-action film still, 16:9, photographed on a practical set."), then the shot in plain sentences. Each time a referenced character or place is named, write the name, then where it comes from: `Kai "Hoodie" Santana from image 1`. The name always comes first; that order bound best in the operator's tests.
3. **Camera, light, grade** in positive words: lens in millimetres, height, framing, the key light and its source, the palette, film stock and grain.

That's the whole prompt. No layout instructions, no negative list.

## The rules

- **Never `@`.** References are `Image 1`, `Image 2`… in upload order (the first upload is image 1). `@Image_1` is Seedance syntax.
- **Exact names, every time.** No pronouns, no first name alone, no stand-in for a person (man, woman, guy, figure, people) or a place (room, building, interior, location). Declare an extra as `No image: …` and use that name.
- **Never describe what a reference already shows.** Face, hair, wardrobe, a location's colours or light: describing them re-lights or redesigns the reference. The reference carries the look.
- **One job per reference.** A grade or composition reference copies everything unless the declaration limits it: `Image 3 = the rain grade — colour grade only; take only the colour from image 3`.
- **Reference order is priority, and it biases framing.** For a character plate or close-up, the character first, the location second, with a tight framing verb ("Kai "Hoodie" Santana from image 1 fills the centre of the frame"). For an establishing shot, the location first and accept some softness on the character. For a pure location, attach no character at all.
- **Positive words only.** Name what you want. Nano Banana Pro follows negatives unreliably and a negative plants the word. Never write a banned word in any form.
- **Text in the picture** only when the shot needs it, quoted exactly, with its position: a sign reading "VIDEO HAVEN" above the entrance.
- **Photoreal by naming the physical thing:** "a live-action production still photographed on a practical set", real materials and wear, a 24/28/35/50 mm cinema lens, restrained film grain, practical-light halation. Name the era when it matters.
- **Single plates beat sheets.** One full-frame still per generation hits photoreal far more reliably than a sheet of diagrams and frames, which drifts to concept art.

## Grids (2x2 and 3x3)

- Square only: 2x2 for up to four shots, 3x3 for five to nine. A 3x2 of 16:9 panels is 8:3, not 16:9.
- The prompt is one plain opener, then the shots in order:
  ```
  Create a 3x3 grid of nine cinematic film stills from one scene.
  Shot 1. …
  Shot 2. …
  ```
- No layout or border instructions: the model fills the grid edge to edge on its own. Spare cells are a closer angle on an earlier shot, never black.
- Never call it a storyboard (the model draws sketches).
- Each shot names its characters exactly, with `from image N`. Architecture, prop positions, costume, apparent age and light direction hold across the cells.

## Building a location (the reference ladder)

Ask for the smallest useful change per prompt. Never ask one prompt to invent a hero view, reverse angles, continuity and a finished layout at once.

1. **Geography master:** one full-frame 16:9 photograph of the empty place, the camera well back in a corner like a careful real-estate photographer, at least three walls and every door, counter and aisle readable.
2. **Coverage, one view at a time:** attach the accepted master as image 1 and ask for one new view (the desk, the entrance, the back corner). It is a reframing of the accepted place, not a new one.
3. **Targeted correction:** feed the accepted image back and change only the wrong element.
4. **Character in place:** exactly two references, the character (image 1) and the place (image 2).
5. **Promote only approved images.** A rejected result never becomes a reference.

When an edit keeps inheriting something unwanted, start a fresh chain from the best accepted image instead of piling on instructions.

## Higgsfield settings

| | `nano_banana_pro` |
|---|---|
| References | up to 14, in `medias[]` with `"role": "image_references"` |
| Resolution | 1k, 2k (default, iteration), 4k (finals and grids) |
| Aspect | 16:9 for plates and grids; 21:9 is the closest to CinemaScope (2.35:1 letterboxes) |

Run two to four generations of a promising prompt before rewriting it, and change one instruction at a time. Open every result at full size before promoting it.

**Nano Banana 2 / Lite are different models.** They address references by file name in the prompt (`image_0.png` is the first upload) with `"role": "image"`, and Lite is 1k only. Never put that syntax in a Pro prompt, or this skill's syntax in theirs.

## Lint

```
bun scripts/lint-prompt.ts prompt.txt --target nano_banana
node scripts/lint-prompt.ts prompt.txt --target nano_banana --pack blood-rush
```

Zero errors is the bar. The rules, and why a stand-in word breaks identity, are in `references/lint-rules.md`. If you can't run code, check by hand: no `@`, declarations present, no pronouns, no stand-ins, no partial names.

## Using a prompt written for another model

To move a GPT Image or Seedream prompt (for example from `oneshot-image-prompts`) onto Nano Banana Pro:

1. Replace the subject description with declarations for the attached references.
2. Cut every sentence that describes what a reference already shows.
3. Turn the `AVOID:` line and any other negatives into positive wording, or drop them.
4. Replace every pronoun and stand-in with the exact declared name, `from image N` on each reference.
5. Keep the light, grade and camera words: those carry over.
6. Lint with `--target nano_banana`.

## Examples

Lint-clean, in `examples/`. Copy the shape, never the names or premise.

- `character-plate.md`: a character close-up on a location, two references.
- `location-master.md`: the geography master of an empty place, one grade reference.
- `grid-3x3.md`: a nine-shot grid from one scene, two characters and a place.

## Hand it over

The prompt in one fenced code block, then one settings line: model, resolution, aspect, and the files in upload order (image 1 = …, image 2 = …).
