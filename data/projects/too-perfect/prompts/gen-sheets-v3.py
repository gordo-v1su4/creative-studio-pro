# Castkit 3-panel sheets with the portrait right panel (v3): the four approved Sunburst prompts, plus new characters. Prints JSON for the tab.
import json, re
ns = {}
exec(open('gen-sheets.py', encoding='utf-8').read().split("cast = {")[0], ns)
A, B, CENTER, OPEN, SKIN, close = ns['A'], ns['B'], ns['CENTER'], ns['OPEN'], ns['SKIN'], ns['close']
RIGHT = ("RIGHT PANEL — portrait headshot. A classic portrait framing from just above the top of the head down to the top of the chest, the tops of both shoulders and the collarbones in frame, the face large and sharp in the panel, the neck natural and in true proportion to the head and shoulders. The head is dead-on to camera, squared and level, both ears equally visible, the nose centered between the eyes, eyes directly into the lens. This is a flat frontal view: no three-quarter turn, no head rotation, no chin lifted or dropped, no tilt to either side. {expr} Every facial plane, the eyes, brows, nose, lips, skin and hairline read at maximum detail.")

def ident_of(name):
    t = open(f'sheet-v2-{name}.txt', encoding='utf-8').read().split('\n\n')
    return t[1] + ' ' + t[2]

cast = {
    'rafa': dict(ident=ident_of('rafa'), left=A.format(collar='The ribbed crew collar of the hacked-off tee', extra=' The thin gold rope chain still sits around the empty collar opening, resting on the fabric.'),
        back='The textured crop and skin fade from behind, the deep-cut armholes and the raw cut edges of the tee, the back of the shorts and the heels of the cheer shoes.',
        expr='A slow, unbothered half-smirk with the lips closed, heavy-lidded eyes. The hacked-off grey tee and the gold chain show at the bottom of frame.'),
    'tess': dict(ident=ident_of('tess'), left=B,
        back='The tight high platinum ponytail and red bow from behind, the racer-back straps of the sports bra, the back of the spandex shorts and the heels of the cheer shoes.',
        expr='A tight, too-bright closed-lip competition smile that does not reach the eyes. The straps of the black sports bra show at the bottom of frame.'),
    'marcus': dict(ident=ident_of('marcus'), left=A.format(collar='The ribbed collar of the navy tank', extra=' The thin silver chain and small round pendant still sit around the empty collar opening, resting on the fabric.'),
        back='The fade and bleached-tip twists from behind, the cut of the tank across the shoulder blades, the back of the track pants, the ankle brace and the heels of the cheer shoes.',
        expr='A polite, unreadable closed-lip half-smile, calm watchful eyes. The ribbed collar of the navy tank and the silver chain show at the bottom of frame.'),
    'brooke': dict(
        ident=("Female, nineteen, a college sophomore and the most popular girl at every party, slim and polished with a dancer's posture; a strikingly attractive, sharp-featured face, high cheekbones, a narrow straight nose, almond-shaped hazel-green eyes with smoky brown liner and frosted shimmer on the lids, thin arched brows, full lips with a frosted pink gloss closed in a knowing half-smile; warm light-tan skin with a soft sun-kissed finish; glossy dark auburn hair worn long, flat-ironed poker straight with a middle part and two thin face-framing pieces at the front, a small silver butterfly clip on one side; a tiny silver stud in each ear and a thin silver choker; the cool, amused confidence of someone who knows everyone's secret. "
               "Wardrobe: a fitted pale-pink cotton baby tee with a ribbed crew collar, cropped just above the navel; low-rise dark-wash flared jeans with a thin tan leather belt; tan cork-soled platform sandals; a small silver belly-button ring; a thin silver choker."),
        left=A.format(collar='The ribbed crew collar of the pale-pink baby tee', extra=' The thin silver choker still sits around the empty collar opening, resting on the fabric.'),
        back='The long flat-ironed auburn hair falling straight down the back, the cropped hem of the baby tee, the low-rise waist and back pockets of the flared jeans and the heels of the platform sandals.',
        expr='A knowing, amused closed-lip half-smile with frosted pink gloss, eyes steady. The ribbed collar of the pale-pink baby tee and the silver choker show at the bottom of frame.'),
}
out = {}
for n, c in cast.items():
    parts = [OPEN, c['ident'], c['left'], CENTER.format(back=c['back']), RIGHT.format(expr=c['expr']), SKIN, close]
    text = '\n\n'.join(parts) + '\n'
    open(f'sheet-v3-{n}.txt', 'w', encoding='utf-8').write(text)
    out[n] = ' '.join(text.split())
open('sheets-v3.json', 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=True))
print({k: len(v) for k, v in out.items()})
