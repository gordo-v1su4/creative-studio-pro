# v3: the fall is one base buckling on purpose; the dose is clinical (IV drip, blood draw), never a mouth on a wound; panels edge to edge.
import json
g = json.load(open('grids-v2.json', encoding='utf-8'))
EDGE = "The nine stills butt edge to edge, filling the whole canvas, with no borders, gutters, gaps or white lines between them."
R = {
 'grid-1-body': [
  ("Shot 1. Extreme close-up: Rafa Quiñones from image 1 tears the white athletic tape off the right wrist with the teeth, in the Cardinals locker room from image 4.",
   "Shot 1. Extreme close-up: white medical tape peeling off the crook of the elbow of Rafa Quiñones from image 1, a cotton ball and a single pinprick of red underneath, in the Cardinals locker room from image 4."),
  ("Shot 4. Tight insert in green fluorescent light: one hand closing hard around a taped wrist, the faces out of frame.",
   "Shot 4. Tight insert in green fluorescent light: a blue rubber tourniquet snapping tight around a bare upper arm, a thumb tapping the inside of the elbow for a vein, the faces out of frame."),
  ("Shot 5. On the bench of the Cardinals locker room from image 4, Rafa Quiñones from image 1 presses the bare right wrist to the lips of Tess Lindqvist from image 2, seen soft through a gap in the lockers.",
   "Shot 5. In the Cardinals locker room from image 4, seen soft through a gap in the lockers: Tess Lindqvist from image 2 sits on the bench scrolling a phone, an IV line taped to the back of the left hand, running up to a bag of dark red blood hanging from an open locker door, the drip chamber catching the light."),
  ("Shot 8. Rafa Quiñones from image 1 alone on the bench in the Cardinals locker room from image 4, head down, taped wrists hanging between the knees.",
   "Shot 8. Rafa Quiñones from image 1 alone on the bench in the Cardinals locker room from image 4, head down, a cotton ball taped in the crook of each elbow, forearms hanging between the knees."),
 ],
 'grid-2-squad': [
  ("Shot 1. From the rafters looking straight down: the whole Cardinals cheer squad hits the blue spring floor in the same sloppy fall at the same instant.",
   "Shot 1. From the rafters looking straight down: a two-high pyramid of the Cardinals cheer squad on the blue spring floor, one base at the bottom buckling a knee on purpose, the top of the stunt folding down into the waiting arms of the other bases, heavy motion blur."),
 ],
}
out = {}
for k, reps in R.items():
    t = g[k]
    for a, b in reps:
        assert a in t, a
        t = t.replace(a, b)
    t = t.replace("Anamorphic lens,", EDGE + " Anamorphic lens,")
    out[k] = t
    open(f'{k}-v3.txt', 'w', encoding='utf-8').write(t + '\n')
json.dump(out, open('grids-v3.json', 'w', encoding='utf-8'), ensure_ascii=True)
print({k: len(v) for k, v in out.items()})
