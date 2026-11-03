# Exteriors v3: textured cloud sky, no lens streaks, cold blue-green colour written into the render (no sodium orange).
import json
OV = "NO ON-SCREEN TEXT: no captions, no subtitles, no titles, no lower thirds, no watermarks, no logos overlaid on the image, no timecode, no UI or social-media overlays, no borders, no frame labels anywhere in the image."
FIN = ("Captured with a wide-latitude cinema look through a vintage anamorphic lens — oval bokeh on the deeper highlights, a gentle horizontal squeeze, soft frame-edge falloff, each light a small soft point with a gentle round bloom and no streaks or flares. "
       "Color-negative motion-picture film rendition, cool-balanced for night, a muted blue-green palette across the whole frame, heavy fine grain heaviest in the lifted shadows. "
       "Low macro contrast with blacks lifted at every depth and highlights rolling off softly; high micro contrast with razor texture in every surface — SURF. "
       "A real photographic frame from a real camera on a real location — no CGI, no rendered look, no digital cleanliness, no glossy AI sheen, no oversharpening, no HDR overprocessing.")
SKY = ("Above it all hangs a low, heavy ceiling of night cloud with real visible texture — rolling, lumpy cloud masses and darker gaps between them, their undersides faintly lit a cold grey-green by the town below, the cloud thickening toward the horizon.")
P = {
 'roof': ["A cinematic still photograph of the flat roof of a college athletics warehouse late on a foggy night, a low wide composition from behind a rooftop ventilation unit, its rusted housing filling the left edge of the frame in soft foreground focus, the roof edge running away on the right third toward a low parapet where the campus and the town spread out below under a heavy clouded sky, the frame holding a lonely, suspended stillness.",
   OV,
   "Black tar-and-gravel roofing slick with puddles, roof vents and steel conduit, a metal ladder hatch standing open, a low brick parapet along the edge with a rusted railing. Beyond and below: a college campus of brick buildings, a clock tower in the middle distance, rows of small windows, the streetlights of the town stretching away into the fog. No people. " + SKY,
   "The scene is dark and cold: the roof is lit only by a faint cold blue-green spill rising from the town, catching the wet gravel and the edge of the vent. The clock face and the windows are small pale green-white points, each a soft round glow in the fog. An even fog hangs over the campus and thickens with distance until the far town dissolves into it, fine mist settling on the gravel, the light spreading evenly through it and never forming beams.",
   FIN.replace('SURF', 'tar, gravel, rust, brick, wet puddles, cloud')],
 'parking-lot': ["A cinematic still photograph of a nearly empty college gym parking lot late on a foggy night, a low wide composition from just above the asphalt beside a concrete parking curb, the curb crossing the lower foreground in soft focus, a single dark sedan parked alone on the right third with its engine running, the long low gym building stretching across the deep background under a heavy clouded sky, the frame holding a held-breath stillness.",
   OV,
   "Cracked black asphalt with faded white parking lines and oil stains, a storm drain, wet patches from earlier rain. The car is a dark green early-2000s four-door sedan, its exhaust breathing a thin pale trail into the cold air, its tail lights on, the interior unreadable behind the glass. The gym building is a long corrugated-metal warehouse with one lit glass door and a red-and-white sign above it reading \"CARDINALS ATHLETICS\" in painted letters. A chain-link fence and a row of bare trees at the edge of the lot. No people visible. " + SKY,
   "The lot is dark and cold. One tall street lamp at the far edge of the lot gives a dim, cold green-white glow, a soft round halo in the fog that barely reaches the asphalt beneath it, everything else in deep blue-green near-black. The sedan's red tail lights are small and dim and lay a faint red smear on the wet asphalt behind it. The gym's glass door is a small pale cool rectangle in the distance. Low fog rolls across the lot and thickens with distance until the trees dissolve into it, the light spreading evenly through it and never forming beams.",
   FIN.replace('SURF', 'asphalt, wet paint, car paint, glass, chain-link, cloud')],
}
out = {}
for n, parts in P.items():
    t = ' '.join(' '.join(parts).split())
    open(f'plate-{n}-v3.txt', 'w', encoding='utf-8').write(t + '\n')
    out[n] = t
print(json.dumps(out, ensure_ascii=True))
