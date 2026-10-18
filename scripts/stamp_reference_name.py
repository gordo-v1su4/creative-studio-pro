# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow>=10.1"]
# ///
"""Stamp a reference's exact Name along the bottom of its image (V1S-326). No regeneration.

The send gate refuses a reference whose name is not printed on the sheet. For a vetted image that lacks it,
this adds a dark band with the exact Name in white along the bottom and writes a copy (the original is left
alone). Then tick "Name on sheet" in Notion and upload the stamped copy from the References drawer.

    uv run scripts/stamp_reference_name.py "<image>" "<exact name>" [--out <file>]

The output file name contains the exact name (letters and digits) so the send gate's file-name check passes.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

MIN_LONG_EDGE = 2048


def slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_")


def font_for(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in ("arialbd.ttf", "Arial Bold.ttf", "DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf"):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def stamp(source: Path, name: str, out: Path) -> Path:
    image = Image.open(source).convert("RGB")
    width, height = image.size
    if max(width, height) < MIN_LONG_EDGE:
        raise SystemExit(f"{source.name} is {width}x{height}; references must be at least {MIN_LONG_EDGE} px on the long edge")
    band = max(48, round(height * 0.06))
    canvas = Image.new("RGB", (width, height + band), (12, 12, 14))
    canvas.paste(image, (0, 0))
    draw = ImageDraw.Draw(canvas)
    size = round(band * 0.55)
    font = font_for(size)
    # Shrink until the name fits with a margin.
    while draw.textlength(name, font=font) > width * 0.92 and size > 12:
        size -= 2
        font = font_for(size)
    text_width = draw.textlength(name, font=font)
    draw.text(((width - text_width) / 2, height + (band - size) / 2 - size * 0.1), name, fill=(245, 245, 245), font=font)
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out, quality=95) if out.suffix.lower() in (".jpg", ".jpeg") else canvas.save(out)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("image", type=Path)
    parser.add_argument("name", help='the exact Name from Notion, e.g. Kai "Hoodie" Santana')
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    if not args.image.is_file():
        sys.exit(f"No such image: {args.image}")
    out = args.out or args.image.with_name(f"{slug(args.name)}_named{args.image.suffix or '.png'}")
    print(stamp(args.image, args.name, out))


if __name__ == "__main__":
    main()
