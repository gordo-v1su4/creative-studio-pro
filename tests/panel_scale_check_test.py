"""Regression: a reference sheet must be cropped before comparing original pixels."""
import importlib.util
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("comparison", Path(__file__).parents[1] / "scripts/panel_scale_check.py")
comparison = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparison)


class OriginalComparisonTest(unittest.TestCase):
    def test_borderless_three_panel_source_uses_front_not_whole_sheet(self):
        image = Image.new('RGB', (900, 600), '#d0c6c4')
        draw = ImageDraw.Draw(image)
        # Front, rear, close-up: the source layout used by Malik.
        draw.rectangle((100, 90, 200, 560), fill='#252025')
        draw.rectangle((400, 20, 500, 560), fill='#252025')
        draw.rectangle((630, 15, 880, 595), fill='#92705f')
        body, note = comparison.original_cutout(image)
        self.assertEqual(body.size, (101, 471))
        self.assertIn('first', note)

    def test_generated_panel_border_does_not_count_as_body_width(self):
        image = Image.new('RGB', (400, 700), '#f5f5f5')
        draw = ImageDraw.Draw(image)
        draw.rectangle((3, 3, 396, 696), outline='black', width=2)
        draw.rectangle((140, 140, 260, 680), fill='#182030')
        body = comparison.cutout(image)
        self.assertEqual(body.size, (121, 541))

    def test_bordered_reference_uses_only_first_full_body_panel(self):
        image = Image.new("RGB", (900, 600), "white")
        draw = ImageDraw.Draw(image)
        for box in [(5, 5, 200, 450), (205, 5, 400, 450), (405, 5, 600, 450), (605, 5, 895, 450), (5, 455, 895, 595)]:
            draw.rectangle(box, outline="black", width=2)
        draw.ellipse((80, 25, 120, 65), fill="#92705f")
        draw.rectangle((65, 65, 135, 250), fill="#182030")
        draw.rectangle((72, 250, 93, 430), fill="#182030")
        draw.rectangle((107, 250, 128, 430), fill="#182030")
        draw.rectangle((220, 30, 880, 420), fill="black")
        cutout, note = comparison.original_cutout(image)
        self.assertGreater(cutout.height / cutout.width, 4)
        self.assertLess(cutout.width, 100)
        self.assertIn("first", note)
        self.assertEqual(cutout.mode, "RGBA")
        self.assertEqual(cutout.getpixel((0, 0))[3], 0)

    def test_uniform_alignment_preserves_aspect_ratio(self):
        image = Image.new("RGBA", (100, 400), (20, 30, 40, 255))
        aligned = comparison.match_width(image, 200)
        self.assertEqual(aligned.size, (200, 800))

    def test_portrait_is_not_accepted_as_a_body_and_single_body_stays_whole(self):
        portrait = Image.new('RGB', (300, 400), 'white')
        ImageDraw.Draw(portrait).ellipse((30, 20, 270, 380), fill='#92705f')
        with self.assertRaises(ValueError):
            comparison.original_cutout(portrait)
        full_body = Image.new('RGB', (300, 700), 'white')
        ImageDraw.Draw(full_body).rectangle((100, 30, 200, 660), fill='#252025')
        body, note = comparison.original_cutout(full_body)
        self.assertEqual(body.size, (101, 631))
        self.assertEqual(note, 'Original full-body image')


if __name__ == "__main__":
    unittest.main()
