"""Tests of the line art and picture cuts of `pdf_regions.py extract` (#1109)
on a page drawn in the test with PyMuPDF: art painted over a box's fill,
rules drawn as thin filled rectangles, a white stroke in a Lab colour and a
picture set in a rounded box.

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
    import pdf_regions as pr

MM = 72 / 25.4
TINT = (0.85, 0.93, 0.98)       # the box with art over its fill
GUIDE = (0.55, 0.7, 0.85)       # its guides, thin filled bars
ICON = (0.9, 0.3, 0.1)          # its icon
HIDDEN = (0.2, 0.6, 0.2)        # a shape the box's fill covers
RULE = (0.3, 0.3, 0.3)          # a loose rule drawn as a 0.4 mm bar
BAND = (0.1, 0.2, 0.45)         # a dark band with a white Lab stroke on it
FRAME = (0.3, 0.45, 0.7)        # the rounded box holding a photo


def near(value, rgb, tol: float = 0.02) -> bool:
    """Is a colour value ({hex}) the RGB colour drawn (to PyMuPDF's rounding)?"""
    if not isinstance(value, dict) or "hex" not in value:
        return False
    return all(abs(a - b) <= tol for a, b in zip(pr.td.hex_rgb(value["hex"]), rgb))


def R(x0, y0, x1, y1):
    return fitz.Rect(x0 * MM, y0 * MM, x1 * MM, y1 * MM)


def text(page, x, y, s, size=11, font="helv", color=(0.1, 0.1, 0.1)):
    page.insert_text((x * MM, y * MM), s, fontsize=size, fontname=font, color=color)


def photo(w: int, h: int) -> bytes:
    im = Image.new("RGB", (w, h))
    px = im.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = ((x * 3) % 200 + 40, (y * 2) % 180 + 50, 120)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def draw_page(doc) -> None:
    page = doc.new_page(width=210 * MM, height=297 * MM)
    text(page, 20, 20, "Practice the letters on the guides in the box below, then read on.")
    # a shape painted before the box's fill, hidden under it in the source
    page.draw_rect(R(160, 40, 170, 50), color=None, fill=HIDDEN)
    # the box: its fill, then words, an icon and three writing guides painted over the fill
    page.draw_rect(R(20, 30, 190, 90), color=None, fill=TINT, radius=0.05)
    text(page, 26, 40, "Copy each word on the lines below with care and a sharp pencil.")
    page.draw_polyline([fitz.Point(x * MM, y * MM) for x, y in ((176, 36), (182, 36), (179, 42), (176, 36))],
                       color=None, fill=ICON, closePath=True)
    for y in (55, 67, 79):
        page.draw_rect(R(26, y - 0.15, 184, y + 0.15), color=None, fill=GUIDE)
    # a loose rule drawn as a filled bar 0.4 mm thick
    page.draw_rect(R(20, 100, 190, 100.4), color=None, fill=RULE)
    # a dark band with a white stroke in a Lab colour (set below, in the content stream)
    page.draw_rect(R(0, 110, 210, 130), color=None, fill=BAND)
    text(page, 20, 118, "A band with a white rule under these words.", color=(1, 1, 1))
    # a rounded box holding a photo that runs into its corners
    page.draw_rect(R(20, 150, 120, 220), color=FRAME, fill=(1, 1, 1), width=2, radius=0.12)
    page.insert_image(R(20.5, 150.5, 119.5, 219.5), stream=photo(300, 210))
    text(page, 130, 160, "The photo on the left sits in a box with round corners.")
    text(page, 20, 285, "12", size=9)


def add_lab_white_stroke(doc, page) -> None:
    """A white stroke set in a Lab colour space: PyMuPDF converts it to a
    near white through the colour management."""
    lab = doc.get_new_xref()
    doc.update_object(lab, "[/Lab << /WhitePoint [0.9505 1 1.089] /Range [-100 100 -100 100] >>]")
    res = doc.xref_get_key(page.xref, "Resources")
    if res[0] == "xref":
        holder = int(res[1].split()[0])
        doc.xref_set_key(holder, "ColorSpace", f"<< /LabW {lab} 0 R >>")
    else:
        doc.xref_set_key(page.xref, "Resources/ColorSpace", f"<< /LabW {lab} 0 R >>")
    y = (297 - 125) * MM       # PDF space: from the foot
    stream = f"\nq /LabW CS 100 0 0 SCN 1 w {20 * MM:.2f} {y:.2f} m {190 * MM:.2f} {y:.2f} l S Q\n".encode()
    xref = page.get_contents()[-1]
    doc.update_stream(xref, doc.xref_stream(xref) + stream)


def run(pdf: Path, out: Path, *more: str) -> None:
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        pr.main(["extract", str(pdf), "--out", str(out), "--lang", "en", "--name-frames", "never", *more])


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class LineArtCutsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        doc = fitz.open()
        draw_page(doc)
        add_lab_white_stroke(doc, doc[0])
        cls.pdf = root / "cuts.pdf"
        doc.save(str(cls.pdf))
        cls.out = root / "out"
        run(cls.pdf, cls.out)
        cls.lib = json.loads((cls.out / "library.json").read_text(encoding="utf-8"))
        cls.res = json.loads((cls.out / "resources.json").read_text(encoding="utf-8"))
        cls.regions = json.loads((cls.out / "regions.json").read_text(encoding="utf-8"))
        cls.els = cls.lib["pageTemplates"][0]["decoration"]["elements"]

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def box_frame(self, x0: float) -> dict:
        return next(f for f in self.regions[0]["frames"] if f["kind"] == "box" and abs(f["box"][0] - x0) < 1)

    def test_the_fill_of_a_box_with_art_over_it_is_decoration(self):
        box = self.box_frame(20)
        fill = next(e for e in self.els if e["id"] == f"{box['name']}-fill")
        self.assertTrue(near(fill["style"]["backgroundColor"], TINT))
        self.assertIn("borderRadius", fill["style"])
        to = f"#{box['name']}"
        self.assertEqual(fill["placement"]["anchor"], {"to": to, "edge": "top-left"})
        self.assertEqual(fill["placement"]["size"], {"width": {"to": to, "edge": "right"},
                                                     "height": {"to": to, "edge": "bottom"}})
        tpl = self.lib["pageTemplates"][0]
        st_id = next(f["style"] for f in tpl["frames"] if f["name"] == box["name"])
        st = next(s for s in self.lib["calloutStyles"] if s["id"] == st_id)
        self.assertFalse(st["backgroundEnabled"])
        self.assertNotIn("background", st)

    def test_the_art_over_the_fill_is_drawn_after_it(self):
        ids = [e["id"] for e in self.els]
        box = self.box_frame(20)
        at = ids.index(f"{box['name']}-fill")
        icon = [i for i, e in enumerate(self.els) if e["kind"] == "path" and near(e.get("fill"), ICON)]
        self.assertEqual(len(icon), 1)
        self.assertGreater(icon[0], at)
        guides = [e for e in self.els if e["kind"] == "path" and near(e.get("stroke"), GUIDE)]
        self.assertEqual(len(guides), 1)                 # one path, one look
        self.assertEqual(guides[0]["d"].count("M"), 3)
        self.assertGreater(ids.index(guides[0]["id"]), at)
        self.assertAlmostEqual(guides[0]["width"]["value"], 0.3 * MM, delta=0.05)

    def test_what_the_fill_covered_stays_hidden(self):
        hidden = [e for e in self.els if near(e.get("fill"), HIDDEN)]
        self.assertEqual(hidden, [])

    def test_a_filled_bar_under_1_mm_is_a_line(self):
        rule = [e for e in self.els if e["kind"] == "path" and near(e.get("stroke"), RULE)]
        self.assertEqual(len(rule), 1, [e["id"] for e in self.els])
        self.assertTrue(rule[0]["id"].startswith("lines-"))
        self.assertAlmostEqual(rule[0]["width"]["value"], 0.4 * MM, delta=0.05)
        self.assertNotIn("fill", rule[0])

    def test_a_white_stroke_in_lab_stays_white(self):
        white = [e for e in self.els if e["kind"] == "path" and e.get("stroke", {}).get("hex", "").startswith("#f")]
        self.assertEqual([e["stroke"]["hex"] for e in white], ["#ffffff"])

    def test_a_picture_in_a_rounded_box_is_clipped_to_its_corners(self):
        pics = [f for f in self.regions[0]["frames"] if f["kind"] in ("picture", "figure")]
        self.assertEqual(len(pics), 1, self.regions[0]["frames"])
        rid = next(r for r in self.res if r["typeId"] == "picture")
        self.assertTrue(rid["file"].endswith(".png"), rid)
        with Image.open(self.out / rid["file"]) as im:
            self.assertEqual(im.mode, "RGBA")
            w, h = im.size
            a = im.getchannel("A")
            self.assertEqual(a.getpixel((1, 1)), 0)              # past the curve
            self.assertEqual(a.getpixel((w - 2, h - 2)), 0)
            self.assertEqual(a.getpixel((w // 2, h // 2)), 255)  # the photo
            self.assertEqual(a.getpixel((w // 2, 2)), 255)       # along the straight top edge


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class HelpersTest(unittest.TestCase):
    def test_hexc_converts_through_mupdf_and_keeps_white(self):
        self.assertEqual(pr.hexc((0, 0, 0, 0)), "#ffffff")
        self.assertEqual(pr.hexc((0.9947, 0.9986, 0.9964)), "#ffffff")
        self.assertEqual(pr.hexc((0.5,)), "#808080")
        self.assertEqual(pr.hexc(0x123456), "#123456")
        self.assertEqual(pr.hexc((0.97, 0.97, 0.97)), "#f7f7f7")   # a pale grey stays grey
        self.assertIsNone(pr.hexc((0.1, 0.2)))
        cyan = pr.td.hex_rgb(pr.hexc((1, 0, 0, 0)))
        self.assertLess(cyan[0], 0.2)
        self.assertGreater(cyan[2], 0.8)

    def test_fill_rule(self):
        origin = (0, 0, 210, 297)

        def shape(rect, fill=(0.2, 0.2, 0.2), color=None):
            d = {"rect": rect, "fill": fill, "color": color, "width": 1 if color else None,
                 "items": [("re", rect, 1)], "seqno": 7}
            return pr.Shape(d, origin)

        seg = pr.fill_rule(shape(R(10, 50, 100, 50.3)))
        self.assertEqual(seg.axis, "h")
        self.assertAlmostEqual(seg.c, 50.15, delta=0.01)
        self.assertAlmostEqual(seg.key[1], 0.3 * MM, delta=0.01)
        self.assertEqual(seg.ids, {7})
        self.assertEqual(pr.fill_rule(shape(R(10, 50, 10.5, 90))).axis, "v")
        self.assertIsNone(pr.fill_rule(shape(R(10, 50, 100, 52))))            # 2 mm: a band, not a rule
        self.assertIsNone(pr.fill_rule(shape(R(10, 50, 11, 50.5))))           # a speck
        self.assertIsNone(pr.fill_rule(shape(R(10, 50, 100, 50.3), color=(0, 0, 0))))


if __name__ == "__main__":
    unittest.main()
