# Prompting guide for the writing agent (from the CodeOneshot blog)

You write image and video prompts for this app: character sheets, location
sheets, props, 2×2 keyframes and Seedance shots. This guide is the standard
those prompts are held to. It condenses all nine articles on
<https://higgsfield.ai/@code-oneshot/blogs> (read 25 Oct 2026) into rules, in
our own words. The ONE SHOT skills in `agent-skills/` stay the formats; this
guide is the reasoning behind them. Where they disagree, the skill's template
wins, and the operator's direction wins over both.

---

## 1. The one idea: direct, don't describe

A prompt is a set of instructions for a camera, an actor and a sound
recordist. It is not a wish. Climb this ladder, and stop only at the top:

| Level | What the prompt does | Example of the shift |
|---|---|---|
| 1 Describe | Names a subject and a mood | "a fighter in the rain, cinematic" |
| 2 Direct | Says where the camera is and what the body does | lens, height, side of the action, one action |
| 3 Physical | Says what touches what, and what happens after | "the fist lands on the jaw, the head snaps left, water flies off the hair" |
| 4 Lock | Says what may never change | face, costume, sides, prop count, camera line |
| 5 Structure | Puts it in a fixed block order with timed beats | the same sections, the same order, every time |
| 6 System | Reuses a winning prompt as the gold example | copy the shape of a prompt that worked |

Every prompt you write sits at level 5, built from a level-6 example when one
exists.

## 2. Words to drop, words to use

- **No mood words, no hype words.** "Epic", "cinematic", "stunning",
  "dramatic", "beautiful", "breathtaking" pull the model towards glossy fake
  renders. Say what physically happens instead.
- **No music** in a video prompt unless asked; describe real sound (rain on
  metal, breath, cloth, footsteps), not a score.
- **One meaning per word.** "Shot" (camera or gun), "cut" (edit or slash),
  "fire" (flames or shooting), "frame" (video or picture) are ambiguous; pick
  the unambiguous phrasing ("camera angle", "blade slash", "flames").
- **Precise verbs.** Not "hits" but smashes down, chops, rams, flings, sweeps
  low, flicks upward. One verb locks the whole motion.
- **Count things.** "One hat", "one shield", "two lip rings": a number before
  every prop stops the model spawning a second one.
- **Rules as short absolutes.** "Unchanged the whole time", "never crosses the
  line", "never deforms". Short, final, no hedging.
