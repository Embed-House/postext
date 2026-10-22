"""What a box of `pdf_regions.py extract` holds, on small PDFs drawn in the
test: pictures and nested boxes set in the box's own text (#1186), the ring
before a tab's words drawn by the tab (#1190), art cut whole past its box
(#1191), paragraph and list spacing measured per style (#1196, #1197)."""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from test_pdf_regions_text import HAVE_DEPS, MM, extract, put  # noqa: E402

if HAVE_DEPS:
    import fitz

    from test_pdf_regions_frames import map_png  # noqa: E402


BLUE = (0.03, 0.52, 0.75)
LINE = "Las ciudades crecen junto a los ríos porque el agua"
LINE2 = "les da comida, transporte y trabajo a quien vive allí."


def new_page(doc):
    return doc.new_page(width=210 * MM, height=297 * MM)


def ring(page, cx, cy, colour):
    """A ring ◉ drawn as two paths: a stroked circle and a filled dot."""
    page.draw_circle(fitz.Point(cx * MM, cy * MM), 1.565 * MM, color=colour, fill=None, width=0.65)
    page.draw_circle(fitz.Point(cx * MM, cy * MM), 1.185 * MM, color=None, fill=colour)


def tabbed_box(page, top, words="LOS RÍOS", ring_colour=(1, 1, 1)):
    """A white box with a blue rule and a blue tab on its top edge, a white ring before the tab's
    words. Returns the box's top (mm)."""
    page.draw_rect(fitz.Rect(20 * MM, top * MM, 60 * MM, (top + 8) * MM), color=None, fill=BLUE)
    if ring_colour is not None:
        ring(page, 24.0, top + 4.0, ring_colour)
    put(page, 27.5 * MM, (top + 5.6) * MM, words, size=11, font="hebo", color=(1, 1, 1))
    return top + 7.0


