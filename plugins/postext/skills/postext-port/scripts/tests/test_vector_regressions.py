"""What the vector draft of `pdf_regions.py extract` (round 2) broke and
put right since (#1138–#1141), on pages drawn in the test with PyMuPDF: a
chart keeps its lettering, pieces of a line join only when they belong
together, connector ends measured on the laid box, slanted leaders, clip
paths, hatching and the raster fallback.

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

if HAVE_DEPS:
    import anchors as anc
    import pdf_regions as pr

MM = 72 / 25.4
INK = (0.15, 0.15, 0.15)
BAR = (0.25, 0.5, 0.8)
CURVE = (0.85, 0.3, 0.1)
GRID = (0.75, 0.75, 0.75)
MONTHS = "EFMAMJJASOND"


def R(x0, y0, x1, y1):
    return fitz.Rect(x0 * MM, y0 * MM, x1 * MM, y1 * MM)


def P(x, y):
    return fitz.Point(x * MM, y * MM)


def text(page, x, y, s, size=11, font="helv", color=INK, rotate=0):
    page.insert_text(P(x, y), s, fontsize=size, fontname=font, color=color, rotate=rotate)


def body(page, y0: float, n: int = 6) -> None:
    """Running text that sets the page's body size (11 pt)."""
    for k in range(n):
        text(page, 20, y0 + k * 5.6, "Running text of the page, set in the body size so that headings stand out.")


def run_extract(doc, *more):
    tmp = tempfile.TemporaryDirectory()
    root = Path(tmp.name)
    pdf = root / "src.pdf"
    doc.save(str(pdf))
    out = root / "out"
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        pr.main(["extract", str(pdf), "--out", str(out), "--lang", "en", "--name-frames", "never", *more])
    return tmp, out


def load(out: Path) -> tuple[dict, list, str, list]:
    lib = json.loads((out / "library.json").read_text(encoding="utf-8"))
    res = json.loads((out / "resources.json").read_text(encoding="utf-8"))
    md = (out / "chapters" / "en" / "01-pages.md").read_text(encoding="utf-8")
    regions = json.loads((out / "regions.json").read_text(encoding="utf-8"))
    return lib, res, md, regions


def page_lines(doc):
    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp.close()
    doc.save(tmp.name)
    src = fitz.open(tmp.name)
    page = src[0]
    lines, _ = pr.read_lines(tmp.name, page, pr.Fonts(), pr.trim_origin(page))
    return lines


# ---------------------------------------------------------------------------
# III-1: charts and their lettering (#1138)
# ---------------------------------------------------------------------------


