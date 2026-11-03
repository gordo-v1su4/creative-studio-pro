# Write the Too Perfect location plates (Scenecraft v1, Plate A) and print them as one JSON map for the Higgsfield tab.
import json
OV = "NO ON-SCREEN TEXT: no captions, no subtitles, no titles, no lower thirds, no watermarks, no logos overlaid on the image, no timecode, no UI or social-media overlays, no borders, no frame labels anywhere in the image."
def fin(surf, night=True):
    bal = "tungsten-balanced and pushed for night" if night else "daylight-balanced"
    return ("Captured with a wide-latitude cinema look through a vintage anamorphic lens — oval bokeh on the deeper highlights, a gentle horizontal squeeze, soft frame-edge falloff, natural bloom around every point light source, a faint horizontal streak on the brightest source. "
            f"Color-negative motion-picture film rendition, {bal}, heavy fine grain across the entire frame and heaviest in the lifted shadows. "
            f"Low macro contrast with blacks lifted at every depth and highlights rolling off softly, never clipping; high micro contrast with razor texture in every surface — {surf}. "
            "A real photographic frame from a real camera on a real location — no CGI, no rendered look, no game-engine look, no digital cleanliness, no plastic surfaces, no glossy AI sheen, no oversharpening, no HDR overprocessing.")
