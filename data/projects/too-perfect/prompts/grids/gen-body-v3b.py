# v3b: the body grid with softer clinical wording (v3 was flagged NSFW on GPT). No border line: NBP fills the grid edge to edge.
import json
t = json.load(open('grids-v3.json', encoding='utf-8'))['grid-1-body']
R = [
 ("white medical tape peeling off the crook of the elbow of Rafa Quiñones from image 1, a cotton ball and a single pinprick of red underneath",
  "a small round bandage being peeled off the crook of the elbow of Rafa Quiñones from image 1, a cotton ball underneath"),
 ("a blue rubber tourniquet snapping tight around a bare upper arm, a thumb tapping the inside of the elbow for a vein",
  "a blue elastic band pulled snug around a bare upper arm, two fingers pressing the inside of the elbow"),
 ("running up to a bag of dark red blood hanging from an open locker door", "running up to a dark IV bag hanging from an open locker door"),
 ("a cotton ball taped in the crook of each elbow", "a small round bandage in the crook of each elbow"),
 ("The nine stills butt edge to edge, filling the whole canvas, with no borders, gutters, gaps or white lines between them. ", ""),
]
for a, b in R:
    assert a in t, a
    t = t.replace(a, b)
open('grid-1-body-v3b.txt', 'w', encoding='utf-8').write(t + '\n')
json.dump({'grid-1-body-v3b': t}, open('grid-1-body-v3b.json', 'w', encoding='utf-8'), ensure_ascii=True)
print(len(t))
