"""Tests of map keys read as `kind: "legend"` labels and key tables by
`pdf_regions.py extract` (legends.py, #1144), on pages drawn in the test.

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
    HAVE_DEPS = hasattr(fitz.Page, "find_tables")
except Exception:  # pragma: no cover
    HAVE_DEPS = False

if HAVE_DEPS:
    import legends as lgd
    import pdf_regions as pr

MM = 72 / 25.4
TEXT = ("The map below shows the land of the valley and the weather over it on the first day of spring, "
        "with the rivers that run down from the hills.")
COLOURS = [("Forest", (0.13, 0.55, 0.13)), ("Desert", (0.93, 0.79, 0.45)), ("Water", (0.2, 0.45, 0.85))]


def colour_key_page(doc) -> None:
    """A paragraph, then a key standing alone: three coloured squares and their words."""
    page = doc.new_page(width=210 * MM, height=297 * MM)
    page.insert_textbox(fitz.Rect(20 * MM, 25 * MM, 190 * MM, 60 * MM), TEXT + " " + TEXT, fontsize=11, fontname="helv")
    for k, (word, col) in enumerate(COLOURS):
        y = 90 + k * 7
        page.draw_rect(fitz.Rect(30 * MM, (y - 3.2) * MM, 34 * MM, (y + 0.8) * MM), color=None, fill=col)
        page.insert_text((37 * MM, y * MM), word, fontsize=9, fontname="helv")
    page.insert_textbox(fitz.Rect(20 * MM, 130 * MM, 190 * MM, 170 * MM), TEXT, fontsize=11, fontname="helv")


def weather_map_page(doc, png: Path) -> None:
    """A map picture with a key on a white plate: an isobar (a line), a cold front
    (a triangle) and a warm front (a semicircle)."""
    page = doc.new_page(width=210 * MM, height=297 * MM)
    page.insert_textbox(fitz.Rect(20 * MM, 20 * MM, 190 * MM, 45 * MM), TEXT, fontsize=11, fontname="helv")
    page.insert_image(fitz.Rect(20 * MM, 55 * MM, 190 * MM, 175 * MM), filename=str(png))
    page.draw_rect(fitz.Rect(130 * MM, 140 * MM, 185 * MM, 170 * MM), color=(0.3, 0.3, 0.3), fill=(1, 1, 1), width=0.5)
    rows = ["Isobar", "Cold front", "Warm front"]
    for k, word in enumerate(rows):
        y = 147 + k * 8
        x0, x1 = 134 * MM, 142 * MM
        if k == 0:
            page.draw_line(fitz.Point(x0, (y - 1.2) * MM), fitz.Point(x1, (y - 1.2) * MM), color=(0.1, 0.1, 0.1), width=0.8)
        elif k == 1:
            s = page.new_shape()
            s.draw_polyline([fitz.Point(x0, (y + 0.5) * MM), fitz.Point((x0 + x1) / 2, (y - 3.5) * MM), fitz.Point(x1, (y + 0.5) * MM)])
            s.finish(color=None, fill=(0.1, 0.3, 0.9), closePath=True)
            s.commit()
        else:
            s = page.new_shape()
            c = fitz.Point((x0 + x1) / 2, (y + 0.5) * MM)
            s.draw_sector(c, fitz.Point(x1, (y + 0.5) * MM), 180, fullSector=True)
            s.finish(color=None, fill=(0.85, 0.1, 0.1), closePath=True)
            s.commit()
        page.insert_text((145 * MM, y * MM), word, fontsize=9, fontname="helv")


def list_page(doc) -> None:
    """A list with drawn bullets, all alike: no key."""
    page = doc.new_page(width=210 * MM, height=297 * MM)
    page.insert_textbox(fitz.Rect(20 * MM, 25 * MM, 190 * MM, 60 * MM), TEXT + " " + TEXT, fontsize=11, fontname="helv")
    for k, word in enumerate(["Apples", "Pears", "Plums"]):
        y = 80 + k * 7
        page.draw_circle(fitz.Point(31 * MM, (y - 1.2) * MM), 0.8 * MM, color=None, fill=(0, 0, 0))
        page.insert_text((35 * MM, y * MM), word, fontsize=11, fontname="helv")


def extract(pdf: Path, out: Path) -> dict:
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        pr.main(["extract", str(pdf), "--out", str(out), "--lang", "en", "--name-frames", "never"])
    return {"lib": json.loads((out / "library.json").read_text(encoding="utf-8")),
            "res": json.loads((out / "resources.json").read_text(encoding="utf-8")),
            "md": (out / "chapters" / "en" / "01-pages.md").read_text(encoding="utf-8")}


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF with find_tables, numpy and Pillow")
class LegendTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        png = root / "map.png"
        im = Image.new("RGB", (850, 600), (206, 228, 196))
        for x in range(0, 850, 4):
            for y in range(0, 600, 50):
                im.putpixel((x, (y + x // 9) % 600), (120, 150, 110))
        im.save(png)
        cls.out = {}
        for name, draw in (("colours", colour_key_page), ("weather", lambda d: weather_map_page(d, png)), ("list", list_page)):
            doc = fitz.open()
            draw(doc)
            pdf = root / f"{name}.pdf"
            doc.save(str(pdf))
            cls.out[name] = extract(pdf, root / name)
            cls.out[name]["dir"] = root / name

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_a_colour_key_alone_is_a_table_of_symbols_and_words(self):
        o = self.out["colours"]
        tables = [r for r in o["res"] if r.get("kind") == "table"]
        self.assertEqual(len(tables), 1)
        rows = tables[0]["table"]["model"]["rows"]
        self.assertEqual([r[1]["content"] for r in rows], ["Forest", "Desert", "Water"])
        self.assertTrue(rows[0][0]["content"].startswith(':icon[Forest]{glyph="■" color="#'))
        colours = {r[0]["content"].split('color="')[1][:7] for r in rows}
        self.assertEqual(len(colours), 3)
        style = next(s for s in o["lib"]["tableStyles"] if s["id"] == tables[0]["table"]["styleId"])
        self.assertFalse(style["borders"])
        # the words are the table's, not paragraphs of the page
        body = o["md"].replace(f'::resource{{id="{tables[0]["id"]}"', "")
        self.assertNotIn("Forest", body)

    def test_a_weather_key_on_a_map_is_a_legend_label_with_line_and_svg_icons(self):
        o = self.out["weather"]
        md = o["md"]
        self.assertIn(":::figure{resource=", md)
        block = md[md.index(":::label{"):]
        self.assertTrue(block.startswith(':::label{at="legend" style="legend-'))
        rows = block.split("\n")[1:4]
        self.assertTrue(rows[0].startswith(':icon[Isobar]{line="solid" color="#'), rows[0])
        self.assertTrue(rows[1].startswith(":icon[Cold front]{resource=\"icon-"), rows[1])
        self.assertTrue(rows[2].startswith(":icon[Warm front]{resource=\"icon-"), rows[2])
        self.assertTrue(rows[0].endswith(" Isobar") and rows[2].endswith(" Warm front"))
        self.assertEqual(block.split("\n")[4], ":::")
        # the label style is a legend with the key's plate
        st = next(s for s in o["lib"]["labelStyles"] if s.get("kind") == "legend")
        self.assertEqual(st["background"]["hex"], "#ffffff")
        self.assertIn("border", st)
        # the icons are SVG resources, written once each
        icons = [r for r in o["res"] if r["id"].startswith("icon-")]
        self.assertEqual(len(icons), 2)
        for r in icons:
            svg = (o["dir"] / r["file"]).read_text(encoding="utf-8")
            self.assertIn("<path", svg)
        self.assertIn(" C", svg.replace("C", " C"))     # the semicircle keeps its curve
        # the picture carries the key's anchor
        pic = next(r for r in o["res"] if r.get("kind") == "bitmap" and r["id"].endswith("picture-1"))
        a = next(a for a in pic["anchors"] if a["id"] == "legend")
        self.assertEqual((a["align"], a["verticalAlign"]), ("start", "top"))
        self.assertTrue(0.6 < a["x"] < 0.7 and 0.7 < a["y"] < 0.8, a)

    def test_a_list_with_alike_bullets_is_no_key(self):
        o = self.out["list"]
        self.assertNotIn(":icon[", o["md"])
        self.assertFalse([r for r in o["res"] if r.get("kind") == "table"])


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF")
class DuplicateLineTest(unittest.TestCase):
    def lines_of(self, offset_mm: float) -> list:
        doc = fitz.open()
        page = doc.new_page(width=210 * MM, height=297 * MM)
        for dx in (0.0, offset_mm):
            page.insert_text(((30 + dx) * MM, 40 * MM), "Weather on the plain", fontsize=12, fontname="helv")
        page.insert_text((30 * MM, 60 * MM), "Weather on the plain", fontsize=12, fontname="helv")
        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "dup.pdf"
            doc.save(str(pdf))
            d = pr.open_pdf(pdf)
            p = d[0]
            lines, _ = pr.read_lines(pdf, p, pr.Fonts(None, None), pr.trim_origin(p))
        return lines

    def test_a_copy_at_the_same_spot_is_dropped(self):
        lines = self.lines_of(0.0)
        notes: list[str] = []
        kept = lgd.drop_duplicate_lines(lines, notes=notes)
        self.assertEqual(sum(1 for l in kept if l.plain == "Weather on the plain"), 2)   # the other line, 20 mm down, stays
        self.assertLessEqual(len(kept), len(lines))

    def test_an_offset_copy_is_a_fake_bold(self):
        lines = self.lines_of(0.15)
        notes: list[str] = []
        kept = lgd.drop_duplicate_lines(lines, notes=notes)
        top = [l for l in kept if l.plain == "Weather on the plain" and l.y0 < 45]
        self.assertEqual(len(top), 1)
        self.assertGreaterEqual(top[0].weight, 700)
        self.assertTrue(any("fake bold" in n for n in notes))


if __name__ == "__main__":
    unittest.main()
