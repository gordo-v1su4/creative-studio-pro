FILE 01 — THE HOUSE LOOK (NEVER EDIT PER CHARACTER)
===================================================
These three blocks are pasted BYTE-IDENTICAL into every hero-plate prompt this
GPT writes. They are the reason a whole roster looks like one film. Only the
[accent colour] and [#HEX] fields change per character.

--- LIGHTING BLOCK (HERO PLATE) ---
LIGHTING: high-key white seamless background lit evenly to near-white, brightest
directly behind the head, no shadow falling on the backdrop. Subject lit low-key
and several stops darker than the background: one large soft key above and
slightly camera-left wrapping the face and shoulders, eye sockets in shadow, no
hard shadow edge; two narrow hard rim lights behind the subject on both sides
drawing a bright outline along shoulders, head and cloak; almost no fill;
visible catchlight in the eyes.

--- GRADE BLOCK ---
GRADE: desaturated near-monochrome, [accent colour] [#HEX] as the only saturated
colour, deep shadows that still hold texture, near-white background not fully
blown out, fine 35mm film grain.

--- CAMERA BLOCK ---
CAMERA: 100mm lens, chest height, straight on, no wide-angle distortion, shallow
depth of field on the close-up panel only, full-body panels sharp head to toe.

--- REALISM BLOCK ---
REALISM: real skin pores and fine hair, real fabric weave and stitching, scuffed
metal with micro-scratches, practical built costume photographed on a cyclorama,
live-action film still.

--- IDENTITY-SHEET LIGHTING (the other sheet type) ---
LIGHTING: neutral soft even wrap-around, near-shadowless, 5600K, no colour cast,
readable skin texture, eye catchlights, no glare on hair or metal. Plain mid-grey
studio backdrop, evenly lit, thin dark dividers between panels.

WHY LOW-KEY SUBJECT / HIGH-KEY BACKGROUND
The contrast between a near-white seamless and a body several stops darker is
what makes these read as film key art instead of a generation. Never light the
subject and the background as one.

WORDS THAT HELP: live-action film still, practical built costume, real fabric,
photographed on a cyclorama, fine 35mm grain, visible pores.
WORDS THAT HURT (never output them): 8K, hyperrealistic, ultra detailed,
masterpiece, octane, unreal engine, cinematic lighting (as a bare phrase).
FILE 08 — THE WORLD LOOK (LOCATIONS, ARENAS, CITIES, REALMS)
============================================================
Characters use the File 01 studio look. Anything with an environment uses THIS
block instead. Paste it byte-identical, exactly as File 01 is pasted for people.

--- ENVIRONMENT LIGHT + FINISH BLOCK ---
LIGHT: one motivated key source named in the scene (sun through a gap, moon,
furnace mouth, lightning, a single practical lantern), everything else falling
away into deep shadow; no flat ambient fill; volumetric haze giving depth
between foreground, mid-ground and background.
FINISH: photoreal live-action film location plate, practical set build with real
stone, timber, metal and weather, atmospheric depth, subtle film grain,
desaturated grade with one accent colour, deep shadows that still hold texture.

--- THE FLOOR RULE (NON-NEGOTIABLE) ---
The fighting or walking surface is always DARK and READABLE: "exposed dark wet
stone", "packed dark earth", "soot-blackened flagstone". Never a white, bright or
cluttered floor — fighters and effects must read against it. State it explicitly
in every environment prompt.

--- THE FOUR-LANDMARK RULE (NON-NEGOTIABLE) ---
Every location gets four fixed landmarks, named with their positions, so that
every later shot of that place is consistent and every throw, launch and
high-speed move stays readable:
  CENTRE — a floor feature (carved seal, dais, drain plate, fallen mast)
  LEFT   — a vertical feature (pillar, statue, crane, standing stone)
  RIGHT  — a structure (ruined hall, arcade, containers, altar)
  FAR END — the destination or exit (gate, throne, tunnel mouth, stair)
State approximate dimensions in metres. On any reverse angle, SWAP left and right
and say so, or the model mirrors the geography wrong.

--- THE MK FEEL, IN FOUR INGREDIENTS ---
1. SCALE — build it three times bigger than realistic. Colossal, monumental,
   dwarfing a person.
2. RITUAL — the place was used for something ceremonial: carved seals, offerings,
   statues of rulers, banners, bells, a throne.
3. DECAY — it is past its peak: cracked, flooded, burned, drained, abandoned,
   bleached. Someone great was here and left.
4. ONE IMPOSSIBLE THING — exactly one element that could not exist: weapons
   hanging frozen in mid-air, waterfalls pouring upward, a bridge of floating
   rock, an army turned to salt. One per location. Two makes it fantasy kitsch.

WEATHER IS A CHARACTER: horizontal snow, ash falling like snow, rain bouncing off
stone, sea fog, dust storms, steam. It sells scale and hides model weaknesses.

EMPTY PLATE RULE: every location is generated EMPTY of people. Fighters are
placed afterwards. Always include "EMPTY of people" in the prompt and "people,
fighters, crowd" in the negative.
FILE 18 — LIGHT RECIPES BEYOND THE HOUSE PLATE
==============================================
The File 01 block is for sheets and key art. Scene and poster work needs more
range. Each recipe below is a drop-in replacement for the LIGHTING block. Keep
the grade, camera and realism blocks unchanged so everything still matches.

R1 RIM ONLY (menace, reveals, silhouettes)
Two hard rim lights from behind at shoulder height and nothing else; the front of
the subject falls almost to black, only the outline, the brow ridge and the edge
of the jaw catching light; background one stop above the subject; haze between
subject and camera.

R2 SINGLE PRACTICAL (interrogation, forge, lantern, candle)
One visible in-scene source at [position, height], warm and small; hard falloff
so everything beyond two metres goes dark; the source itself visible in frame and
slightly blown; soft shadow edges from its size, flicker implied in the haze.

R3 FIRELIGHT FROM BELOW (ruin, siege, funeral)
Warm low source below chest height flickering upward, uplighting the jaw and
brow, deep shadow in the eye sockets; cool ambient from above at a quarter of the
warm level; embers drifting through the beam.

R4 MOONLIGHT + MIST (mountains, temples, snow)
Cold hard key from high behind, silvering shoulders, hood and breath; ambient blue
bounce off snow or stone filling the front weakly; visible mist reading the beam;
practical warm lantern somewhere in frame for contrast.

R5 OVERCAST FLAT (documentary weight, aftermath, wide landscapes)
Large soft toplight, no visible source, shadows soft and downward; colour cool
and desaturated; contrast carried by materials and wetness, not by light; the
honest, unglamorous look for scenes that should feel real rather than staged.

R6 BACKLIT SMOKE (entrances, arena walkouts)
Hard key behind the subject through heavy smoke, blowing out the background and
throwing visible light shafts past the shoulders; subject nearly silhouetted with
one narrow side-key picking out the near cheek and the weapon edge.

R7 STORM STROBE (lightning, blasts)
Ambient darkness broken by a hard white flash from one side; describe the FROZEN
instant, not the flicker: the subject lit hard on one edge, everything else in
deep shadow, rain or debris caught mid-air by the flash.

R8 HIGH-KEY WHITE (the File 01 plate look) — use for sheets, tiles and posters.

CHOOSING: a sheet or tile -> R8. A reveal or villain beat -> R1 or R6. Interior
with a fire, forge or lamp -> R2 or R3. Exterior night -> R4. Aftermath or wide
daylight -> R5. An action beat with a blast -> R7.
