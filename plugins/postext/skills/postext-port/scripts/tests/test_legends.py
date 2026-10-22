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



def political_map_page(doc, png: Path) -> None:
    """A political map with a key on a white plate whose symbols stand centred
    on one column at unequal gaps from their words: a sample name in small
    bold capitals, a capital's ring and dot, a border line. Under it a scale
    bar on its own plate, on the map too."""
    page = doc.new_page(width=210 * MM, height=297 * MM)
    page.insert_textbox(fitz.Rect(20 * MM, 20 * MM, 190 * MM, 45 * MM), TEXT, fontsize=11, fontname="helv")
    page.insert_image(fitz.Rect(20 * MM, 55 * MM, 190 * MM, 175 * MM), filename=str(png))
    grey = (0.39, 0.39, 0.4)
    page.draw_rect(fitz.Rect(140 * MM, 60 * MM, 185 * MM, 78 * MM), color=(0.14, 0.12, 0.13), fill=(1, 1, 1), width=0.4)
    col = 150 * MM          # the symbols' column centre
    # a sample of the map's lettering
    w = fitz.get_text_length("SPAIN", fontname="hebo", fontsize=5)
    page.insert_text((col - w / 2, 66 * MM), "SPAIN", fontsize=5, fontname="hebo")
    page.insert_text((155 * MM, 66 * MM), "Country", fontsize=8, fontname="helv")
    # a capital: a white ring with a grey outline and a grey dot
    page.draw_circle(fitz.Point(col, 69.6 * MM), 0.65 * MM, color=grey, fill=(1, 1, 1), width=0.15)
    page.draw_circle(fitz.Point(col, 69.6 * MM), 0.3 * MM, color=grey, fill=grey, width=0.15)
    page.insert_text((155 * MM, 71 * MM), "Capital", fontsize=8, fontname="helv")
    # a border line, wider than the ring
    page.draw_line(fitz.Point(col - 2.3 * MM, 74.6 * MM), fitz.Point(col + 2.3 * MM, 74.6 * MM), color=(0.58, 0.59, 0.6), width=0.5)
    page.insert_text((155 * MM, 76 * MM), "Border", fontsize=8, fontname="helv")
    scale_bar(page, 30 * MM, 150 * MM)


def scale_bar(page, x: float, y: float) -> None:
    """A scale bar on a white plate at (x, y) points: the ratio over a bar
    with three ticks and its numbers under them."""
    page.draw_rect(fitz.Rect(x, y, x + 26 * MM, y + 9 * MM), color=(0.1, 0.1, 0.1), fill=(1, 1, 1), width=0.25)
    page.insert_text((x + 1.5 * MM, y + 2.8 * MM), "Scale 1:48 000 000", fontsize=5, fontname="helv")
    bx0, bx1, by = x + 2 * MM, x + 18.5 * MM, y + 4.6 * MM
    s = page.new_shape()
    s.draw_polyline([fitz.Point(bx0, by - 0.8 * MM), fitz.Point(bx0, by), fitz.Point(bx1, by), fitz.Point(bx1, by - 0.8 * MM)])
    s.draw_line(fitz.Point((bx0 + bx1) / 2, by - 0.8 * MM), fitz.Point((bx0 + bx1) / 2, by))
    s.finish(color=(0, 0, 0), width=0.43, closePath=False)
    s.commit()
    for word, at in (("0", bx0), ("400", (bx0 + bx1) / 2), ("800 km", bx1)):
        w = fitz.get_text_length(word.split()[0], fontname="helv", fontsize=5)
        page.insert_text((at - w / 2, by + 2.6 * MM), word, fontsize=5, fontname="helv")


def lone_scale_page(doc) -> None:
    """A paragraph and a scale bar standing alone on the page."""
    page = doc.new_page(width=210 * MM, height=297 * MM)
    page.insert_textbox(fitz.Rect(20 * MM, 20 * MM, 190 * MM, 45 * MM), TEXT, fontsize=11, fontname="helv")
    scale_bar(page, 40 * MM, 70 * MM)


