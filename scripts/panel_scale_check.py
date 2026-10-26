# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=10", "numpy>=1.26"]
# ///
"""Proportion check for a three-panel character sheet.

The ONE SHOT front panel is the rear panel's body zoomed in evenly: feet in frame, head out of the top. Any
zoom is fine; a stretch is not. This fits the rear body to the front body with a separate horizontal and
vertical zoom (feet anchored, only the rows the front panel shows) and reports the stretch, tall / wide:
1.00 is an even zoom, above 1 the front is stretched taller, below 1 wider.

With --reference SOURCE.png the source's full body is fitted to the sheet's rear panel instead (both show
the whole body), which tells whether the sheet's body is taller or narrower than the person in the photo.

uv run scripts/panel_scale_check.py SHEET.png OUT.png [--reference SOURCE.png]
Prints JSON: {"ok", "zoom", "stretch", "fit", "verdict", "width_ratio", "feet_offset"}.
"""
import argparse
import json
import sys

import numpy as np
from PIL import Image, ImageFilter

TOLERANCE = 0.05  # a stretch beyond 5% either way is "not equal"
WORK_H = 400  # fitting resolution


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


def body_mask(panel: np.ndarray) -> np.ndarray:
    """Everything that differs from the backdrop (sampled at the panel's top corners), holes filled per row."""
    h, w, _ = panel.shape
    corners = np.concatenate([panel[: h // 20, : w // 10].reshape(-1, 3), panel[: h // 20, -w // 10 :].reshape(-1, 3)])
    diff = np.abs(panel.astype(np.int16) - np.median(corners, axis=0)).max(axis=2)
    raw = np.array(Image.fromarray(((diff > 40) * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(5))) > 0
    filled = np.zeros_like(raw)
    for y in range(h):
        xs = np.flatnonzero(raw[y])
        if xs.size > 3:
            filled[y, xs[0] : xs[-1] + 1] = True
    return filled


def crop_body(mask: np.ndarray) -> np.ndarray:
    rows, cols = np.flatnonzero(mask.any(axis=1)), np.flatnonzero(mask.any(axis=0))
    return mask[rows[0] : rows[-1] + 1, cols[0] : cols[-1] + 1]


def place(body: np.ndarray, sx: float, sy: float, shape: tuple[int, int], feet: int, cx: float) -> np.ndarray:
    """The body zoomed by (sx, sy), feet on the given row, centred on cx, on an empty canvas of `shape`."""
    w, h = max(1, round(body.shape[1] * sx)), max(1, round(body.shape[0] * sy))
    zoomed = np.array(Image.fromarray((body * 255).astype(np.uint8)).resize((w, h))) > 127
    canvas = np.zeros(shape, bool)
    y0, x0 = feet + 1 - h, round(cx - w / 2)
    ys, xs, ye, xe = max(0, y0), max(0, x0), min(shape[0], y0 + h), min(shape[1], x0 + w)
    if ye > ys and xe > xs:
        canvas[ys:ye, xs:xe] = zoomed[ys - y0 : ye - y0, xs - x0 : xe - x0]
    return canvas


def fit(target: np.ndarray, body: np.ndarray, top_cropped: bool) -> tuple[float, float, float]:
    """Best (sx, sy, overlap) laying `body` over `target`, feet anchored; compares only rows the target shows."""
    rows, cols = np.flatnonzero(target.any(axis=1)), np.flatnonzero(target.any(axis=0))
    top, feet, cx = rows[0], rows[-1], (cols[0] + cols[-1]) / 2
    region = slice(top + (2 if top_cropped else 0), feet + 1)
    base = (feet - top) / body.shape[0]  # the zoom that would make the heights match
    best = (0.0, 1.0, 1.0)
    for sx in np.arange(0.6, 1.8, 0.02) * (1 if top_cropped else base):
        for sy in np.arange(0.6, 1.8, 0.02) * (1 if top_cropped else base):
            placed = place(body, sx, sy, target.shape, feet, cx)
            a, b = target[region], placed[region]
            overlap = (a & b).sum() / max(1, (a | b).sum())
            if overlap > best[0]:
                best = (overlap, sx, sy)
    return best[1], best[2], best[0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("out")
    ap.add_argument("--reference", help="a full-body source image to fit to the sheet's rear panel")
    args = ap.parse_args()

    full = Image.open(args.sheet).convert("RGB")
    img = np.array(full)
    # Cut off the stamped name strip (a dark band across the full width at the bottom).
    row_mean = img.mean(axis=(1, 2))
    bottom = img.shape[0]
    while bottom > img.shape[0] * 0.8 and row_mean[bottom - 1] < 120:
        bottom -= 1
    img = img[:bottom]
    (_, _), (fx0, fx1), (rx0, rx1) = gutters(img)
    k = WORK_H / img.shape[0]
    small = np.array(Image.fromarray(img).resize((round(img.shape[1] * k), WORK_H)))
    front_small = body_mask(small[:, round(fx0 * k) : round(fx1 * k)])
    rear_small = body_mask(small[:, round(rx0 * k) : round(rx1 * k)])

    if args.reference:
        src = Image.open(args.reference).convert("RGB")
        src_small = np.array(src.resize((round(src.width * WORK_H / src.height), WORK_H)))
        target, body, top_cropped, what = rear_small, crop_body(body_mask(src_small)), False, "the source photo"
        panel = img[:, rx0:rx1]
    else:
        target, body, top_cropped, what = front_small, crop_body(rear_small), True, "the rear panel"
        panel = img[:, fx0:fx1]
    sx, sy, overlap = fit(target, body, top_cropped)
    stretch = sy / sx

    # Overlay at full size: the panel dimmed, the fitted correct body in red, the panel's overhang in yellow.
    full_target = body_mask(panel)
    rows, cols = np.flatnonzero(full_target.any(axis=1)), np.flatnonzero(full_target.any(axis=0))
    body_full = np.array(Image.fromarray((body * 255).astype(np.uint8)).resize((round(body.shape[1] / k), round(body.shape[0] / k)))) > 127
    placed = place(body_full, sx, sy, full_target.shape, rows[-1], (cols[0] + cols[-1]) / 2)
    out = panel.astype(np.float32) * 0.85 + 255 * 0.15
    out[placed] = out[placed] * 0.55 + np.array([230, 40, 40]) * 0.45
    over = full_target & ~placed
    out[over] = out[over] * 0.4 + np.array([250, 210, 30]) * 0.6
    Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(args.out)

    sx, sy, stretch, overlap = float(sx), float(sy), float(stretch), float(overlap)
    ok = bool(abs(stretch - 1) <= TOLERANCE)
    zoom = (sx + sy) / 2
    if ok:
        verdict = f"Proportions match {what}: an even zoom ({stretch:.2f} tall to wide)."
    elif stretch > 1:
        verdict = f"Not equal: the body is stretched {stretch:.2f}x taller for its width than {what}."
    else:
        verdict = f"Not equal: the body is {1 / stretch:.2f}x wider for its height than {what}."
    json.dump({"ok": ok, "zoom": round(zoom, 3), "stretch": round(stretch, 3), "fit": round(overlap, 3), "verdict": verdict,
               "width_ratio": round(sx, 3), "feet_offset": 0.0}, sys.stdout)
    print()


if __name__ == "__main__":
    main()
