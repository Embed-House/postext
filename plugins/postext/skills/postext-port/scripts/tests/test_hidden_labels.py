"""Tests of a hidden second set of labels on a figure (#1135): a map whose
degrees are set twice, the visible set over the map and a smaller copy
under its paint, a little off the visible one.

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
    import PIL  # noqa: F401
    HAVE_DEPS = True
except Exception:  # pragma: no cover
    HAVE_DEPS = False

if HAVE_DEPS:
    import pdf_regions as pr

MM = 72 / 25.4
DEGREES = ["0°", "15°", "30°", "45°", "60°", "75°", "90°"]


def draw_page(doc) -> None:
    page = doc.new_page(width=210 * MM, height=297 * MM)
    page.insert_text((20 * MM, 20 * MM), "The map shows the lines of longitude every fifteen degrees.",
                     fontsize=11, fontname="helv")
    # the hidden copy: smaller, 1.2 mm right of and 1 mm under the visible one, painted before the map
    for k, d in enumerate(DEGREES):
        page.insert_text(((31.2 + k * 22) * MM, 51 * MM), d, fontsize=4.5, fontname="helv", color=(0.1, 0.1, 0.1))
    page.draw_rect(fitz.Rect(25 * MM, 40 * MM, 185 * MM, 140 * MM), color=None, fill=(0.6, 0.8, 0.92))
    for i in range(12):
        x, y = 30 + (i % 4) * 38, 60 + (i // 4) * 25
        pts = [fitz.Point((x + a) * MM, (y + b) * MM) for a, b in ((0, 0), (30, 3), (34, 20), (5, 22), (-3, 10))]
        page.draw_polyline(pts + [pts[0]], color=None, fill=(0.35, 0.6, 0.3), closePath=True)
    for k, d in enumerate(DEGREES):
        page.insert_text(((30 + k * 22) * MM, 50 * MM), d, fontsize=5, fontname="helv", color=(0.1, 0.1, 0.1))
    page.insert_text((20 * MM, 285 * MM), "8", fontsize=9, fontname="helv")


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class HiddenLabelsTest(unittest.TestCase):
    def test_only_the_visible_set_is_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            doc = fitz.open()
            draw_page(doc)
            pdf = root / "map.pdf"
            doc.save(str(pdf))
            out = root / "out"
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                pr.main(["extract", str(pdf), "--out", str(out), "--lang", "en", "--name-frames", "never"])
            figs = json.loads((out / "figures.json").read_text(encoding="utf-8"))
            report = json.loads((out / "report.json").read_text(encoding="utf-8"))
        words = [g["plain"] for f in figs["figures"] for g in f["labels"]]
        self.assertEqual(sorted(words, key=lambda w: int(w[:-1])), DEGREES, figs)
        hidden = [t for ts in report["hiddenTexts"].values() for t in ts]
        self.assertEqual(sorted(hidden, key=lambda w: int(w[:-1])), DEGREES)


class Lab:
    def __init__(self, x: float, base: float, size: float, text: str = "10°"):
        self.x0, self.x1, self.base, self.size, self.rotate, self.plain = x, x + 3, base, size, 0.0, text


class SeriesTest(unittest.TestCase):
    def test_two_sizes_in_two_even_rows_over_each_other(self):
        a = [Lab(30 + k * 22, 50, 5.0) for k in range(7)]
        b = [Lab(31 + k * 22, 51, 4.5) for k in range(7)]
        self.assertEqual(pr.label_series(a + b), (4.5, 5.0))
        self.assertIsNone(pr.label_series(a))
        far = [Lab(31 + k * 22, 90, 4.5) for k in range(7)]
        self.assertIsNone(pr.label_series(a + far))
        uneven = [Lab(x, 51, 4.5) for x in (31, 35, 60, 62, 100)]
        self.assertIsNone(pr.label_series(a + uneven))


if __name__ == "__main__":
    unittest.main()