def resources(tmp) -> dict:
    return {r["id"]: r for r in json.loads((Path(tmp.name) / "out" / "resources.json").read_text(encoding="utf-8"))}


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class RingIcon(unittest.TestCase):
    """#1190: the ring before a tab's words is the tab's icon, one SVG per look, never pinned paths."""

    def test_a_tab_ring_is_the_label_icon_inside(self):
        doc = fitz.open()
        page = new_page(doc)
        y = tabbed_box(page, 40)
        page.draw_rect(fitz.Rect(20 * MM, y * MM, 190 * MM, (y + 30) * MM), color=BLUE, fill=(1, 1, 1), width=1)
        put(page, 24 * MM, (y + 8) * MM, LINE, size=11)
        put(page, 24 * MM, (y + 13) * MM, LINE2, size=11)
        y2 = tabbed_box(page, 120, "LOS MARES")
        page.draw_rect(fitz.Rect(20 * MM, y2 * MM, 190 * MM, (y2 + 30) * MM), color=BLUE, fill=(1, 1, 1), width=1)
        put(page, 24 * MM, (y2 + 8) * MM, LINE, size=11)
        tmp, md, lib, report = extract(doc)
        try:
            boxes = [s for s in lib["calloutStyles"] if s.get("label")]
            labelled = [f for f in lib["pageTemplates"][0]["frames"] if f.get("style") in {s["id"] for s in boxes}]
            self.assertEqual(len(labelled), 2)
            icons = {s["label"]["icon"]["resourceId"] for s in boxes}
            self.assertEqual(len(icons), 1)          # the same ring, one picture
            icon = boxes[0]["label"]["icon"]
            self.assertEqual(icon["placement"], "inside")
            self.assertAlmostEqual(icon["width"]["value"], 3.36, delta=0.3)
            self.assertAlmostEqual(icon["gap"]["value"], 1.66, delta=0.5)
            res = resources(tmp)
            rid = icons.pop()
            self.assertEqual(res[rid]["kind"], "svg")
            svg = (Path(tmp.name) / "out" / res[rid]["file"]).read_text(encoding="utf-8")
            self.assertEqual(svg.count("<path"), 2)
            self.assertIn('stroke="#ffffff"', svg)
            # nothing of the ring is left on the page, and the report no longer says it is not drawn
            for e in lib["pageTemplates"][0].get("decoration", {}).get("elements", []):
                if e.get("kind") == "path":
                    x = e["placement"]["offset"]["x"]["value"]
                    self.assertFalse(21 < x < 27, e["id"])
            self.assertFalse(any("icon" in n for ns in report["notes"].values() for n in ns))
        finally:
            tmp.cleanup()

    def test_a_tab_of_its_own_draws_its_ring_as_its_icon(self):
        doc = fitz.open()
        page = new_page(doc)
        put(page, 20 * MM, 30 * MM, LINE, size=11)
        page.draw_rect(fitz.Rect(20 * MM, 60 * MM, 75 * MM, 68 * MM), color=None, fill=(1, 1, 1))
        page.draw_rect(fitz.Rect(20 * MM, 60 * MM, 75 * MM, 68 * MM), color=BLUE, width=0.5)
        ring(page, 24.0, 64.0, BLUE)
        put(page, 27.5 * MM, 65.6 * MM, "FUENTES ORALES", size=11, font="hebo", color=BLUE)
        tmp, md, lib, _ = extract(doc)
        try:
            tab = next(s for s in lib["calloutStyles"] if s.get("icon"))
            self.assertEqual(tab["icon"]["kind"], "resource")
            self.assertEqual(tab["icon"]["align"], "center")
            self.assertAlmostEqual(tab["padding"]["left"]["value"], 4.0 - 1.68, delta=0.3)
            self.assertAlmostEqual(tab["titleStyle"]["gap"]["value"], 1.66, delta=0.5)
            self.assertIn("FUENTES ORALES", md)
            self.assertEqual(resources(tmp)[tab["icon"]["resourceId"]]["kind"], "svg")
        finally:
            tmp.cleanup()


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class Spacing(unittest.TestCase):
    """#1197, #1196: the room between paragraphs and round lists, measured per style."""

    @classmethod
    def setUpClass(cls):
        doc = fitz.open()
        page = new_page(doc)
        lead, gap = 14.0, 2.0 * MM          # 11 pt text on 14 pt, paragraphs and lists 2 mm apart
        # free text: two paragraphs 3 mm apart
        y = 25 * MM
        for k in range(2):
            put(page, 20 * MM, y, LINE, size=11)
            put(page, 20 * MM, y + lead, LINE2, size=11)
            y += 2 * lead + 3 * MM
        # a box: two paragraphs, then a list of three items, then a paragraph
        page.draw_rect(fitz.Rect(15 * MM, 70 * MM, 190 * MM, 170 * MM), color=BLUE, fill=(0.93, 0.96, 1), width=1)
        y = 80 * MM
        for k in range(2):
            put(page, 20 * MM, y, LINE, size=11)
            put(page, 20 * MM, y + lead, LINE2, size=11)
            y += 2 * lead + gap
        for item in ("• El Ebro, que nace en Cantabria.", "• El Tajo, el más largo.", "• El Guadalquivir."):
            put(page, 20 * MM, y, item, size=11)
            y += lead + 1.0 * MM
        y += gap - 1.0 * MM
        put(page, 20 * MM, y, LINE, size=11)
        put(page, 20 * MM, y + lead, LINE2, size=11)
        # a key: names set line under line, one look
        page.draw_rect(fitz.Rect(15 * MM, 190 * MM, 80 * MM, 215 * MM), color=BLUE, fill=(1, 1, 1), width=0.5)
        for k, s in enumerate(("Capital", "Ciudad", "Frontera")):
            put(page, 20 * MM, 197 * MM + k * 10, s, size=9)
        cls.tmp, cls.md, cls.lib, _ = extract(doc)
        cls.styles = {s["id"]: s for s in cls.lib["calloutStyles"]}
        cls.frames = {f["name"]: f for f in cls.lib["pageTemplates"][0]["frames"]}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def style_of(self, word):
        name = next(n for n, f in self.frames.items() if f.get("style") and n.startswith("box")
                    and word in self.md.split(f'slot="{n}"', 1)[1].split(":::\n", 1)[0])
        return self.styles[self.frames[name]["style"]]

    def test_a_box_measures_its_own_paragraph_gap(self):
        st = self.style_of("Guadalquivir")
        self.assertAlmostEqual(st["body"]["paragraphSpacing"]["value"], 2.0, delta=0.15)

    def test_a_box_set_line_under_line_has_no_paragraph_gap(self):
        st = self.style_of("Frontera")
        self.assertEqual(st["body"]["paragraphSpacing"]["value"], 0.0)

    def test_list_margins_and_item_spacing_are_measured(self):
        lists = self.style_of("Guadalquivir")["lists"]
        self.assertAlmostEqual(lists["marginTop"]["value"], 2.0, delta=0.15)
        self.assertAlmostEqual(lists["marginBottom"]["value"], 2.0, delta=0.15)
        self.assertAlmostEqual(lists["itemSpacing"]["value"], 1.0, delta=0.15)
        ul = self.lib["suggested"]["unorderedLists"]
        self.assertAlmostEqual(ul["marginTop"]["value"], 2.0, delta=0.15)
        self.assertAlmostEqual(ul["marginBottom"]["value"], 2.0, delta=0.15)

    def test_the_text_gap_is_the_suggested_body_spacing(self):
        self.assertAlmostEqual(self.lib["suggested"]["bodyText"]["paragraphSpacing"]["value"], 3.0, delta=0.15)


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class BoxContent(unittest.TestCase):
    """#1186: a box lays out its own content, and no fence is left empty."""

    def test_boxes_nested_in_a_box_are_callouts_in_its_text(self):
        doc = fitz.open()
        page = new_page(doc)
        y = tabbed_box(page, 30, ring_colour=None)
        page.draw_rect(fitz.Rect(20 * MM, y * MM, 190 * MM, 130 * MM), color=BLUE, fill=(1, 1, 1), width=1)
        put(page, 24 * MM, (y + 8) * MM, LINE, size=11)
        top = y + 14
        for k in range(2):
            page.draw_rect(fitz.Rect(23 * MM, top * MM, 187 * MM, (top + 22) * MM), color=None, fill=(0.83, 0.91, 0.97))
            put(page, 26 * MM, (top + 7) * MM, LINE, size=11)
            put(page, 26 * MM, (top + 12) * MM, LINE2, size=11)
            top += 22 + 4
        tmp, md, lib, _ = extract(doc, "--name-frames", "never")
        try:
            frames = lib["pageTemplates"][0]["frames"]
            self.assertEqual([f["name"] for f in frames if f["name"].startswith("box")], ["box-1"])
            fence = md.split('slot="box-1"', 1)[1]
            calls = [l for l in fence.split("\n") if l.startswith(":::callout")]
            self.assertEqual(len(calls), 2)
            st = {s["id"]: s for s in lib["calloutStyles"]}
            inner = st[calls[1].split('type="', 1)[1].split('"', 1)[0]]
            self.assertAlmostEqual(inner["marginTop"]["value"], 4.0, delta=0.6)    # the room above it
            self.assertEqual(inner["marginBottom"]["value"], 0.0)
            self.assertNotIn("growWith", frames[0])
        finally:
            tmp.cleanup()

    def test_rows_equal_columns_can_set(self):
        import types

        import pdf_regions as pr

        def item(kind, x0, x1):
            return types.SimpleNamespace(kind=kind, box=(x0, 0.0, x1, 30.0))

        # photos of other widths, their middles evenly spaced: columns set them
        self.assertTrue(pr.row_regular([item("picture", 0, 40), item("picture", 60, 120), item("picture", 140, 160)]))
        # a text panel beside a photo, as wide apart: its words would wrap to another width
        self.assertFalse(pr.row_regular([item("box", 0, 76), item("picture", 77, 137), item("box", 138, 186)]))
        self.assertFalse(pr.row_regular([item("picture", 0, 60), item("picture", 20, 80)]))     # one over the other

    def test_a_box_with_a_tab_and_a_picture_holds_the_picture(self):
        doc = fitz.open()
        page = new_page(doc)
        put(page, 20 * MM, 25 * MM, LINE, size=11)
        y = tabbed_box(page, 40, ring_colour=None)
        page.draw_rect(fitz.Rect(20 * MM, y * MM, 190 * MM, (y + 60) * MM), color=BLUE, fill=(1, 1, 1), width=1)
        page.insert_image(fitz.Rect(30 * MM, (y + 5) * MM, 180 * MM, (y + 55) * MM), stream=map_png())
        tmp, md, lib, _ = extract(doc, "--name-frames", "never")
        try:
            self.assertRegex(md, r':::frame\{slot="box-1" label="LOS RÍOS"\}\n::resource\{id="p01-picture-1"\}\n:::')
            names = [f["name"] for f in lib["pageTemplates"][0]["frames"]]
            self.assertNotIn("picture-1", names)
            self.assertNotIn("tab-1", names)          # the tab is the box's label, not a frame of its own
        finally:
            tmp.cleanup()

    def test_a_box_whose_picture_cannot_flow_is_no_empty_fence(self):
        # its only picture lies over its edge: the words of the tab are a frame of their own and
        # the box a border round the picture, never an empty `:::frame`
        doc = fitz.open()
        page = new_page(doc)
        put(page, 20 * MM, 25 * MM, LINE, size=11)
        y = tabbed_box(page, 40, ring_colour=None)
        page.draw_rect(fitz.Rect(20 * MM, y * MM, 120 * MM, (y + 60) * MM), color=BLUE, fill=(1, 1, 1), width=1)
        page.insert_image(fitz.Rect(30 * MM, (y + 5) * MM, 135 * MM, (y + 55) * MM), stream=map_png())
        tmp, md, lib, _ = extract(doc, "--name-frames", "never")
        try:
            self.assertNotRegex(md, r':::frame\{[^}]*\}\n:::')
            self.assertIn("LOS RÍOS", md)
        finally:
            tmp.cleanup()


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class FootPadding(unittest.TestCase):
    """#1198: a box that grows with photos and captions keeps the room under them, not under its words."""

    @staticmethod
    def page(widths):
        doc = fitz.open()
        page = new_page(doc)
        put(page, 20 * MM, 25 * MM, LINE, size=11)
        page.draw_rect(fitz.Rect(20 * MM, 40 * MM, 190 * MM, 112 * MM), color=BLUE, fill=(1, 1, 1), width=1)
        put(page, 24 * MM, 48 * MM, LINE, size=11)
        put(page, 24 * MM, 53 * MM, LINE2, size=11)
        x = 30
        for w, words in zip(widths, ("El puente viejo.", "El molino del río.")):
            page.insert_image(fitz.Rect(x * MM, 62 * MM, (x + w) * MM, 98 * MM), stream=map_png())
            tw = fitz.get_text_length(words, fontname="hebo", fontsize=10) / MM
            put(page, (x + w / 2 - tw / 2) * MM, 104 * MM, words, size=10, font="hebo")
            put(page, (x + w / 2 - tw / 2) * MM, 108.2 * MM, words, size=10, font="hebo")
            x += w + 20
        return doc

    def bottom(self, widths):
        tmp, md, lib, _ = extract(self.page(widths), "--name-frames", "never")
        try:
            frames = {f["name"]: f for f in lib["pageTemplates"][0]["frames"]}
            st = next(s for s in lib["calloutStyles"] if s["id"] == frames["box-1"]["style"])
            return st["padding"]["bottom"]["value"], frames["box-1"], md
        finally:
            tmp.cleanup()

    def test_a_box_holding_its_rows_pads_under_its_captions(self):
        bottom, box, md = self.bottom((60, 60))
        self.assertIn(":::columns", md)
        self.assertLess(bottom, 4.0)          # 112 mm less the captions' foot, not 8 mm under the words
        self.assertGreater(box["minHeight"]["value"], 70)       # the source's height stays

    def test_a_box_growing_with_caption_frames_pads_under_them(self):
        bottom, box, md = self.bottom((30, 100))      # columns cannot set these: the captions stay frames
        self.assertEqual(box.get("growWith"), "children")
        self.assertLess(bottom, 4.0)


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class WholeCut(unittest.TestCase):
    """#1191: art whose ink runs on past its box and card is cut whole, transparent, over them."""

    def test_a_picture_past_its_box_and_card_is_cut_whole(self):
        doc = fitz.open()
        page = new_page(doc)
        page.draw_rect(page.rect, color=None, fill=(0.0, 0.68, 0.55))                  # the page's colour
        page.draw_rect(fitz.Rect(10 * MM, 10 * MM, 200 * MM, 287 * MM), color=None, fill=(1, 1, 1))   # the card
        put(page, 20 * MM, 25 * MM, LINE, size=11)
        page.draw_rect(fitz.Rect(20 * MM, 40 * MM, 190 * MM, 150 * MM), color=BLUE, fill=(1, 1, 1), width=1)
        put(page, 24 * MM, 50 * MM, LINE, size=11)
        put(page, 24 * MM, 55 * MM, LINE2, size=11)
        # a striped strip of art from inside the box to past the card's edge
        page.insert_image(fitz.Rect(100 * MM, 80 * MM, 207 * MM, 120 * MM), stream=map_png())
        tmp, md, lib, _ = extract(doc, "--name-frames", "never")
        try:
            frames = {f["name"]: f for f in lib["pageTemplates"][0]["frames"]}
            pic = frames["picture-1"]
            self.assertEqual(pic.get("overlap"), "allow")
            self.assertAlmostEqual(pic["width"]["value"], 107, delta=1.5)     # not cut at 190 nor at 200
            from PIL import Image

            res = resources(tmp)["p01-picture-1"]
            with Image.open(Path(tmp.name) / "out" / res["file"]) as im:
                self.assertEqual(im.mode, "RGBA")
        finally:
            tmp.cleanup()


if __name__ == "__main__":
    unittest.main()
