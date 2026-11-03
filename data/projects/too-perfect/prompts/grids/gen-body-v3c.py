# v3c: the GPT-safe body grid (v3 and v3b were flagged NSFW on GPT Sunburst). No blood drop, no nosebleed, no tooth; the IV beat stays.
import json
t = json.load(open('grid-1-body-v3b.json', encoding='utf-8'))['grid-1-body-v3b']
R = [
 ("Shot 2. Extreme close-up of a single drop of dark red blood landing on the blue spring-floor carpet of the Cardinals gym from image 3 and soaking into the weave.",
  "Shot 2. Extreme close-up of a single red hair bow lying on the blue spring-floor carpet of the Cardinals gym from image 3, its ribbon crushed flat."),
 ("arms up, one thin line of red blood running from the nose.", "arms up, a too-bright smile frozen on the face, the eyes glassy and unfocused."),
 ("Shot 7. A single tooth lying on the blue spring floor of the Cardinals gym from image 3 under hard overhead light.",
  "Shot 7. A curled strip of used white athletic tape lying alone on the blue spring floor of the Cardinals gym from image 3 under hard overhead light."),
 ("Anamorphic lens,", "The nine stills butt edge to edge, filling the whole canvas, with no borders, gutters, gaps or white lines between them. Anamorphic lens,"),
]
for a, b in R:
    assert a in t, a
    t = t.replace(a, b)
open('grid-1-body-v3c.txt', 'w', encoding='utf-8').write(t + '\n')
json.dump({'grid-1-body-v3c': t}, open('grid-1-body-v3c.json', 'w', encoding='utf-8'), ensure_ascii=True)
print(len(t))
