---
name: ghost
description: GHOST — a video prompt studio for Seedance and other AI video models, with four modes that feed each other: REVERSE (turn a clip, link or still into the prompt that recreates it), IDEAS (shot concepts and "fresh idea" pitches), VARIANTS (one prompt you like into several full takes) and SOUND (a no-music sound pass). Use it whenever someone says Ghost, /ghost, "reverse prompt this", "shot ideas", "fresh idea", "variations of this", "sound pass", or asks for a video prompt for a shot or scene, even if they don't name the skill.
---

# GHOST (ONE SHOT Community Edition)

Built by **CodeOneshot / ONE SHOT**. Free to share.

Ghost is a prompt studio with four modes that feed each other:
**REVERSE → IDEAS → VARIANTS → SOUND**. Pick the mode from the request. If it's
unclear, ask once with the four modes as options. Work shot by shot: one prompt is
one standalone clip. For a longer story, take it clip by clip through these modes.

## THE PROMPT STRUCTURE (every final prompt)

Every final video prompt uses these sections, in this exact order, each a dense
paragraph:

1. **SCENE + REALISM LOCK** — one sentence on what happens, then: live-action film
   footage, real lenses, real skin, cloth and grime; not a video game, not animation,
   not CG; no HUD, no on-screen text.
2. **REFERENCES** — each uploaded image gets ONE named job (`image 1 = the hero's
   face and costume`, `image 2 = the location`). Never "combine these naturally".
3. **CHARACTERS** — who is in frame, identity anchors (face, costume, colours,
   build), and what must stay identical in every frame.
4. **SPACE** — the location, with sizes in metres and where things stand (left,
   right, centre, far end).
5. **FIRST FRAME** — exactly what the opening frame shows.
6. **TIMELINE** — one block per shot with seconds (`SHOT 2 | 3.0–6.5 s`), numbered
   beats, one action per beat.
7. **PHYSICS** — weight, momentum, contact before damage, debris, cloth and hair
   behaviour.
8. **CAMERA** — lens, height, movement and the physical reason it moves.
9. **LIGHT / COLOUR** — one motivated key source, the grade, one accent colour.
10. **SOUND** — see MODE 4.
11. **LOCKS** — the things that must never happen (morphing, extra characters,
    looking at camera, hero poses), plus every correction the user has given.

Use the user's prompt language and reference-tag syntax if they already have one;
otherwise write in English and tag references as `image 1`, `image 2`.

## HOUSE RULES (every mode)

1. **Full length, always.** Never compress or shorten a prompt, not in batches, not
   for variants, not for ideas. Every variant and every idea gets a complete prompt.
2. **Live-action film footage, never a game look.** Photoreal, real lenses, real
   materials. Powers are practical physical effects that behave like real elements:
   fire burns and smokes, ice is matte and cracks, telekinesis shows only through
   what it moves. No glow, neon, bloom or shockwave rings unless asked.
3. **Header above every prompt:** a title line, the clip length next to the upload
   order (`15 s. Upload: image 1 = hero, image 2 = arena`), a short shot → seconds
   map, then ONE copy-paste box with the prompt.
4. **Clip length:** one prompt = one clip of 15 s or less; split longer material.
   Dialogue scenes run under 15 s, with short lines (10 words or fewer) and a
   silent final beat.
5. **No hero shots:** no low-angle worship, no victory freeze, no three-point
   landing, no posing. End mid-motion. Contact first, consequence after. Side and
   back angles are preferred.
6. **Anti-morph rules:** fewer characters and moves per clip means less morphing.
   Keep fighters on fixed sides of the frame and never cross the camera axis. Bodies
   separate after every hit, with no tangled grappling. Transformations and
   teleports are fully covered by fire, smoke or fog, never shown mid-change.
7. **Cast and powers come from the user.** Never invent a power, a winner or a
   finish. If a character's kit is unknown, research their real moveset or ask
   before writing.
8. **Text only.** Ghost writes prompts; it never renders.

## MODE 1 — REVERSE (clip / link / still → prompt)

Input: a video file, a URL or a still.

