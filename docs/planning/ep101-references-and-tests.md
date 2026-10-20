# EP101 references and first tests (ready, NOT sent)

Collected 2026-10-20 for V1S-283. Nothing here has been sent. Every send goes through the Higgsfield plugin
(MCP, plan credits) **one at a time, with the operator's OK**, showing the credits before/after and the API-price
equivalent. Files live in `data/projects/01a14bbe-…/files/references/`.

## Picks (`references/characters/`, one per character, all ≥2K, name printed, no "vampire"/"fangs" text)

| Character | File | Built from | Notes |
|---|---|---|---|
| Kai "Hoodie" Santana | `Kai_Hoodie_Santana.png` 3168×1344 | trailer `01-kai-sheet-2k` (Higgsfield `637e0851`, used 15× this week) | Cinematic headshot + body. Kai can look odd; the hallway shots with Bryson are the good in-scene alternates. |
| Mara Voss | `Mara_Voss.png` 5504×3256 | `mara-bathroom-01.png` + name band | Operator OK. Also OK: the multi-panel sheet on white (fang mouth, black-tears head and label whited out, `candidates/Mara/…multi-panel-clean-1672px.png`, **1672 px: under the 2K rule, operator to decide**) and the blue/pink bathroom (`…bathroom-blue-pink.png`, black tears = scene state, not identity). **Never:** the simplified sheet (makes her too tall), the VACANCY motel hallway `mara-01` (Kai looks wrong), group shots, the three on white. |
| Elias Mercer | `Elias_Mercer.png` 4587×1628 | rain close-up `2c05bb2d` (native) + body panels of his sheet `419328ee` | His sheet's own face panel has washed-out eyes, so only its body is used. White hoodie = his. |
| Rowan Mercer | `Rowan_Mercer.png` 2752×1536 | trailer `19-rowan-sheet-clean` | Label already clean. No cinematic close-up yet (test C). |
| Lucian Vale | `Lucian_Vale.png` 3835×1628 | colour render `15-lucian-portrait` (native) + body of `16-lucian-sheet-2k`, label covered | "Lucian Blaise" label removed. |
| Malachi Jackson | `Malachi_Jackson.png` 2752×1628 | cast sheet 2752, label (fangs / glowing eyes) covered | Trailer sheet was 1672 px. No close-up yet (test C). |
| Malik Vale | `Malik_Vale.png` 2752×1536 | his sheet (Higgsfield `7898b7c3`) | Label has no banned words. Amber eyes are his look. No close-up yet (test C). |

