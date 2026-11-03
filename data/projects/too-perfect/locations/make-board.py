# Build the labelled location model comparison board: models as columns, plates as rows, shared prompts at the bottom.
import glob, textwrap
from PIL import Image, ImageDraw, ImageFont

HERE = __file__.rsplit('\\', 1)[0].rsplit('/', 1)[0]
PROMPTS = HERE + '/../prompts/'
MODELS = [
    ('nbp', 'Nano Banana Pro', '16:9 · 2K · Unlimited (free)'),
    ('seedream', 'Seedream 5.0 Pro', '16:9 · 2K · ~2.5 cr'),
    ('gpt', 'GPT Image 2.5 Sunburst', '16:9 · 2K · High · ~2.75 cr'),
]
PLATES = [('gym', 'Cardinals gym, night', 'plate-gym-v1.txt'), ('locker', 'Locker room, night', 'plate-locker-room-v1.txt')]
CW, CH = 1280, 720
GUT, LEFT, TOP, HEAD = 24, 300, 150, 70
bold = lambda s: ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', s)
reg = lambda s: ImageFont.truetype('C:/Windows/Fonts/arial.ttf', s)

def wrap(text, width):
    return '\n'.join(textwrap.wrap(' '.join(text.split()), width))

prompt_blocks = [(title, wrap(open(PROMPTS + f, encoding='utf-8').read(), 230)) for _, title, f in PLATES]
probe = ImageDraw.Draw(Image.new('RGB', (10, 10)))
prompt_h = sum(probe.multiline_textbbox((0, 0), b, font=reg(17), spacing=4)[3] + 60 for _, b in prompt_blocks)

W = LEFT + len(MODELS) * (CW + GUT) + GUT
H = TOP + len(PLATES) * (CH + HEAD + GUT) + prompt_h + 120
board = Image.new('RGB', (W, H), (18, 18, 20))
d = ImageDraw.Draw(board)
d.text((GUT * 2, 40), 'TOO PERFECT · location model comparison · same Scenecraft prompt per row · 2026-11-02', font=bold(44), fill=(240, 240, 240))

for ci, (key, name, settings) in enumerate(MODELS):
    x = LEFT + GUT + ci * (CW + GUT)
    d.text((x, TOP - 50), name, font=bold(36), fill=(255, 214, 90))
    d.text((x + d.textlength(name, font=bold(36)) + 20, TOP - 42), settings, font=reg(26), fill=(190, 190, 190))
    for ri, (plate, title, _) in enumerate(PLATES):
        y = TOP + ri * (CH + HEAD + GUT) + HEAD
        f = glob.glob(f'{HERE}/{plate}-{key}-*.*')[0]
        img = Image.open(f).convert('RGB')
        img = img.resize((CW, round(img.height * CW / img.width)))
        board.paste(img.crop((0, 0, CW, min(CH, img.height))), (x, y))
        d.text((x, y - 40), f'{name} · {title} · {f.rsplit(chr(92), 1)[-1].rsplit("/", 1)[-1]}', font=reg(24), fill=(170, 170, 170))

for ri, (_, title, _) in enumerate(PLATES):
    y = TOP + ri * (CH + HEAD + GUT) + HEAD
    d.text((GUT * 2, y + CH // 2 - 20), title.upper(), font=bold(30), fill=(240, 240, 240))

y = TOP + len(PLATES) * (CH + HEAD + GUT) + 30
d.text((GUT * 2, y), 'PROMPTS (identical across models; Scenecraft v1 Plate A, no references)', font=bold(28), fill=(255, 214, 90))
y += 50
for title, block in prompt_blocks:
    d.text((GUT * 2, y), title, font=bold(22), fill=(240, 240, 240))
    y += 32
    d.multiline_text((GUT * 2, y), block, font=reg(17), fill=(200, 200, 200), spacing=4)
    y += probe.multiline_textbbox((0, 0), block, font=reg(17), spacing=4)[3] + 28

board.save(HERE + '/location-model-comparison.jpg', quality=90)
print('saved', board.size)