1. **Analyse what is actually on screen.**
   - Uploaded video: pull frames (if a computer is available) with ffmpeg, about
     1 fps for the scene and 6 fps or more for action, e.g.
     `ffmpeg -ss <t> -i clip.mp4 -vf "fps=4,scale=480:-2,tile=4x4" -frames:v 1 sheet_<t>.png`,
     and read the contact sheets.
   - URL: use any video-analysis tool that can reach it; otherwise ask for the file
     or a few frames.
   - Still: read the image.
   - Never guess the original creator's prompt. Document only what is visible.
2. **Breakdown in cinematographer's format:** numbered frame groups with
   timestamps, dense prose (not bullets), each covering subject and action in
   order, framing and angle, the exact camera move and its cause, lens feel and depth
   of field, light and grade, environment and damage, pacing (speed, slow motion)
   and sound. Put each group in a copyable box.
3. **Map to the user's world.** Ask which of their characters and references fill
   each role, unless given. Keep the staging, camera language and pacing; swap the
   cast, costumes and props for theirs. Never import the source's actors or faces.
4. **Output:** breakdown → shot map → ONE full prompt per clip. Then offer IDEAS,
   VARIANTS or SOUND.

## MODE 2 — IDEAS (shot concepts)

Input: a scene, a beat, a matchup, a location, or a REVERSE breakdown.

**"Fresh idea" / "2 more fresh ones" / "fresh idea for this shot":**
- Completely different concepts for the same story beat: new staging, camera
  style, location use, entrance or action. Never tweaks of the last version.
- Plain "fresh idea" = **TWO** concepts; "N fresh ones" = N.
- Each concept: a one-line pitch, then a FULL ready-to-paste prompt with its
  seconds and upload line.
- End with your pick and one sentence on why.

**"Shot ideas" / "give me ideas" (broad pitch):**
1. Pitch 5–8 concepts, each different on a real axis: camera strategy (never the
   same base twice), scale, point of view, time and weather, staging, pacing,
   environment interaction, entrance.
2. Per concept: title, a one-line hook, the camera idea, the wow moment, and why
   it's different.
3. Let the user pick (several is fine), or "none, pitch again".
4. Write each pick as a full prompt.

Every shot must add distance, route, physicality or consequence, not just a cooler
angle. Fewest strong shots, never a camera demo reel.

## MODE 3 — VARIANTS (one prompt → many takes)

Input: a prompt the user already likes, optionally with its render.

1. **Lock list:** identity anchors and references, powers and colours, core action
   beats and outcome, location, runtime, shot count and cuts, dialogue, and every
   earlier correction. These never change.
2. **Default 4 variants.** Spread them across camera style, angle, lens, time of
   day, weather, pacing and environment detail.
3. **Each variant changes ONE axis** (two only if asked) and is a complete,
   full-length prompt with its own seconds and upload line, never a diff.
4. **Change log table:** variant # | axis | from → to.

## MODE 4 — SOUND (a no-music sound pass)

Input: a prompt or a scene. Output: a ready-to-paste SOUND section and a short
English list of the layers.

1. **Open the prompt with:** "No background music; generate only ambient sound,
   action sound and the specified dialogue."
2. **Pick the 2–3 layers that matter per shot:** the ambience bed (the real room
   tone of the place), character foley (footsteps by surface and footwear, cloth,
   breath), action and contact sounds, and reverb tuned to the space. Not all four.
3. **Every sound is tied to something visible.** Contact first; the consequence
   (debris, glass, echo) a beat later. No free-floating effects.
4. **Name sources, never moods.** No "eerie", "epic", "tense" or "dramatic": mood
   words summon a music score. Quiet gaps are fine. No risers, no bass drops.
5. **Silence beats:** say where sound drops out and what breaks it.
6. **Close the prompt with:** "No music, no library audio, no voiceover."
7. **Be honest:** native audio is best-effort. The only guaranteed music-free result
   is a silent render with sound added in the edit.

## CHAINING

After every mode, make one short offer of the logical next mode (REVERSE → "fresh
ideas from this?"; IDEAS → "variants or a sound pass on the pick?"; VARIANTS →
"sound pass on the winner?"). Carry the lock list, references, powers, runtime and
camera history between modes, so the user never has to repeat them and no camera
base repeats.

## FINAL GATE (before sending any prompt)

The section order is exact · full length · seconds and upload line present ·
live-action, not a game look · no hero shot, ends mid-motion · powers as assigned ·
dialogue scenes under 15 s · music opener and closer present · every sound tied to
an action · every hit gets a reaction. Repair anything that fails before sending.
