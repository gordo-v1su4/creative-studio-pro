---
name: oneshot-image-prompts
description: Write finished, copy-paste image prompts in the ONE SHOT cinematic house look — photoreal character sheets, hero key art, arenas, cities, realms, props, creatures, VS plates and posters — for GPT Image 2 / 2.5, Seedream and any other image generator. Use this skill whenever the user asks for an image prompt, a character sheet, a character design, a fighter, a location, an arena, a stage, a world, a city, a poster or key art, or uploads a reference image and wants variations of it — and also whenever they describe a character or place and clearly want to generate it, even if they never say the word "prompt".
---

# ONE SHOT // Image Prompts

> ONE SHOT Community Edition — built by **CodeOneshot / ONE SHOT**. Free to share.

Turn a one-line ask into a finished image prompt in a single consistent
cinematic look. The user pastes the output straight into their generator.

**The whole system in one line: pin the look, free the person.** The lighting,
grade and camera blocks are byte-identical on every prompt; the face, build and
details change. That is what makes forty separate generations look like one film.

## Do this first, every time

1. **Route the request** using the table below.
2. **Read the reference files** the route points at. Never write a prompt from
   memory of this file alone — the blocks must be pasted verbatim.
3. **Write the prompt** in the fixed block order.
4. **Run the self-check** in `references/settings-and-qc.md` silently, fix, send.

| The ask | Template | Read |
|---|---|---|
| person, fighter, ninja, warrior, portrait | T1–T6 | house-look, templates |
| creature, mech, mount | W7 | house-look, templates |
| weapon, prop, vehicle, artifact | W6 | templates |
| arena, stage, room, hall, temple, interior | W1 (+W5 interior) | house-look, templates |
| landscape, realm, wasteland, mountain | W1 | house-look, templates |
| city, district, skyline, settlement | W4 | house-look, templates |
| "keep this place consistent across shots" | W3 | templates |
| two fighters, VS art, fight key frame | V1 / V2 | templates |
| poster, title card, roster tile | P1 / P2 | templates |
| an image was uploaded | T5a/T5b (people), W8 (places) | templates |

If an ask fits no template — a crowd, a ritual, a key frame — do not refuse.
Take the closest camera treatment and apply the spine below.

## The spine (holds on every subject)

1. **Photoreal, practical, photographed.** A live-action film still or location
   plate of something physically built. Name materials, not adjectives.
2. **One accent colour**, with a hex, and a stated rule for where it may appear.
   Everything else desaturated.
3. **One signature shape.** A character has a silhouette hook; a location has a
   landmark you could draw from memory. If you can't name it, the design isn't
   finished — invent a stronger one.
4. **Scale, ritual, decay, and exactly one impossible thing.**
5. **Dark and readable.** Deep shadows that still hold texture. The test is
   always "can I read the eyes" or "can I read the floor".

## House Rule #1 — the headless frontal panel

**Body reference first.** If a source is explicitly selected as the body reference,
write "Match the body shape and proportions exactly like image N." Omit height,
weight, build and figure descriptions everywhere, including SUBJECT and the
CHARACTER hand-off. Do not repeat physique labels printed on the source sheet.
If no body reference is selected (including headshots only), create a detailed
body from the facts. A portrait is not a body reference.

**Headless means omit the head, not zoom to fill.** Keep the front figure at
full-person scale and its original vertical placement. Omit everything above
the collarbones, leaving empty background above the shoulders. Do not enlarge
the body or move it upward to make the collarbones touch the panel's top edge.
Front and rear share a full-person scale and foot baseline for layout only;
the original body reference, when present, still controls anatomy. This rule
overrides any template wording that suggests filling the panel vertically.

In every character sheet, the **frontal** panel shows the collarbones down with
**no head in it**, keeping the full-person scale and placement. The close-up panel owns the face.
Output this wording:

> PANEL CENTRE: front view at full-person scale and its original vertical
> placement. Omit the head above the collarbones without enlarging or shifting
> the body. Leave plain background above the shoulders. Feet visible, standing
> at rest, arms relaxed, weight even.

Repeat it inside LOCKS. Rear and three-quarter panels keep their heads. Drop the
rule only if the user asks for the head kept.

## Two look blocks, never mixed

- People, creatures and props on a backdrop → the **studio blocks**.
- Anything with an environment → the **environment blocks**.

Both live in `references/house-look.md`, along with light recipes R1–R8 for
scene work beyond the studio plate. Paste whichever applies byte-identical;
only the accent colour and hex change. Never "improve" the wording per
character — drift there is what breaks a roster's consistency.

## Output format

1. One short line naming what this is (type, subject, accent hex).
2. The prompt in a **single** fenced code block. Block order for characters:
   SHEET, SUBJECT, COSTUME, SILHOUETTE, LIGHTING, GRADE, CAMERA, REALISM, LOCKS.
   For locations: CAMERA, SCENE, LANDMARKS, FLOOR, ATMOSPHERE, LIGHT, FINISH.
   The negative list is the **final line inside that same block**, as
   `AVOID: ...` — never a separate block, so the user copies once.
3. SETTINGS: one short line — model, size, quality.
4. QC: how many to run and what to screen for on *that* image.
5. FILENAME: `[NAME]_[type]_v[n]`.
6. For characters and locations, the video hand-off line in its own small block.

No preamble, no explanation of choices, no offers. A one-line ask is a complete
brief: invent every missing detail rather than interrogating the user. Ask at
most one question, and only when the sheet type is genuinely ambiguous.

## Hard rules

- **Environments**: always EMPTY of people; four named landmarks with positions;
  size in metres; dark readable floor; exactly one impossible element. On a
  reverse angle, swap left and right and say so.
- **Never output** these words: 8K, hyperrealistic, ultra detailed, masterpiece,
  octane, unreal engine, beautiful, perfect features.
- **No text inside an image** except on posters and title cards, where it is
  quoted exactly, positioned, and one to five words.
- **Originality**: if the user names a real game or film character, build an
  original design in that lineage — keep archetype, element, colour and weapon
  class; invent the face, mask geometry, armour and hardware. Never put a
  franchise name, logo or copyrighted emblem in the prompt. Say in one line that
  it's an original design in that style.
- **Continuity**: never reuse an accent hex, silhouette hook or identity
  material already used earlier in the conversation. Vary casting hard — age 20s to 70s, build, origin,
  asymmetry. A character's home location inherits their accent hex, one
  material and a trace of their element.

## Reference files

- `references/house-look.md` — the studio blocks, the environment blocks, the
  floor and four-landmark rules, and light recipes R1–R8. **Read on every job.**
- `references/templates.md` — T1–T6 (characters), W1–W8 (worlds, props,
  creatures), V1–V2 (two-fighter), P1–P2 (posters, tiles).
- `references/continuity-and-formats.md` — the ledger, casting diversity,
  aspect ratio by destination, state variants, the hands-and-weapons fix.
- `references/settings-and-qc.md` — model settings, debug matrix for fixing a
  bad generation, the video hand-off format, and the pre-send self-check.
- `references/doctrine.md` — the standing house rules: no hero shots,
  physical realism over glow, restraint over spectacle, and where brand colours
  are allowed. These outrank prettiness.

## When a generation came out wrong

Use the debug matrix in `references/settings-and-qc.md`. Name the likely cause
in one line, then output the corrected prompt. Don't re-explain the house look.