- **Order like a shot list:** time, then place, then action ("at 3 s, on the
  bridge, Kai kicks").
- **Plain, physical, specific** beats long and pretty. A dense prompt keeps the
  model's attention to the end; padding gets the end ignored.

## 3. Sizes: centimetres and metres only

- Every size is a number with a unit: **cm or m**. A person's height is
  `178 cm` (or `1.78 m`); a room is `12 m` deep; a blade is `100 cm`.
- **Never feet and inches.** Never a comparison ("as big as a watermelon",
  "the size of a car", "towering", "tiny", "giant"). The model renders the
  thing you compared it to, or guesses a scale.
- A size word with no number ("small", "huge", "tall") is a bug: replace it
  with the measurement.
- Locations carry distances: where each landmark stands and how far, in
  metres. A place with no metres collapses in scale.

## 4. References: one job per image

- Every attached image has exactly one named job, said in the prompt:
  "image 1 controls the face; image 2 controls the body, build and wardrobe;
  image 3 controls the light and colour only".
- **When there is a face picture and a body picture, the face comes from the
  closest, sharpest face picture and the body, muscles and clothes from the
  full-body picture.** Never let the body image's small, soft face win.
- Whatever an image shows, the model copies, including what you did not want
  (wet hair from a rain close-up, a pose, a background). If an image carries
  something unwanted, give its job narrowly ("take only the face structure from
  image 1, not the hair state") or attach a better image.
- Name each character by the exact declared name every time. Never a pronoun,
  never "the man" or "the girl".

## 5. Characters nobody else has

- **Casting before costume.** Age as a number, origin, build, height in cm, one
  real flaw (a scar, a chipped tooth, freckles). Never "beautiful" or
  "handsome": describe the actual face.
- **An owned element.** Each character owns a power or element nobody else in
  the cast uses, and one owned colour with a hex (`amber #D98A2B`). Keep a
  ledger so no two characters share an accent.
- **A silhouette hook.** One shape that identifies the character from a black
  outline (a hood, a coat line, a hairstyle).
- **Costume: materials first, then the shapes they make, then the damage.**
  Waxed cotton, brushed steel, cracked leather, then cut, then wear. Colours
  age: sun-faded, oil-stained, salt-crusted.
- **Real, not a game.** Translate the character into a real actor in a real
  costume: real fabric weave, stitching, scuffs, sweat. Powers behave as
  physics (section 7).
- **The hand-off line.** Once a sheet exists, every later prompt names the
  character with the CHARACTER line and never re-describes them:
  `CHARACTER KAI — identity: male, 18, lean wiry free-runner, 178 cm, …;
  costume as sheet; owned element: …; owned colour: amber #D98A2B; powers: ….`
  followed by the one-sentence lock on how the power may show.

## 6. Character sheets

- Block order is fixed: SHEET (panels), SUBJECT, COSTUME, SILHOUETTE, LIGHTING,
  GRADE, CAMERA, REALISM, LOCKS, then a short AVOID at the very end.
- Three panels on one 16:9 canvas, same near-white seamless backdrop for the
  whole cast:
  - **Left:** face close-up, straight-on (operator's choice over the blog's
    three-quarter look), both eyes and ears visible.
  - **Centre:** full body from the front, **head cropped out at the
    collarbones**, feet in frame. This panel is for costume, build and
    proportion; the close-up owns the face. It is the rear panel's body zoomed
    in evenly: the feet stay in frame, the head leaves the top edge, and the
    zoom is the same in every direction, so leg length, torso and width keep
    the rear panel's proportions.
  - **Right:** full body from behind, head to feet, same pose.
- Lock: same person, costume, proportions and light in every panel; feet
  visible in both full-body panels; no text, no logos, not a 3D render, not
  airbrushed.
- Grade: muted natural colour with one accent; never monochrome.
- An evenly lit identity sheet (flat grey, little shadow) is the better file to
  feed a video model, because it hides nothing the video model would otherwise
  invent.

## 7. Powers without glow

Glow, aura, smoke and particles are what make AI powers look fake. Write a
power as a physical event in four parts:

1. **Force:** what the power pushes, pulls, heats or freezes.
2. **Contact:** the surface it meets (water, concrete, skin, cloth).
3. **Result:** what that surface does (cracks, steams, frosts, ripples).
4. **Aftermath:** what stays (scorch, frost rime, wet footprints, dust in the
   air).

- Fire burns something and leaves char; ice grows on a surface with frost
  creeping outward; lightning is a short arc between two conductors and a burnt
  smell, not a crackling halo.
- Invisible forces are shown through what they move: dust, water, hair, cloth.
- Eyes are real eyes: colour, pupil shape, wetness, kept in shadow. Never
  "glowing eyes" unless the operator asks.
- Words that summon glow: aura, energy, magical, ethereal, radiant, luminous,
  sparkles, particles, emanating. Don't use them.

## 8. Stopping morphing in video

- **One action per beat.** Two actions in one beat merge into a blur.
- **Bodies separate after contact.** After a hit or a grab, say they part and
  how far, in metres.
- **Lock the sides and the camera line.** Who is screen-left, who is
  screen-right, the distance between them, and that the camera never crosses
  the line.
- **Rigid things stay rigid** (blades, helmets, armour); soft things move
  (hair, cloth, water). Say which is which.
- **Costume by material**, with a clear separation line between garments, so
  the model can't melt them together.
- **Transformations happen out of sight:** behind a turn, a cloud of dust, a
  cut. Never on camera in one continuous morph.
- **Eyeline lock:** say exactly where each character looks.
- Count props in every beat they appear.

## 9. Video structure

- Ghost's fixed sections, always in order: SCENE + REALISM LOCK, REFERENCES,
  CHARACTERS, SPACE (metres), FIRST FRAME, TIMELINE (timed beats), PHYSICS,
  CAMERA, LIGHT / COLOUR, SOUND, LOCKS.
- Clips under 15 s. Talking clips: one line of 10 words or fewer, the line in
  curly brackets with accent and tone beside it; give a pronunciation hint for
  any unusual name.
- No hero ending: end mid-motion, so the next clip can pick up.
- On-screen text appears all at once, never letter by letter.
- One duel per clip in a fight.

## 10. Working method

- **Fresh ideas are new, not tweaks:** new staging, camera, use of the
  location, or entrance. Two concepts, each a full prompt, a one-line pitch
  each, and a pick.
- **Fix one block at a time.** When a render fails, change the one section
  responsible, rerun, compare.
- **Every rule has a failure behind it.** When the same correction comes up a
  third time, it goes into the skill as a rule, with the winning example.
- **Gold examples beat descriptions.** Copy the shape of an approved prompt.

## 11. Troubleshooting

| What went wrong | Usual cause | Fix |
|---|---|---|
| Face changes between shots | No face reference, or the body image's face won | Attach a sharp close-up as the face job; hand-off line, no re-description |
| Character flips left/right | Sides not locked | Name screen-left/right and the camera line in LOCKS |
| A second hat or sword appears | Prop not counted | "one" before the prop, in every beat |
| Looks like a game or render | Mood words, glow words, game costume | Physical verbs, materials, real wear |
| Wrong scale | Comparisons or no numbers | cm/m for every size |
| Too tall or long-legged | Height missing, or proportions not tied to a full-body source | Height in cm; take body proportions from the full-body image |
| Power looks like a light show | Glow vocabulary | Force, contact, result, aftermath |
| Bodies melt in a fight | Two actions per beat, no separation | One action per beat; they part after contact |
| Unwanted music | Nothing said about sound | SOUND lists real sounds only |
| Wet hair, wrong pose copied | A reference image carried it | Narrow that image's job or replace it |

## Sources

The nine articles by CodeOneShot (Petros Louka) on Higgsfield:
From Simple Prompting to Elite Prompting · Why Your AI Characters Morph (and
How I Stopped It) · Powers That Look Real: Killing the Glow · Build Characters
Nobody Else Has · 10 Things I Wish I Knew Before Making AI Films · Why I Write
My AI Video Prompts in Chinese · How We Turn Habits Into Skills · Behind the
ONE SHOT: The Spaghetti Monster That Started It All · My Claude Skills, Free
For You.
