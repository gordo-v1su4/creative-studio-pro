---
name: live-action-studio
description: LIVE-ACTION STUDIO — give it any character name (game, anime, comic or your own) and it researches the character's real look and moveset, then writes a cinematic live-action character sheet prompt and a short video test prompt for Seedance or any video model, guarded against morphing and left-right flips. Use it whenever someone says "live-action [character]", "make [character] real", "character sheet for [character]", "test prompt for [character]", or names a character they want to bring to life on film, even if they don't name the skill.
---

# LIVE-ACTION STUDIO (ONE SHOT Community Edition)

Built by **CodeOneshot / ONE SHOT**. Free to share.

One name in, two prompts out: a live-action character sheet and a short video test.
The goal is a character who looks like a real actor in a practical costume on a film
set, not a game render.

## STEP 1 — RESEARCH (always, before writing)

If web search is available, look the character up. Never write from memory alone.
Note:
- **Look:** silhouette, signature costume pieces, colours, mask or hair, weapon.
- **Moveset:** their 4–6 most iconic real moves or powers from the source (special
  moves, signature attacks, finishers). These become the test-clip actions.
- **Personality in motion:** how they stand, walk and fight.

Tell the user in two or three lines what you found, then write.

## STEP 2 — THE CHARACTER SHEET PROMPT (image)

A three-panel sheet in the house look:

- **Panels:** LEFT a straight-on face close-up (face square to camera, head level, no tilt, looking into the lens) · CENTRE full body from the front, framed from the
  collarbones down with no head in it (the close-up owns the face) · RIGHT full body
  from behind, head included.
- **Light:** a near-white seamless background, the subject lit several stops darker
  with one large soft key from above and two narrow hard rim lights behind, almost no
  fill.
- **Grade:** desaturated near-monochrome with ONE accent colour (give it a hex), and
  say where that colour is allowed to appear.
- **Realism:** real skin pores, fabric weave, stitching, scuffed metal, sweat and
  grime; a practical costume photographed on a cyclorama; a live-action film still.
- **Translate, don't copy:** turn game shapes into real materials (leather, forged
  iron, waxed canvas, cast resin). No logos, emblems or text in the image.
- **Block order:** SHEET, SUBJECT, COSTUME, SILHOUETTE, LIGHTING, GRADE, CAMERA,
  REALISM, LOCKS, with `AVOID:` as the last line inside the same box.
- **Never write** 8K, hyperrealistic, ultra detailed, masterpiece, octane or unreal
  engine.

After the box: a SETTINGS line (model, size, quality), a QC line (how many to run
and what to reject), and a FILENAME (`[NAME]_sheet_v1`).

## STEP 3 — THE VIDEO TEST PROMPT (7 seconds)

A short test, so the user checks the character moves right before building a big
scene. Upload line: `7 s. Upload: image 1 = [NAME] sheet`.

- **One character, one location, one or two signature moves,** with seconds per
  beat. Simple tests reveal problems; busy tests hide them.
- **Live-action film footage:** real lenses, real weight, contact before damage.
  Powers are practical effects: fire that burns and smokes, ice that is matte and
  cracks, lightning that flashes for two frames. No glow, neon or bloom unless asked.
- **No hero shot:** no low-angle pose, no victory freeze. End mid-motion.
- **Sound:** "No background music; ambient and action sound only." and close with
  "No music, no library audio, no voiceover."

## THE TWO GUARDS (in every test prompt)

1. **Anti-morph lock:** the face, costume, colours and proportions stay identical in
   every frame; no melting, stretching or blending; if the character transforms or
   teleports, the change is fully covered by fire, smoke or fog and never shown
   mid-change. One character per test.
2. **Anti-flip lock:** state which side of the frame the character faces and moves
   toward, keep the camera on one side of the action line, and never mirror the
   costume (an armoured left arm stays on the left).

## WHEN A TEST COMES BACK WRONG

Ask for a frame or a description, name the likely cause in one line (too many moves,
an unlocked costume detail, a camera crossing the line), then send the full
corrected prompt, never just the changed lines.

## EXAMPLE ASKS

- "Live-action Evil Ryu"
- "Make Akuma a real person, then give me a 7-second test"
- "Sheet for Violent Ken, battle-damaged"
