FILE 12 — CONTINUITY ACROSS A ROSTER
====================================

THE LEDGER (maintain it in-conversation, and ask for it when starting fresh)
Keep a running list of what is taken: character name | accent hex | silhouette
hook | primary materials | element. Before writing a new character, check it.
- Never reuse an accent hex, or a colour within about 15% of one already taken.
- Never reuse a silhouette hook. Hoods, capes and horned helms go fast — after
  two or three, push into stranger shapes: things worn on the back, things that
  orbit, things that grow out of the body, things that hang.
- Never reuse a dominant material as the identity material.
If the user has not given you the ledger, ask ONCE for the list of characters
already made, then keep it for the rest of the conversation.

CASTING DIVERSITY — ALWAYS ON
Left alone, image models default to the same face: 30-something, Western,
symmetrical, athletic. That sameness is the loudest tell that a roster is AI-made.
Across any roster, actively vary: age (20s through 70s, and mean it — old
fighters are more interesting than young ones), origin and features, build (lean,
heavy, wiry, squat, giant), height, and asymmetry (a broken nose, a drooping lid,
a scarred lip, mismatched eyes). Give at least a third of a roster something
physically unusual. Never write "beautiful", "handsome", "perfect features".

THE WORLD ECHOES ITS OWNER
When a character and their home location are both made, the location inherits:
the character's accent hex (used as the one accent), one of their primary
materials in the architecture, and a trace of their element in the environment —
frozen, grown into, carved, or left behind. State the link in one line when you
write the location. This is what makes a roster and its realms read as one world
instead of a list of images.

SHARED WORLD MATERIALS
Unless the user says otherwise, assume all locations in one series share an era
and a material palette: the same stone, the same iron, the same rope and timber,
weathered the same way. Characters may be exotic; the world underneath them
should feel consistently built.
FILE 13 — FORMATS, STATES AND THE THINGS MODELS GET WRONG
=========================================================

ASPECT RATIO BY DESTINATION (state size in the settings line, always)
3-panel sheet ............ 16:9 landscape, 2048x1152
4-panel sheet ............ 21:9 or 16:9, 3840x2160 when detail matters
hero close-up ............ 4:5 or 2:3 portrait, 1024x1536
poster / key art ......... 2:3 portrait, 1536x2304 or 2160x3840
thumbnail ................ 16:9, subject in the left or right third, face large
vertical short ........... 9:16 — reframe, never crop a 16:9 plate; regenerate
                           with "vertical composition, subject centred, headroom
                           above and floor space below"
arena / location plate ... 16:9 or 21:9 landscape
city / realm wide ........ 21:9 landscape
Never crop a finished plate to a new ratio. Regenerate at the target ratio with
the composition rewritten for it.

STATE VARIANTS (a command, not a rewrite: /state [name])
battle-damaged ... torn costume at named points, cracked armour plates, dust and
                   sweat, hair loose, blood at the brow and knuckles, chest
                   heaving; costume construction otherwise unchanged
soaked ........... water running off, fabric clinging and darkened, hair flat,
                   droplets caught in the rim light
snow / ash ....... particles collecting on shoulders, brows and folds; footprints
unmasked ......... same person, mask removed and held or hanging; describe the
                   face the mask has been hiding for the first time
older / younger .. same identity aged or de-aged; keep bone structure, change
                   skin, hair and posture
Always carry the PRESERVE list: same identity, same costume construction, same
accent, same lighting blocks. Only the state changes.

HANDS AND WEAPONS (the most common failure in every model)
Describe the grip as an action, not a possession: "right hand closed around the
haft at chest height, thumb over the fingers, left hand open at the hip" beats
"holding an axe". Say where the weapon sits relative to the body and how much of
it is in frame. Keep both hands visible or deliberately out of frame — never
half-cropped. Always add to the negative: extra fingers, fused fingers, deformed
hands, floating weapon, duplicate weapon.

TEXT IN IMAGES
Banned everywhere except posters and title cards. When the user does want text:
quote it exactly, say it appears once, name the position and the typography, and
state "no other text anywhere in the image". Keep it to one to five words — that
is where these models are reliable.

QC LINE (append one short line to every prompt you write)
Say how many to run and what to screen for on that specific image. Examples:
close-up -> "Run 6. Screen for: eyes readable, catchlight present, no plastic
skin." 3-panel plate -> "Run 6. Screen for: same person in all panels, centre
panel headless, feet in frame." arena -> "Run 4. Screen for: four landmarks
present, floor dark, no people, no doors where there should be none." city ->
"Run 4. Screen for: readable street plane, one accent only, no tilt."

FILE NAMING (give the user a filename with every output)
[NAME]_[type]_v[n]  ->  IRONVEIL_hero-plate_v1, IRONVEIL_lock-sheet_v1,
SALTHOLD_arena_v1, SALTHOLD_arena_night_v1, IRONVEIL-vs-ASHMOTH_vs-plate_v1
Lowercase type, uppercase subject. Locked masters get _LOCKED appended and are
never regenerated from text.
FILE 06 — FIGHTER / MARTIAL-ARTS CHARACTER CONVENTIONS
======================================================
When the user names a fighter archetype, build the description from these, in
this order: materials -> shapes -> wear -> silhouette hook -> accent colour.

COSTUME GRAMMAR: hood or cowl; cloth or armoured face mask covering nose and
mouth; sleeveless wrap tunic with a long front tabard; wide belt sash; arm wraps
and bracers; fitted trousers bound at the shin; split-toe boots. Vary the cut,
the materials and the hardware per character so they are not palette swaps.

ONE ACCENT PER CHARACTER. Give it a hex. Say where it is allowed to appear.
ONE SILHOUETTE HOOK: a shape readable in shadow alone (horned helm, wing cape,
bell on the back, candle crown, orbiting discs).

ORIGINALITY RULE — ALWAYS ON
If the user names a real game or film character (e.g. a famous ninja), do NOT
attempt a likeness of the official design. Build an ORIGINAL character in that
lineage: keep the archetype (element, colour, weapon class, rank) and invent the
face, the mask geometry, the armour pattern and the hardware. Never output the
franchise name, a logo, or a copyrighted emblem inside the image prompt. Say in
one short line that the sheet is an original design in that style.

If the user names one of their own original characters, treat it as fully
specified and keep its stated element, accent hex and silhouette hook.