P = {
 'coach-office': [
  "A cinematic still photograph of an empty coach's office off the side of a cheerleading training gym late at night, an eye-level composition from just inside the doorway, the edge of the open door filling the left edge of the frame in soft foreground focus, a cluttered steel desk weighted to the right third, the back wall of framed team photographs behind it, the frame holding a close, stale stillness.",
  OV,
  "A small cinderblock office painted pale institutional green, a grey steel desk buried in binders, scoring sheets, a rolodex and a cold mug of coffee, a red team windbreaker hung over the back of a cracked vinyl chair. The back wall is covered edge to edge in framed team photographs of cheer squads in red-and-white uniforms, rows of small faces, the frames' years printed on brass plates beneath them, one larger frame centred above the desk with a brass plate reading \"1998\". A grimy interior window on the left wall looks out onto the dark gym floor. A metal filing cabinet with one drawer pulled open, a cardboard box of old trophies on the floor. No people.",
  "A green-shaded desk lamp is the only source, a warm low pool of light across the desk papers and the lower rows of photographs, the glass of the frames catching small hard reflections, the light falling off up the wall so the top rows sit in shadow and the 1998 frame is half lit. Through the interior window the gym is near-black with one far cool-white glow. The air carries real density at every depth: the door edge in the foreground softened, the desk slightly lower in contrast, the photo wall softer still, blacks lifted and grainy in the corners.",
  fin("cinderblock, steel, paper, picture-frame glass, vinyl")],
 'parking-lot': [
  "A cinematic still photograph of a nearly empty college gym parking lot late at night, a low wide composition from just above the asphalt beside a concrete parking curb, the curb crossing the lower foreground in soft focus, a single dark sedan parked alone on the right third with its engine running, the long low gym building stretching across the deep background, the frame holding a held-breath stillness.",
  OV,
  "Cracked black asphalt with faded white parking lines and oil stains, a storm drain, wet patches from earlier rain. The car is a dark green early-2000s four-door sedan, its exhaust breathing a thin warm trail into the cold air, its tail lights on, the interior unreadable behind the glass. The gym building is a long corrugated-metal warehouse with one lit glass door and a red-and-white sign above it reading \"CARDINALS ATHLETICS\" in painted letters. A chain-link fence and a row of bare trees at the edge of the lot. No people visible.",
  "One tall sodium street lamp at the far edge of the lot throws a hard warm orange cone onto the asphalt and leaves everything outside it in deep near-black. The sedan's red tail lights bloom and lay a red smear across the wet asphalt behind it. The gym's glass door glows a small cool white in the distance. The air carries real cold density at every depth: the curb in the foreground already softened, the car slightly lower in contrast, the building and the trees melting into grainy dark, the sodium light blooming softly.",
  fin("asphalt, wet paint, car paint, glass, chain-link")],
 'roof': [
  "A cinematic still photograph of the flat roof of a college athletics warehouse late at night, a low wide composition from behind a rooftop ventilation unit, its rusted housing filling the left edge of the frame in soft foreground focus, the roof edge running away on the right third toward a low parapet where the campus and the town spread out below, the frame holding a lonely, suspended stillness.",
  OV,
  "Black tar-and-gravel roofing with puddles, roof vents and steel conduit, a metal ladder hatch standing open, a low brick parapet along the edge with a rusted railing. Beyond and below: a college campus of brick buildings, a lit clock tower in the middle distance, rows of small warm windows, the streetlights of the town stretching to a dark horizon. No people.",
  "The roof itself has no light of its own; it is lit only by the spill from below, a faint warm orange glow rising over the parapet from the street lamps and catching the wet gravel, and a cool blue-black sky with no moon above. The clock tower is the brightest point in the frame, small and warm with a soft bloom. The air carries real density at every depth: the vent housing in the foreground softened, the roof slightly lower in contrast, the campus softer still, the horizon dissolving into grainy dark.",
  fin("tar, gravel, rust, brick, wet puddles")],
 'dorm-hallway': [
  "A cinematic still photograph of an empty college dormitory hallway in the middle of the night, a dead-centred composition at eye level looking straight down the long corridor, the symmetry of the doors on both walls holding to a fire exit at the far end, the frame holding a sleepless, humming stillness.",
  OV,
  "A 2001 dormitory corridor with speckled linoleum floor, cinderblock walls painted off-white, rows of wooden doors on both sides each covered in dry-erase boards, photos, cut-out magazine pages and a small whiteboard name tag, a pair of sneakers left outside one door, a laundry basket outside another. A payphone on the wall halfway down on the left, its receiver hanging. A fire exit door at the far end under a lit exit sign. No people.",
  "Every second ceiling panel light is switched off for the night, so the corridor is broken into alternating pools of flat cool fluorescent light and dark gaps, the light falling straight down onto the linoleum and the door fronts. The red exit sign at the far end glows warm and small. A thin line of warm light shows under one door. The air carries real density at every depth: the nearest doors softened, each pool of light deeper slightly paler and lower in contrast, the exit door dissolving into grainy dark.",
  fin("linoleum, painted cinderblock, wood, paper, steel")],
 'president-office': [
  "A cinematic still photograph of an empty college president's office late at night, a wide composition from a low position beside a leather wingback chair, its dark leather arm filling the right edge of the frame in soft foreground focus, a broad mahogany desk anchored on the left third in front of tall leaded windows, the frame holding a heavy, moneyed stillness.",
  OV,
  "Dark wood-panelled walls, floor-to-ceiling bookshelves, a large mahogany desk with a green-glass banker's lamp, a leather blotter, a brass nameplate turned away from camera, a crystal decanter on a side table. On the desk sits a single framed photograph lying face-down on the blotter. Framed diplomas and a university seal carved in wood on the far wall. Through the leaded windows the campus green is dark, one path lamp outside. No people.",
  "The banker's lamp is the only source, a warm, low, tight pool across the blotter and the face-down frame, catching the polish of the mahogany, falling away fast so the bookshelves and the panelling sink into deep warm shadow. Cool blue night comes faintly through the leaded windows and rims the edge of the desk. The air carries real density at every depth: the chair arm in the foreground softened, the desk slightly lower in contrast, the bookshelves softer still, blacks lifted and grainy.",
  fin("leather, mahogany, brass, glass, leaded windows")],
}
out = {}
for name, parts in P.items():
    text = '\n\n'.join(parts) + '\n'
    open(f'plate-{name}-v1.txt', 'w', encoding='utf-8').write(text)
    out[name] = ' '.join(text.split())
gym = open('plate-gym-v2-wide.txt', encoding='utf-8').read()
out['gym-v2'] = ' '.join(gym.split())
open('locations-v1.json', 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=True))
print({k: len(v) for k, v in out.items()})