def draw_chart_page(doc):
    """Running text over a vector bar-and-line chart: axes, a grid, ticks,
    twelve bars with month initials under them, a line over the bars,
    figures up the side and turned axis titles."""
    page = doc.new_page(width=210 * MM, height=297 * MM)
    body(page, 30)
    x0, x1, y0, y1 = 40.0, 160.0, 90.0, 150.0         # the plot
    for k in range(5):                                  # grid and the figures up the side
        y = y1 - k * 15
        page.draw_line(P(x0, y), P(x1, y), color=GRID, width=0.3)
        page.draw_line(P(x0 - 1.5, y), P(x0, y), color=INK, width=0.5)      # a tick
        s = str(k * 10)
        w = fitz.get_text_length(s, fontname="helv", fontsize=7) / MM
        text(page, x0 - 2.5 - w, y + 1.0, s, size=7)
    step = (x1 - x0) / 12
    pts = []
    for i, m in enumerate(MONTHS):
        bx = x0 + i * step + 2
        h = 10 + (i * 7) % 40
        page.draw_rect(R(bx, y1 - h, bx + step - 4, y1), color=None, fill=BAR)
        text(page, bx + (step - 4) / 2 - 1.0, y1 + 4, m, size=7)
        pts.append(P(bx + (step - 4) / 2, y1 - 8 - (i * 11) % 45))
    page.draw_polyline(pts, color=CURVE, width=1.2)
    page.draw_line(P(x0, y1), P(x1, y1), color=INK, width=0.8)      # the axes
    page.draw_line(P(x0, y0 - 5), P(x0, y1), color=INK, width=0.8)
    text(page, 28, 140, "Temperature, yearly mean (C)", size=7, rotate=90)
    text(page, 95, 161, "Months", size=7)
    body(page, 180)
    return page


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class ChartTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        doc = fitz.open()
        draw_chart_page(doc)
        cls.tmp, cls.out = run_extract(doc)
        cls.lib, cls.res, cls.md, cls.regions = load(cls.out)
        cls.frames = cls.regions[0]["frames"]

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_one_picture_holds_the_whole_chart(self):
        pics = [f for f in self.frames if f["kind"] in ("picture", "figure")]
        self.assertEqual(len(pics), 1, pics)
        self.assertEqual(pics[0]["kind"], "picture")       # no labels lifted
        x0, y0, x1, y1 = pics[0]["box"]
        self.assertLessEqual(x0, 29.0)                     # the turned title is in
        self.assertGreaterEqual(x1, 159.5)
        self.assertGreaterEqual(y1, 160.5)                 # the axis title under the months

    def test_the_lettering_stays_in_the_cut(self):
        self.assertNotIn("::label", self.md)
        texts = " ".join(f["text"] for f in self.frames)
        for word in ("Temperature", "Months", " 30", "J "):
            self.assertNotIn(word, texts)
        pic = next(f for f in self.frames if f["kind"] == "picture")
        res = next(r for r in self.res if r["typeId"] == "picture")
        with Image.open(self.out / res["file"]) as im:
            rgb = im.convert("RGB")
            w, h = rgb.size
            bx = pic["box"]
            k = w / (bx[2] - bx[0])
            # the figures up the side (left of the axis, at 40 mm) print in the cut
            crop = rgb.crop((int((33 - bx[0]) * k), int((118 - bx[1]) * k), int((39 - bx[0]) * k), int((151 - bx[1]) * k)))
            dark = sum(1 for p in crop.getdata() if sum(p) < 300)
        self.assertGreater(dark, 20)
        self.assertTrue(any("chart" in n for n in json.loads((self.out / "report.json").read_text())["notes"]["1"]))


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class ChartHelpersTest(unittest.TestCase):
    def test_tick_text(self):
        for t in ("10", "-2,5", "40 %", "E", "1 000"):
            self.assertTrue(pr.tick_text(t), t)
        for t in ("20°N", "Months", "Q1", ""):
            self.assertFalse(pr.tick_text(t), t)

    def test_join_lines_takes_axes_not_pointers(self):
        class S:
            def __init__(self, box, seq):
                self.box, self.seq = box, seq

            @property
            def w(self):
                return self.box[2] - self.box[0]

            @property
            def h(self):
                return self.box[3] - self.box[1]

        bars = [{"box": (42 + 10 * i, 120, 48 + 10 * i, 150), "n": 1, "images": []} for i in range(4)]
        axis = S((40, 150, 82, 150), 1)          # under every bar, a little past them
        pointer = S((60, 130, 130, 130), 2)      # from a bar out to a note far off
        out = pr.join_lines(bars, [axis, pointer], 1.0)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["n"], 5)
        self.assertLess(out[0]["box"][2], 90)


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class MergePiecesTest(unittest.TestCase):
    def test_ticks_stay_apart_and_digits_take_no_space(self):
        doc = fitz.open()
        page = doc.new_page(width=210 * MM, height=297 * MM)
        # two ticks of a chart 0.6 em apart, and a number set in two pieces 0.15 em apart
        page.insert_text(fitz.Point(40, 100), "5", fontsize=8, fontname="helv")
        page.insert_text(fitz.Point(40 + fitz.get_text_length("5", fontsize=8) + 7.2, 100), "0", fontsize=8,
                         fontname="helv")
        page.insert_text(fitz.Point(40, 200), "1", fontsize=12, fontname="helv")
        page.insert_text(fitz.Point(40 + fitz.get_text_length("1", fontsize=12) + 1.8, 200), "000", fontsize=12,
                         fontname="helv")
        # words of one heading an em apart, and a small word in another size beside a large one
        page.insert_text(fitz.Point(40, 300), "Los seres", fontsize=20, fontname="hebo")
        page.insert_text(fitz.Point(40 + fitz.get_text_length("Los seres", fontname="hebo", fontsize=20) + 16, 300),
                         "vivos", fontsize=20, fontname="hebo")
        page.insert_text(fitz.Point(40, 400), "Title", fontsize=20, fontname="hebo")
        page.insert_text(fitz.Point(40 + fitz.get_text_length("Title", fontname="hebo", fontsize=20) + 8, 400),
                         "note", fontsize=8, fontname="helv")
        plain = sorted(l.plain for l in page_lines(doc))
        self.assertIn("5", plain)
        self.assertIn("0", plain)
        self.assertTrue(any(p.replace(" ", "") == "1000" for p in plain), plain)
        self.assertFalse(any(p.startswith("1 ") for p in plain), plain)
        self.assertTrue(any(p.startswith("Los seres") and p.endswith("vivos") for p in plain), plain)
        self.assertIn("Title", plain)
        self.assertIn("note", plain)


def lab(text, x0, base, size=7.0, family="Helvetica", rotate=0.0):
    w = len(text) * size * 0.18
    return {"text": text, "plain": text, "x0": x0, "x1": x0 + w, "y0": base - size * 0.3, "y1": base + 0.5,
            "base": base, "size": size, "family": family, "weight": 400, "italic": False, "color": "#222222",
            "rotate": rotate}


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class MergeLabelLinesTest(unittest.TestCase):
    def test_numbers_and_letters_never_stack(self):
        groups = anc.merge_lines([lab("10", 30.0, 100.0), lab("0", 30.6, 102.4), lab("E", 50.0, 110.0),
                                  lab("Temperatura", 50.0, 112.4)])
        self.assertEqual(sorted(len(g) for g in groups), [1, 1, 1, 1])

    def test_a_name_on_two_lines_still_stacks(self):
        groups = anc.merge_lines([lab("Mar del", 30.0, 100.0), lab("Norte", 30.4, 102.4)])
        self.assertEqual([len(g) for g in groups], [2])

    def test_no_floor_on_the_centre(self):
        # short names whose centres differ by 0.9 mm (more than a fifth of their width) stay apart
        groups = anc.merge_lines([lab("Ab", 30.0, 100.0), lab("Cd", 31.5, 102.4)])
        self.assertEqual(sorted(len(g) for g in groups), [1, 1])


if __name__ == "__main__":
    unittest.main()
