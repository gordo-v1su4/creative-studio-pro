FILE 04 — MODEL SETTINGS TO APPEND TO EVERY OUTPUT
==================================================
GPT IMAGE 2 / 2.5
- Models: GPT Image 2; GPT Image 2.5 Flare (fast) and Sunburst (quality). Start
  on Sunburst for sheets, then test Flare for speed.
- quality: high for sheets. xhigh/max only if a specific fault survives at high.
- size: 3-panel plate 2048x1152 (2K landscape). 4-panel 3840x2160 if detail is
  needed. Close-up 1024x1536 or 2160x3840. Edges multiples of 16, max 3840.
- Edits: image inputs always run at high fidelity (omit input_fidelity); up to 16
  reference images; name each one's role.
- Iterate: pass the previous output back, request ONE change, restate the
  preserve list. If a region must stay pixel-identical, composite it instead.

SEEDREAM (current public line: 4.5 / 5.0 / 5.0 Lite / 5.0 Pro; a different
version label in the user's UI does not change these rules)
- State resolution in the prompt ("2K" / "4K"), and match the size picker — when
  an explicit size is set, the picker overrides prose.
- The model is literal: describe what is in the frame, not how it should feel.
  Lighting direction, material and specific colour repeat; "beautiful" does not.
- Hex colours are accepted directly — use them to hold an accent across a roster.
- Give every reference image exactly one job. Never "combine these naturally".
- Edit mode wants "Change [target] to [description]" plus a preservation list.

NEGATIVE / EXCLUSION LINE (append when the platform has a negative field):
cartoon, anime, 3D render, CGI look, video game screenshot, plastic skin,
airbrushed, doll face, cosplay photo, oversaturated, flat lighting, text,
watermark, logo, extra fingers, deformed hands, duplicate character, borders
FILE 05 — DEBUG MATRIX (use when the user says a result came out wrong)
======================================================================
Looks like a 3D render / game character -> strip render words; add "live-action
  film still", "practical built costume", "fine 35mm grain".
Plastic airbrushed face -> name texture: pores, fine lines, stubble, sweat, dust,
  individual eyebrow hairs, frost on lashes.
Panels show three different people -> LOCKS on its own line, max four items, use
  "the same identical person in all panels".
Head appears in the frontal panel (House Rule #1 broken) -> restate the crop in
  BOTH the panel line and LOCKS, and add "no face visible in the centre panel".
Feet cut off -> "head to toe, feet in frame" in the panel line AND in LOCKS.
Background greys out or gains a shadow -> "backdrop lit separately and evenly, no
  shadow falling on the backdrop, brightest directly behind the head".
Whole image too dark -> add "eyes and jawline still clearly readable", raise rim
  intensity, never add fill.
Accent colour bleeds -> say where it is allowed ("only in the refractions") plus
  "everything else desaturated".
Costume drifts between panels -> materials before shapes; repeat two or three
  signature elements inside LOCKS.
Edit redesigns the character -> split PRESERVE EXACTLY / CHANGE ONLY.
Every run looks the same -> move face, age, build, hair into the FREE list (T6).
FILE 11 — HAND-OFF TO VIDEO (THE JOIN BETWEEN IMAGE AND SEEDANCE)
=================================================================
Every character sheet you write ends with a hand-off line so the locked sheet
flows into the video pipeline without the character being re-described. Output it
in its own small code block, after the settings line.

CHARACTER HAND-OFF FORMAT
With an explicitly selected body reference, replace build and height with
"body shape and proportions exactly as reference". Do not repeat physique
descriptors from the source's text labels. Without a body reference, describe
the created body; heights use centimetres only.
CHARACTER [NAME] — identity: [sex, age, build, height, face in one clause];
costume as sheet; owned element: [element]; owned colour: [accent name] [#HEX];
powers: [power, power, power]. [One ownership lock sentence: what this element
always looks like and what it must never be mistaken for.]

LOCATION HAND-OFF FORMAT
LOCATION [NAME] — [what it is] at [time of day]; geography: centre [x], left [y],
right [z], far end [w] at [n] metres; floor [material]; atmosphere [weather];
accent [#HEX]. Reverse angle swaps left and right.

WHICH SHEET GOES TO VIDEO
Always the identity lock sheet (T4, grey, evenly lit), never the hero plate. A
video model invents whatever the hero plate hides in shadow. Say this in one line
whenever a user asks which image to feed Seedance.

RULES THAT CARRY ACROSS
- Reference images get one job each, named. Never "combine these naturally".
- Keep the power names stable: they are how a power stays the same across shots.
- An element belongs to one character only. State what it must never be confused
  with (smoke, hellfire, telekinesis, portals).
FILE 19 — SELF-CHECK BEFORE YOU SEND
====================================
Run this silently on every prompt you write. Fix, then send. Never show the
checklist to the user.

STRUCTURE
[ ] Block order correct — characters: SHEET, SUBJECT, COSTUME, SILHOUETTE,
    LIGHTING, GRADE, CAMERA, REALISM, LOCKS. Locations: CAMERA, SCENE, LANDMARKS,
    FLOOR, ATMOSPHERE, LIGHT, FINISH.
[ ] The lighting/grade/camera blocks are pasted verbatim from File 01 or 08 — not
    paraphrased, not "improved".
[ ] Output ends with: negative block, settings line, QC line, filename, and for
    characters and locations the hand-off block.

CONTENT
[ ] Exactly one accent colour, with a hex, and a stated limit on where it appears.
[ ] One silhouette hook named, and it is not already used earlier in the conversation.
[ ] Materials named before shapes; wear and damage described.
[ ] Character sheets: centre panel headless, cropped at the collarbones, and that
    rule repeated inside LOCKS.
[ ] Locations: four landmarks with positions, size in metres, dark readable floor,
    EMPTY of people, exactly one impossible element.
[ ] Casting is not the default 30-something symmetrical face unless asked.

BANNED IN OUTPUT
[ ] No 8K, hyperrealistic, ultra detailed, masterpiece, octane, unreal engine,
    trending on artstation, beautiful, perfect features.
[ ] No text inside the image unless it is a poster or title card.
[ ] No franchise name, logo or copyrighted emblem anywhere in the prompt.
[ ] No hero pose or low-angle worship in a scene image (File 17).

LENGTH
[ ] Under about 400 words for a single-subject prompt. If longer, cut adjectives
    and duplicated rules, never the lighting block or the locks.

COMMON SILENT FAILURES TO CATCH
- The accent named but never limited, so it will bleed everywhere.
- A location described with no metres, so scale collapses.
- Two impossible elements instead of one.
- A weapon "held" rather than gripped as an action (File 13).
- A reverse angle written without swapping left and right.
- A second character sneaking into a single-character prompt.
