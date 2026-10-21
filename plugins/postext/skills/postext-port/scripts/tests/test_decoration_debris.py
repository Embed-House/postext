"""Tests of the debris kept out of a draft's decoration (#1131): white masks
that paint their own ground, fills a later box hides, text-less boxes under
a picture, and furniture copied into modules.

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
    import numpy  # noqa: F401
    from PIL import Image
    HAVE_DEPS = True
except Exception:  # pragma: no cover
    HAVE_DEPS = False

import template_fold as tf  # noqa: E402

if HAVE_DEPS:
    import pdf_regions as pr

MM = 72 / 25.4
ICON = (0.9, 0.4, 0.1)
SLIVER = (0.2, 0.7, 0.3)       # a fill a box hides but for a sliver
RING = (0.6, 0.2, 0.7)         # a fill a box hides but for a ring round it
COVER = (0.85, 0.9, 0.97)      # the boxes painted over them
LAND = (0.35, 0.6, 0.3)
PANEL = (0.95, 0.9, 0.7)


def R(x0, y0, x1, y1):
    return fitz.Rect(x0 * MM, y0 * MM, x1 * MM, y1 * MM)


def text(page, x, y, s, size=11):
    page.insert_text((x * MM, y * MM), s, fontsize=size, fontname="helv", color=(0.1, 0.1, 0.1))


def photo(w, h) -> bytes:
    im = Image.new("RGB", (w, h), (200, 60, 60))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def draw_page(doc) -> None:
    page = doc.new_page(width=210 * MM, height=297 * MM)
    text(page, 20, 20, "A page with masks, hidden fills and a map with an inset photo on it.")
    # a white mask on the white paper, over nothing
    page.draw_rect(R(20, 30, 60, 50), color=None, fill=(1, 1, 1))
    # an icon, half under a white mask painted after it: the mask stays
    page.draw_polyline([fitz.Point(x * MM, y * MM) for x, y in ((80, 30), (100, 30), (90, 48), (80, 30))],
                       color=None, fill=ICON, closePath=True)
    page.draw_rect(R(90, 28, 110, 50), color=None, fill=(1, 1, 1))
    # a fill a box with words hides but for a 0.3 mm sliver, and one it hides but for a ring
    page.draw_rect(R(20, 60, 90, 100), color=None, fill=SLIVER)
    page.draw_rect(R(20, 60, 90, 99.7), color=None, fill=COVER)
    text(page, 24, 70, "This box covers the green fill painted before it.")
    page.draw_rect(R(110, 60, 190, 100), color=None, fill=RING)
    page.draw_rect(R(113, 63, 187, 97), color=None, fill=COVER)
    text(page, 116, 73, "A ring of purple shows round this box.")
    # a drawn map, and on it a panel holding an inset photo (no words)
    for i in range(12):
        x, y = 30 + (i % 4) * 36, 120 + (i // 4) * 25
        pts = [fitz.Point((x + a) * MM, (y + b) * MM) for a, b in ((0, 0), (34, 3), (38, 24), (6, 26), (-3, 12))]
        page.draw_polyline(pts + [pts[0]], color=None, fill=LAND, closePath=True)
    page.draw_rect(R(120, 150, 150, 170), color=None, fill=PANEL)
    page.insert_image(R(124, 154, 131, 160), stream=photo(70, 60))
    text(page, 20, 285, "5", size=9)


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class DebrisTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        doc = fitz.open()
        draw_page(doc)
        cls.pdf = root / "debris.pdf"
        doc.save(str(cls.pdf))
        cls.out = root / "out"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            pr.main(["extract", str(cls.pdf), "--out", str(cls.out), "--lang", "en", "--name-frames", "never"])
        lib = json.loads((cls.out / "library.json").read_text(encoding="utf-8"))
        cls.els = lib["pageTemplates"][0]["decoration"]["elements"]
        cls.regions = json.loads((cls.out / "regions.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def filled(self, rgb, tol=0.03) -> list[dict]:
        out = []
        for e in self.els:
            c = e.get("fill") or (e.get("style") or {}).get("backgroundColor")
            if isinstance(c, dict) and all(abs(a - b) <= tol for a, b in zip(pr.td.hex_rgb(c["hex"]), rgb)):
                out.append(e)
        return out

    def placed_x(self, e: dict) -> float:
        return e["placement"]["offset"]["x"]["value"]

    def test_a_white_mask_on_white_paper_is_dropped(self):
        whites = self.filled((1, 1, 1))
        self.assertFalse([e for e in whites if self.placed_x(e) < 70], whites)

    def test_a_mask_over_loose_art_stays(self):
        self.assertEqual(len(self.filled(ICON)), 1)
        self.assertEqual(len([e for e in self.filled((1, 1, 1)) if 85 < self.placed_x(e) < 95]), 1)

    def test_a_fill_that_shows_a_sliver_is_dropped_a_ring_stays(self):
        self.assertEqual(self.filled(SLIVER), [])
        self.assertEqual(len(self.filled(RING)), 1)

    def test_a_box_with_no_words_under_a_picture_is_its_art(self):
        frames = self.regions[0]["frames"]
        self.assertFalse([f for f in frames if f["kind"] == "box" and f["box"][0] > 115 and f["box"][1] > 145], frames)
        self.assertEqual(self.filled(PANEL), [])
        self.assertTrue([f for f in frames if f["kind"] in ("picture", "figure") and f["box"][1] < 150 < f["box"][3]])


def mmv(v):
    return {"value": v, "unit": "mm"}


def placed(x, y, w=None, h=None):
    pl = {"anchor": {"to": "page", "edge": "top-left"}, "offset": {"x": mmv(x), "y": mmv(y)}}
    if w is not None:
        pl["size"] = {"width": mmv(w), "height": mmv(h)}
    return pl


class FurnitureTest(unittest.TestCase):
    def plan(self, folio_y: float) -> dict:
        frame = lambda n, y: {"name": n, "placement": {"anchor": {"to": "container", "edge": "top-left"},  # noqa: E731
                                                       "offset": {"x": mmv(15), "y": mmv(y)}},
                              "width": mmv(180), "minHeight": mmv(30), "style": "b"}
        t = {"id": "p01", "area": "trim", "frames": [frame("box-1", 20), frame("box-2", 150)],
             "decoration": {"elements": [
                 {"kind": "path", "id": "shape-1", "d": "M0 0 H50 V20 Z", "viewBox": [50, 20],
                  "fill": {"hex": "#ff0000", "model": "hex"}, "placement": placed(20, 25, 50, 20)},
                 {"kind": "text", "id": "folio", "content": "{pageNumber}", "placement": {**placed(25, folio_y),
                  "size": {"width": mmv(10)}}, "fontSize": {"value": 9, "unit": "pt"}}]}}
        rects = {"box-1": (15, 20, 195, 50), "box-2": (15, 150, 195, 180)}
        return tf.plan_page_modules(t, rects, {"box-1": "box", "box-2": "box"}, {"box-1": None, "box-2": None})

    def test_furniture_over_moved_art_stays_on_the_shell_and_is_reported(self):
        plan = self.plan(30)
        self.assertIn("folio", plan["keep"])
        self.assertEqual(plan["conflicts"], ["folio"])
        self.assertFalse(any("folio" in m["ids"] for m in plan["modules"]))

    def test_furniture_clear_of_the_art_is_no_conflict(self):
        plan = self.plan(285)
        self.assertIn("folio", plan["keep"])
        self.assertEqual(plan["conflicts"], [])


if __name__ == "__main__":
    unittest.main()
