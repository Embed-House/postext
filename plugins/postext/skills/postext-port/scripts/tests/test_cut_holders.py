"""Tests of picture cuts against the box that holds them (#1134): a drawn
map in a ruled box is cut to its own ground, inside the box's rule.

    python3 -m unittest discover -s plugins/postext/skills/postext-port/scripts/tests
"""
from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

try:
    import fitz
    import numpy as np
    from PIL import Image
    HAVE_DEPS = True
except Exception:  # pragma: no cover
    HAVE_DEPS = False

if HAVE_DEPS:
    import pdf_regions as pr

MM = 72 / 25.4
RULE = (0.85, 0.1, 0.45)        # the box's rule
TINT = (0.97, 0.95, 0.88)       # the box's fill
SEA = (0.55, 0.78, 0.92)        # the map's ground
LAND = (0.35, 0.6, 0.3)


def R(x0, y0, x1, y1):
    return fitz.Rect(x0 * MM, y0 * MM, x1 * MM, y1 * MM)


def text(page, x, y, s, size=11):
    page.insert_text((x * MM, y * MM), s, fontsize=size, fontname="helv", color=(0.1, 0.1, 0.1))


def land(page, x0, y0, x1, y1, n=12, cover=1.1):
    for i in range(n):
        x, y = x0 + (i % 4) * (x1 - x0) / 4, y0 + (i // 4) * (y1 - y0) / 3
        dx, dy = (x1 - x0) / 4 * cover, (y1 - y0) / 3 * cover    # over 1: neighbours overlap, one cluster
        pts = [fitz.Point((x + a * dx) * MM, (y + b * dy) * MM)
               for a, b in ((0.1, 0.1), (0.9, 0.2), (1.0, 0.9), (0.3, 1.0), (0.05, 0.5))]
        page.draw_polyline(pts + [pts[0]], color=None, fill=LAND, closePath=True)


def draw_page(doc) -> None:
    page = doc.new_page(width=210 * MM, height=297 * MM)
    text(page, 20, 20, "The map in the box below shows the coast and the islands off it.")
    # box 1: a ruled box holding a sentence and a map drawn on its sea; a white mask painted
    # after the map hides its overflow and runs out over the box's rule
    page.draw_rect(R(20, 30, 190, 140), color=RULE, fill=TINT, width=2)
    text(page, 26, 40, "Look for the islands and name each of them in your notebook.")
    page.draw_rect(R(40, 50, 170, 130), color=None, fill=SEA)
    land(page, 42, 52, 168, 128, cover=0.6)
    page.draw_rect(R(170, 50, 195, 130), color=None, fill=(1, 1, 1))
    # box 2: a ruled box whose map has no ground of its own and runs past the rule
    page.draw_rect(R(20, 160, 190, 270), color=RULE, fill=TINT, width=2)
    text(page, 26, 170, "Here the land runs right up to the rule of the box round it.")
    land(page, 16, 180, 194, 262)
    text(page, 20, 285, "4", size=9)


def has_colour(file: Path, rgb: tuple, tol: int = 60) -> int:
    with Image.open(file) as im:
        a = np.asarray(im.convert("RGB"), dtype=int)
    want = np.array([round(v * 255) for v in rgb])
    return int((np.abs(a - want).sum(axis=2) < tol).sum())


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class HolderCutTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        doc = fitz.open()
        draw_page(doc)
        cls.pdf = root / "holders.pdf"
        doc.save(str(cls.pdf))
        cls.out = root / "out"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            pr.main(["extract", str(cls.pdf), "--out", str(cls.out), "--lang", "en", "--name-frames", "never"])
        cls.regions = json.loads((cls.out / "regions.json").read_text(encoding="utf-8"))
        cls.res = {r["id"]: r for r in json.loads((cls.out / "resources.json").read_text(encoding="utf-8"))}
        cls.report = json.loads((cls.out / "report.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def pictures(self) -> list[dict]:
        return sorted((f for f in self.regions[0]["frames"] if f["kind"] in ("picture", "figure")),
                      key=lambda f: f["box"][1])

    def file_of(self, frame: dict) -> Path:
        rid = next(k for k in self.res if k.endswith(frame["name"]))
        return self.out / self.res[rid]["file"]

    def test_the_map_is_cut_to_its_own_ground(self):
        pic = self.pictures()[0]
        for got, want in zip(pic["box"], (40, 50, 170, 130)):
            self.assertAlmostEqual(got, want, delta=0.6, msg=pic["box"])
        self.assertEqual(has_colour(self.file_of(pic), RULE), 0)

    def test_a_map_without_a_ground_stays_inside_the_rule(self):
        pic = self.pictures()[1]
        half = 1 * 25.4 / 72      # half the 2 pt rule
        self.assertGreaterEqual(pic["box"][0], 20 + half - 0.05, pic["box"])
        self.assertLessEqual(pic["box"][2], 190 - half + 0.05, pic["box"])
        self.assertLessEqual(pic["box"][3], 270 - half + 0.05, pic["box"])
        self.assertEqual(has_colour(self.file_of(pic), RULE), 0)

    def test_no_cut_crosses_a_rule(self):
        notes = [n for ns in self.report["notes"].values() for n in ns]
        self.assertFalse([n for n in notes if "crosses the rule" in n], notes)


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class HelpersTest(unittest.TestCase):
    def shape(self, rect, fill=None, color=None, width=1.0, seq=0):
        d = {"rect": R(*rect), "fill": fill, "color": color, "width": width if color else None,
             "items": [("re", R(*rect), 1)], "seqno": seq}
        return pr.Shape(d, (0, 0, 210, 297))

    def test_crossed_rules(self):
        ruled = self.shape((20, 30, 190, 140), color=RULE)
        self.assertEqual(pr.crossed_rules((10, 40, 100, 100), [ruled]), [ruled])     # the left rule runs down it
        self.assertEqual(pr.crossed_rules((30, 40, 100, 100), [ruled]), [])          # inside the box
        self.assertEqual(pr.crossed_rules((30, 40, 100, 100), [self.shape((20, 30, 190, 140), fill=TINT)]), [])

    def test_holder_and_ground(self):
        outer = self.shape((10, 10, 200, 200), fill=TINT, color=RULE)
        inner = self.shape((20, 20, 120, 120), fill=TINT, color=RULE)
        self.assertIs(pr.holder_of((30, 30, 110, 110), [outer, inner]), inner)
        self.assertIsNone(pr.holder_of((30, 30, 110, 110), [outer, inner], over={id(inner), id(outer)}))
        sea = self.shape((30, 30, 100, 100), fill=SEA, seq=1)
        isles = [self.shape((40 + i * 10, 40, 45 + i * 10, 45), fill=LAND, seq=2 + i) for i in range(5)]
        self.assertEqual(pr.art_ground((25, 25, 105, 105), [sea] + isles), sea.box)
        stray = [self.shape((101, 40 + i, 104, 41 + i), fill=LAND, seq=10 + i) for i in range(3)]
        self.assertIsNone(pr.art_ground((25, 25, 105, 105), [sea] + isles + stray))


if __name__ == "__main__":
    unittest.main()
