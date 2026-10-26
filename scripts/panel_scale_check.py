# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=10", "numpy>=1.26"]
# ///
"""Scale check for a three-panel character sheet.

The headless front panel must be at the same camera distance and scale as the rear panel. This lays the
rear body (or a full-body source image, scaled to the rear body's height) over the front panel, feet on
the same floor line, so the head part hangs above the crop; where the front body sticks out, it is bigger.

uv run scripts/panel_scale_check.py SHEET.png OUT.png [--reference SOURCE.png]
Prints JSON: {"ok", "width_ratio", "feet_offset", "verdict", "overlay"}.
"""
import argparse
import json
import sys

import numpy as np
from PIL import Image, ImageFilter

TOLERANCE = 0.05  # 5% wider or narrower, or feet off by 5% of the body height, is "not equal".


def gutters(img: np.ndarray) -> list[tuple[int, int]]:
    """Panels as column ranges, split at the bright, flat gutters between them."""
    gray = img.mean(axis=2)
    body = gray[: int(gray.shape[0] * 0.85)]  # skip the name strip at the bottom
    flat = (body.mean(axis=0) > 248) & (body.std(axis=0) < 6)
    panels, start = [], None
    for x, is_gap in enumerate(flat):
        if not is_gap and start is None:
            start = x
        if is_gap and start is not None:
            if x - start > img.shape[1] * 0.12:
                panels.append((start, x))
            start = None
    if start is not None and img.shape[1] - start > img.shape[1] * 0.12:
        panels.append((start, img.shape[1]))
    if len(panels) != 3:  # no clean gutters: fall back to thirds
        w = img.shape[1] // 3
        panels = [(0, w), (w, 2 * w), (2 * w, img.shape[1])]
    return panels


def body_mask(panel: np.ndarray) -> np.ndarray:
    """Everything that differs from the backdrop (sampled at the panel's top corners), holes filled per row."""
    h, w, _ = panel.shape
    corners = np.concatenate([panel[: h // 20, : w // 10].reshape(-1, 3), panel[: h // 20, -w // 10 :].reshape(-1, 3)])
    backdrop = np.median(corners, axis=0)
    diff = np.abs(panel.astype(np.int16) - backdrop).max(axis=2)
    mask = Image.fromarray(((diff > 28) * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(5))
    raw = np.array(mask) > 0
    filled = np.zeros_like(raw)
    for y in range(h):
        xs = np.flatnonzero(raw[y])
        if xs.size > 3:
            filled[y, xs[0] : xs[-1] + 1] = True
    return filled


def extent(mask: np.ndarray) -> tuple[int, int, float]:
    """Top row, feet row, and the body's width (95th percentile of row widths: shoulders and arms)."""
    rows = np.flatnonzero(mask.any(axis=1))
    widths = mask.sum(axis=1)[rows]
    return int(rows[0]), int(rows[-1]), float(np.percentile(widths, 95))


def crop_body(mask: np.ndarray) -> np.ndarray:
    rows, cols = np.flatnonzero(mask.any(axis=1)), np.flatnonzero(mask.any(axis=0))
    return mask[rows[0] : rows[-1] + 1, cols[0] : cols[-1] + 1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("out")
    ap.add_argument("--reference", help="a full-body source image to lay over instead of the rear panel")
    args = ap.parse_args()

    img = np.array(Image.open(args.sheet).convert("RGB"))
    # Cut off the stamped name strip (a dark band across the full width at the bottom).
    row_mean = img.mean(axis=(1, 2))
    bottom = img.shape[0]
    while bottom > img.shape[0] * 0.8 and row_mean[bottom - 1] < 120:
        bottom -= 1
    img = img[:bottom]
    (_, _), (fx0, fx1), (rx0, rx1) = gutters(img)
    front, rear = img[:, fx0:fx1], img[:, rx0:rx1]
    fmask, rmask = body_mask(front), body_mask(rear)
    f_top, f_feet, f_width = extent(fmask)
    r_top, r_feet, r_width = extent(rmask)
    r_height = r_feet - r_top

    # The "correct" silhouette: the rear body as is, or the source body scaled to the rear body's height.
    if args.reference:
        ref = crop_body(body_mask(np.array(Image.open(args.reference).convert("RGB"))))
        scale = r_height / ref.shape[0]
        ref_img = Image.fromarray((ref * 255).astype(np.uint8)).resize((max(1, round(ref.shape[1] * scale)), r_height + 1))
        ref = np.array(ref_img) > 127
        ref_width = extent(ref)[2]
    else:
        ref = crop_body(rmask)
        ref_width = r_width

    width_ratio = f_width / ref_width
    feet_offset = (f_feet - r_feet) / r_height

    # Overlay: the front panel, dimmed; the correct silhouette in translucent red, feet on the front feet line.
    out = front.astype(np.float32) * 0.85 + 255 * 0.15
    fcols = np.flatnonzero(fmask.any(axis=0))
    cx = (fcols[0] + fcols[-1]) // 2
    y1, x0 = f_feet + 1, cx - ref.shape[1] // 2
    for y in range(ref.shape[0]):
        yy = y1 - ref.shape[0] + y
        if 0 <= yy < out.shape[0]:
            xs = np.flatnonzero(ref[y]) + x0
            xs = xs[(xs >= 0) & (xs < out.shape[1])]
            out[yy, xs] = out[yy, xs] * 0.55 + np.array([230, 40, 40]) * 0.45
    # Where the front body sticks out past the correct silhouette: yellow.
    placed = np.zeros(fmask.shape, bool)
    for y in range(ref.shape[0]):
        yy = y1 - ref.shape[0] + y
        if 0 <= yy < placed.shape[0]:
            xs = np.flatnonzero(ref[y]) + x0
            xs = xs[(xs >= 0) & (xs < placed.shape[1])]
            placed[yy, xs] = True
    out[fmask & ~placed] = out[fmask & ~placed] * 0.4 + np.array([250, 210, 30]) * 0.6
    Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(args.out)

    ok = abs(width_ratio - 1) <= TOLERANCE and abs(feet_offset) <= TOLERANCE
    what = "rear panel" if not args.reference else "source body"
    verdict = (
        f"Front and {what} match in scale ({width_ratio:.2f}x wide)."
        if ok
        else f"Not equal: the front body is {width_ratio:.2f}x as wide as the {what}"
        + (f" and its feet sit {feet_offset * 100:+.0f}% of the body height off the rear floor line" if abs(feet_offset) > TOLERANCE else "")
        + "."
    )
    json.dump({"ok": ok, "width_ratio": round(width_ratio, 3), "feet_offset": round(feet_offset, 3), "verdict": verdict, "overlay": args.out}, sys.stdout)
    print()


if __name__ == "__main__":
    main()