Alternates in `references/candidates/`: Kai with Bryson (hallway a/b), Bryson close-up + sheet (black hoodie
only; white is Elias's), Elias rain close-up alone, Lucian colour render alone (2000 px, under 2K on its own),
Mara multi-panel (clean) and blue/pink bathroom. From Mara's colour contact sheet only Malik's fluorescent-light
panel is wanted (Malik close-up idea); everything else there is out. Location: `references/locations/College_Quad.png` (approved master, 2752).

Excluded: anything from the red club/restaurant project; Bryson in a white hoodie; Mara's simplified sheet;
multi-panel sheets with fang or black-tear panels (and all of them are 1672 px).

## Why close-ups: getting new images instead of copies

Nano Banana copies a reference when the prompt reads like an edit ("edit image 1", "recreate image 1") or when the
reference is a full scene. It invents a new frame when the references are identity only (a face close-up, a body
sheet), the prompt names a different place, camera, lens and moment, and nothing asks it to keep the reference's
composition. So: close-up refs, names only, a new setting and lens in every prompt, never "recreate".

## Test A: Elias and his brother Rowan arguing (3 settings, one at a time)

Nano Banana Pro, 2K, 21:9. Image 1 = `Elias_Mercer.png`, Image 2 = `Rowan_Mercer.png`.

A1. `A new anamorphic film still, 40mm anamorphic lens with oval bokeh and a soft horizontal flare: Elias Mercer (Image 1) and his brother Rowan Mercer (Image 2) argue on the concrete stairwell of an old college dorm at night, Elias Mercer one step above leaning in close, Rowan Mercer turned half away with his jaw set, a buzzing fluorescent tube overhead and rain on the window behind them.`

A2. `A new anamorphic film still, 40mm anamorphic lens with oval bokeh and a soft horizontal flare: Elias Mercer (Image 1) and his brother Rowan Mercer (Image 2) argue across a folding table in an empty campus laundromat at 2 AM, Rowan Mercer gripping a laundry basket, Elias Mercer pointing at him, dryer windows glowing behind them.`

A3. `A new anamorphic film still, 40mm anamorphic lens with oval bokeh and a soft horizontal flare: Elias Mercer (Image 1) and his brother Rowan Mercer (Image 2) argue in a wet campus parking lot at night under sodium lights, Rowan Mercer walking away, Elias Mercer grabbing his shoulder to turn him back, rain streaking through the light.`

## Test B: Mara 2K close-up

Nano Banana Pro, 2K, 21:9. Image 1 = `Mara_Voss.png` (bathroom), Image 2 = the clean multi-panel sheet (if the
operator allows a 1672 px input).

`A new anamorphic close-up film still of Mara Voss (Image 1, Image 2) at a library table at night, chin on her hand, watching someone across the room, a green desk lamp lighting one side of her face, shallow focus, 40mm anamorphic oval bokeh.`

## Test C: close-ups for Rowan, Malik and Malachi (Bryson's recipe)

Nano Banana Pro, 2K, 21:9, one character per send; Image 1 = their pick.

`A new anamorphic extreme close-up film still of <Rowan Mercer | Malik Vale | Malachi Jackson> (Image 1) at night, face filling the frame, rain-damp skin, city lights as oval bokeh behind, 40mm anamorphic lens, sharp focus on the eyes.`

## Test D: new anamorphic base plates for every location (operator, 2026-10-20)

Use the existing plates only as references and generate **new, empty, anamorphic** base environments; those become
the location refs. Sources are in `references/locations/sources/`. Nano Banana Pro, 2K, 21:9, one per send, Image 1
= the source. Template:

`A new empty establishing film still of <place> (Image 1 for the architecture and layout only), 40mm anamorphic lens, oval bokeh, a soft horizontal flare, <time and light>, no people.`

| EP101 scenes | Place | Source (px) | Time and light |
|---|---|---|---|
| 020 | the private Catholic college quad | `quad.png` 2752 | hard morning sun, long shadows |
| 030 | a freshman lecture hall (raked seats) | `classroom.png` 2752 (a seminar room: use for style only) | flat fluorescent daylight |
| 040, 090, 100, 110, 140 | the Video Haven video rental store interior | `video-haven-interior.jpg` **2000** (canon seed missing) | day: tired fluorescent; night: half the tubes off |
| 080, 090 | the Video Haven storefront on Veridian Avenue | `video-haven-storefront.png` 5504 | night, wet street, sign lit |
| 050, 060 | an off-campus party house, backyard and kitchen | `party-house.png`, `party-house-living-room.png` 2752 | night, string lights, warm practicals |
| 070, 130 | a cramped freshman dorm room | none: new from scratch | past midnight, desk lamp; dawn through blinds |
| 130 | the campus bathroom mirror | `campus-bathroom.png` 5504 (operator: the mirror shot is good) | blue fluorescent with a pink fill |
| 120 | the alley, fire escape and rooftops | `rooftop-night.png` 2752 (the blue lumen rooftop) | night, blue lumen light, wet roofs |

Rule from the trailer: never write the store's sign words in quotes, and never write "closed" for the storefront.

## Scene 020 Morning Quad both ways (after the refs are approved)

**Way 1: grid, then Seedance.** Nano Banana Pro, 2K, 16:9, refs: Image 1 Kai, Image 2 Malik, Image 3 Elias,
Image 4 Rowan, Image 5 College Quad.

`A 3x2 grid of cinematic shots from a college drama, morning sun, 40mm anamorphic, where panel 1 is a wide high angle on the college quad (Image 5) with freshmen in lanyards drifting between orientation tables; panel 2 is Kai "Hoodie" Santana (Image 1) crossing the lawn as heads turn, signing a sophomore's football without breaking stride; panel 3 is Malik Vale (Image 2), Elias Mercer (Image 3) and Rowan Mercer (Image 4) peeling out of the crowd into a loose orbit around Kai "Hoodie" Santana (Image 1); panel 4 is Kai "Hoodie" Santana (Image 1) walking backward from a volunteer with a clipboard, all charm; panel 5 is Elias Mercer (Image 3) shifting so his shadow covers Rowan Mercer (Image 4), who squints against the sun; panel 6 is the four walking away into the sun flare across the quad (Image 5).`

Then Seedance 2.0 with the approved grid as the main reference: follow its panels left to right, top to bottom,
full-screen footage, never show the grid.

**Way 2: Seedance straight from the shot prompts.** Link the picks to the scenes in Notion (References rows),
Sync, re-run Fit for 020 so each shot names `@Image_N`, then send shot 0040 (the volunteer exchange, the scene's
dialogue beat) as a 480p draft (`draft: true`).

## Order when the operator is back

0. Decide: may a 1672 px image (Mara's clean multi-panel) be used as an input, given the 2K rule?
1. Look at the picks board; swap any pick for an alternate.
2. Test A1 (Elias + Rowan) → if good, A2/A3; Test B (Mara); Test C (three close-ups). One send at a time.
3. Close-ups that land become the identity refs (replace the sheet's face panel). Test D plates that land become
   the location refs.
4. Add the References rows in Notion, link scenes, upload, Sync, re-fit 020.
5. Scene 020 both ways; compare.
