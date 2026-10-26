# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=10", "numpy>=1.26"]
# ///
"""Compare original front-body pixels with a generated front using uniform scaling only. A bordered source sheet uses its first full-body panel. Plain full-body images use the whole image. Portraits and unsupported collages require a full-body crop. No generated rear baseline, anisotropic fitting, or automated anatomy verdict."""
import argparse
import json
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageDraw, ImageFont





def cutout(image: Image.Image) -> Image.Image:
    """Keep original RGB pixels; remove a plain studio backdrop, with no synthesis."""
    rgb = np.array(image.convert('RGB'))
    h, w = rgb.shape[:2]
    corners = np.concatenate([rgb[:max(1, h // 30), :max(1, w // 20)].reshape(-1, 3), rgb[:max(1, h // 30), -max(1, w // 20):].reshape(-1, 3)])
    backdrop = np.median(corners, axis=0)
    mask = np.abs(rgb.astype(float) - backdrop).max(axis=2) > 42
    mask = np.array(Image.fromarray((mask * 255).astype('uint8')).filter(ImageFilter.MedianFilter(3))) > 0
    exterior = Image.fromarray((mask * 255).astype('uint8')).copy()
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, h - 1)]:
        if exterior.getpixel(seed) == 0:
            ImageDraw.floodfill(exterior, seed, 128)
    # White clothing enclosed by the silhouette is part of the person, not backdrop.
    mask = np.array(exterior) != 128
    rows, cols = np.flatnonzero(mask.any(axis=1)), np.flatnonzero(mask.any(axis=0))
    if not len(rows) or not len(cols):
        raise ValueError('No body found against a plain background. Use a cropped full-body reference.')
    rgba = np.dstack([rgb, (mask * 255).astype('uint8')])
    return Image.fromarray(rgba).crop((cols[0], rows[0], cols[-1] + 1, rows[-1] + 1))


def original_cutout(image: Image.Image) -> tuple[Image.Image, str]:
    """A bordered reference grid uses its first full-body panel, never the entire collage."""
    rgb = np.array(image.convert('RGB'))
    h, w = rgb.shape[:2]
    dark = rgb.mean(axis=2) < 100
    vertical = np.flatnonzero(dark[int(h * .08):int(h * .6)].mean(axis=0) > .98)
    horizontal = np.flatnonzero(dark.mean(axis=1) > .95)
    right = vertical[(vertical > w * .12) & (vertical < w * .5)]
    bottom = horizontal[(horizontal > h * .4) & (horizontal < h * .85)]
    note = 'Original full-body image'
    if len(right) and len(bottom):
        outer_lines = np.flatnonzero(dark[int(h * .08):int(h * .6)].mean(axis=0) > .85)
        lefts = outer_lines[outer_lines < w * .025]
        tops = horizontal[horizontal < h * .08]
        left = int(lefts[-1]) if len(lefts) else 0
        top = int(tops[-1]) if len(tops) else 0
        margin = max(4, round(w * .003))
        image = image.crop((left + margin, top + margin, int(right[0]) - margin, int(bottom[0]) - margin))
        note = 'Original: first full-body panel of source sheet'
    result = cutout(image)
    if result.height / result.width < 1.8:
        raise ValueError('This source is not an isolated full-body view. Use a front full-body crop, not a portrait or collage.')
    return result, note


def match_width(image: Image.Image, width: int) -> Image.Image:
    return image.resize((width, round(image.height * width / image.width)), Image.Resampling.LANCZOS)


def source_comparison(sheet: Image.Image, source: Image.Image, out: str) -> dict:
    rgb = np.array(sheet.convert('RGB'))
    bottom = rgb.shape[0]
    while bottom > rgb.shape[0] * .8 and rgb[bottom - 1].mean() < 120:
        bottom -= 1
    rgb = rgb[:bottom]
    (_, _), (x0, x1), (_, _) = gutters(rgb)
    generated = cutout(Image.fromarray(rgb[:, x0:x1]))
    original, note = original_cutout(source)
    # One scalar per picture. Width matching makes extra body/leg length visible;
    # fitting X and Y independently would hide precisely the distortion being reviewed.
    width = 260
    a, b = match_width(original, width), match_width(generated, width)
    height = max(a.height, b.height)
    col, top, foot = 380, 110, height + 110
    canvas = Image.new('RGB', (col * 3, foot + 120), '#eeeeec')
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype('DejaVuSans.ttf', 18) if sys.platform != 'win32' else ImageFont.truetype('arial.ttf', 18)
    draw.text((20, 15), 'Original reference vs generated FRONT - visual comparison', fill='#202020', font=font)
    draw.text((20, 43), 'Same body width; feet aligned. Uniform scaling only. No automatic pass/fail.', fill='#404040', font=font)
    for i, title in enumerate(['ORIGINAL CUTOUT', 'GENERATED FRONT', 'OVERLAY: 50% OPACITY']):
        draw.text((i * col + 14, 79), title, fill='#202020', font=font)
        draw.line((i * col + 12, foot, (i + 1) * col - 12, foot), fill='#666666', width=2)
    for i, image in [(0, a), (1, b), (2, b)]:
        canvas.paste(image, (i * col + (col - width) // 2, foot - image.height), image)
    ghost = a.copy()
    ghost.putalpha(ghost.getchannel('A').point(lambda value: round(value * .5)))
    canvas.paste(ghost, (2 * col + (col - width) // 2, foot - a.height), ghost)
    draw.text((20, foot + 25), note, fill='#303030', font=font)
    draw.text((20, foot + 52), 'Compare shoulders, waist, crotch, knees and ankles. Width matching does not certify anatomy.', fill='#303030', font=font)
    draw.text((20, foot + 79), '50% opacity means see-through. It does not mean 50% larger or a 50% proportion error.', fill='#303030', font=font)
    canvas.save(out)
    return {'ok': True, 'width_ratio': 1, 'feet_offset': 0, 'method': 'original-front-v1',
            'verdict': f'{note}. Original pixels, matched body width and aligned feet; neither image is stretched. Visual comparison only.'}


def gutters(img: np.ndarray) -> list[tuple[int, int]]:
    """Panels as column ranges, split at the bright, flat gutters between them; thirds when there are none."""
    gray = img.mean(axis=2)
    body = gray[: int(gray.shape[0] * 0.95)]
    flat = list((body.mean(axis=0) > 248) & (body.std(axis=0) < 6)) + [True]
    panels, start = [], None
    for x, is_gap in enumerate(flat):
        if not is_gap and start is None:
            start = x
        if is_gap and start is not None:
            if x - start > img.shape[1] * 0.12:
                panels.append((start, x))
            start = None
    if len(panels) != 3:
        w = img.shape[1] // 3
        panels = [(0, w), (w, 2 * w), (2 * w, img.shape[1])]
    return panels


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("out")
    ap.add_argument("--reference", help="original front full-body image or bordered reference sheet (first panel)")
    args = ap.parse_args()

    if not args.reference:
        ap.error('Choose an original full-body source image. Generated rear panels are not a reference baseline.')
    result = source_comparison(Image.open(args.sheet), Image.open(args.reference), args.out)
    print(json.dumps(result))
    return

if __name__ == "__main__":
    main()