def halo_page(doc, png: Path) -> None:
    """A picture whose two names are printed in dark red over a white twin of
    their letters drawn as paths (the outline round a globe's degrees)."""
    page = doc.new_page(width=210 * MM, height=297 * MM)
    page.insert_textbox(fitz.Rect(20 * MM, 20 * MM, 190 * MM, 45 * MM), TEXT, fontsize=11, fontname="helv")
    page.insert_image(fitz.Rect(20 * MM, 55 * MM, 190 * MM, 175 * MM), filename=str(png))
    red = (0.59, 0.18, 0.2)
    for word, (x, y) in (("North Pole", (60 * MM, 100 * MM)), ("Equator", (110 * MM, 140 * MM))):
        dx = x
        for ch in word:
            cw = fitz.get_text_length(ch, fontname="hebo", fontsize=7)
            if ch.strip():
                # an octagon over the letter: its twin, in white
                cx, cy, r = dx + cw / 2, y - 2.6, min(2.2, cw / 2 + 0.6)
                pts = [fitz.Point(cx + r * c, cy + r * s) for c, s in
                       ((1, 0.4), (0.4, 1), (-0.4, 1), (-1, 0.4), (-1, -0.4), (-0.4, -1), (0.4, -1), (1, -0.4))]
                sh = page.new_shape()
                sh.draw_polyline(pts + [pts[0]])
                sh.finish(color=(1, 1, 1), fill=(1, 1, 1), width=0.4, closePath=True)
                sh.commit()
            dx += cw
        page.insert_text((x, y), word, fontsize=7, fontname="hebo", color=red)


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF with find_tables, numpy and Pillow")
class MapKeyAndScaleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        png = root / "map.png"
        im = Image.new("RGB", (850, 600), (238, 222, 92))
        for x in range(0, 850, 4):
            for y in range(0, 600, 50):
                im.putpixel((x, (y + x // 9) % 600), (120, 150, 110))
        im.save(png)
        cls.out = {}
        for name, draw in (("political", lambda d: political_map_page(d, png)), ("scale", lone_scale_page),
                           ("halo", lambda d: halo_page(d, png))):
            doc = fitz.open()
            draw(doc)
            pdf = root / f"{name}.pdf"
            doc.save(str(pdf))
            cls.out[name] = extract(pdf, root / name)
            cls.out[name]["dir"] = root / name
            cls.out[name]["report"] = json.loads((root / name / "report.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_a_key_of_a_sample_name_a_ring_and_a_line_centred_on_one_column(self):
        md = self.out["political"]["md"]
        self.assertIn(':::label{at="legend" style="legend-', md)
        block = md[md.index(':::label{at="legend"'):]
        rows = block.split("\n")[1:4]
        self.assertTrue(rows[0].startswith(':icon[SPAIN]{glyph="SPAIN"'), rows[0])
        self.assertIn('size="0.45"', rows[0])           # 5 pt capitals in an 8 pt row
        self.assertTrue(rows[0].endswith(" Country"), rows[0])
        self.assertTrue(rows[1].startswith(':icon[Capital]{resource="icon-'), rows[1])
        self.assertTrue(rows[2].startswith(':icon[Border]{line="solid" color="#'), rows[2])
        self.assertEqual(block.split("\n")[4], ":::")
        # the key's words are no box text of the page
        self.assertNotIn("SPAIN\n", md)
        self.assertNotIn("Country Capital", md)
        pic = next(r for r in self.out["political"]["res"] if r.get("anchors") and any(a["id"] == "legend" for a in r["anchors"]))
        self.assertTrue(pic["id"].endswith("-1"))

    def test_a_scale_bar_on_the_map_is_its_art_with_its_numbers_as_labels(self):
        o = self.out["political"]
        md = o["md"]
        for word in ("0", "400", "800 km", "Scale 1:48 000 000"):
            self.assertIn(f"::label[{word}]", md)
        self.assertNotIn(":::frame", md[md.index(":::figure"):].split("\n::::")[0].replace(":::figure", ""))
        self.assertTrue(any("scale bar" in n and "art of the picture" in n for ns in o["report"]["notes"].values()
                            for n in ns))
        fig = next(r for r in o["res"] if any(a["id"] == "800-km" for a in r.get("anchors", [])))
        # the numbers stand along the bar, left to right
        xs = [next(a["x"] for a in fig["anchors"] if a["id"] == k) for k in ("0", "400", "800-km")]
        self.assertEqual(xs, sorted(xs))

    def test_a_scale_bar_alone_is_a_picture_of_its_own(self):
        o = self.out["scale"]
        md = o["md"]
        self.assertIn(":::figure{", md)
        for word in ("0", "400", "800 km", "Scale 1:48 000 000"):
            self.assertIn(f"::label[{word}]", md)
        self.assertNotIn("Scale 1:48 000 000 0", md)       # no run-on text in a box
        self.assertTrue(any("a picture of its own" in n for ns in o["report"]["notes"].values() for n in ns))

    def test_a_drawn_white_twin_is_the_labels_halo_not_its_colour(self):
        o = self.out["halo"]
        styles = o["lib"]["labelStyles"]
        st = next(s for s in styles if s["id"].startswith("label-") and s["color"]["hex"] != "#ffffff"
                  and "halo" in s)
        self.assertEqual(st["halo"]["color"]["hex"], "#ffffff")
        self.assertTrue(all(s["color"]["hex"] != "#ffffff" for s in styles))
        self.assertIn("::label[North Pole]", o["md"])
        self.assertIn("::label[Equator]", o["md"])
        # the twin leaves the picture's cut: no white where a letter stood
        pic = next(r for r in o["res"] if any(a["id"] == "equator" for a in r.get("anchors", [])))
        a = next(a for a in pic["anchors"] if a["id"] == "equator")
        im = Image.open(o["dir"] / pic["file"]).convert("RGB")
        w, h = im.size
        white = 0
        for dx in range(-12, 60, 3):
            px = im.getpixel((min(w - 1, max(0, int(a["x"] * w) + dx)), int(a["y"] * h)))
            white += min(px) > 240
        self.assertEqual(white, 0)


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF")
class TwoColourTwinTest(unittest.TestCase):
    def test_a_white_copy_under_a_coloured_one_is_its_halo(self):
        doc = fitz.open()
        page = doc.new_page(width=210 * MM, height=297 * MM)
        page.insert_text((30 * MM, 40 * MM), "Tropic of Cancer", fontsize=6, fontname="hebo", color=(1, 1, 1))
        page.insert_text((30 * MM, 40 * MM), "Tropic of Cancer", fontsize=6, fontname="hebo", color=(0.59, 0.18, 0.2))
        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "twin.pdf"
            doc.save(str(pdf))
            d = pr.open_pdf(pdf)
            p = d[0]
            lines, _ = pr.read_lines(pdf, p, pr.Fonts(None, None), pr.trim_origin(p))
        notes: list[str] = []
        kept = lgd.drop_duplicate_lines(lines, notes=notes)
        twin = [l for l in kept if l.plain == "Tropic of Cancer"]
        self.assertEqual(len(twin), 1)
        self.assertEqual(twin[0].color, "#962e33")
        self.assertEqual(twin[0].halo["color"], "#ffffff")
        self.assertEqual(twin[0].label_dict()["halo"]["color"], "#ffffff")
        self.assertTrue(any("halo" in n for n in notes))


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy")
class GlyphMaskTest(unittest.TestCase):
    def test_a_shading_under_small_letters_is_no_glyph(self):
        import numpy as np

        r = pr.Renders.__new__(pr.Renders)
        r.np = np
        # a blue-to-dark shading the text-only render keeps (grey 150 to 100), a letter's stroke at 60
        ink = np.tile(np.linspace(150, 100, 40).astype(int), (20, 1))
        ink[5:15, 18:20] = 60
        r.ink = ink
        mask = r.glyph_mask(0, 0, 40, 20)
        self.assertEqual(int(mask.sum()), 20)
        self.assertTrue(mask[5:15, 18:20].all())
        # on white paper it is the plain threshold
        ink = np.full((20, 40), 255)
        ink[5:15, 18:20] = 60
        r.ink = ink
        self.assertEqual(int(r.glyph_mask(0, 0, 40, 20).sum()), 20)


if __name__ == "__main__":
    unittest.main()
