"""Frames and paragraphs of `pdf_regions.py` on small PDFs drawn in the
test: whole-bold paragraphs, furniture, masks and highlights that must not
split a paragraph, captions of a single picture in a box."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from test_pdf_regions_text import HAVE_DEPS, MM, extract, put  # noqa: E402

if HAVE_DEPS:
    import fitz


BODY = "Texto corrido de la página para medir el cuerpo del texto."


def map_png() -> bytes:
    """A small striped picture standing for a map."""
    import io

    from PIL import Image

    im = Image.new("RGB", (120, 40), (190, 205, 190))
    px = im.load()
    for yy in range(40):
        for xx in range(120):
            if (xx + yy) % 9 < 3:
                px[xx, yy] = (120, 150, 200)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def new_page(doc):
    return doc.new_page(width=210 * MM, height=297 * MM)


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class WholeBoldParagraph(unittest.TestCase):
    def test_bold_paragraph_in_a_regular_box(self):
        doc = fitz.open()
        page = new_page(doc)
        x, y = 25 * MM, 40 * MM
        page.draw_rect(fitz.Rect(x - 10, y - 20, 160 * MM, y + 80), color=(0.2, 0.4, 0.7), fill=(0.9, 0.95, 1), width=1)
        put(page, x, y, "Las plantas fabrican su alimento con la luz del sol.", size=11)
        put(page, x, y + 14, "Lo hacen en las hojas, donde está la clorofila.", size=11)
        put(page, x, y + 40, "Recuerda: sin luz no hay alimento.", size=11, font="hebo")
        put(page, x, y + 60, "Una frase con una palabra en", size=11)
        put(page, x + fitz.get_text_length("Una frase con una palabra en ", fontname="helv", fontsize=11), y + 60,
            "negrita.", size=11, font="hebo")
        tmp, md, lib, _ = extract(doc)
        try:
            self.assertIn("**Recuerda: sin luz no hay alimento.**", md)
            self.assertIn("palabra en **negrita.**", md)
            box = next(s for s in lib["calloutStyles"] if s["id"].startswith("box"))
            self.assertEqual(box["body"]["fontWeight"], 400)
        finally:
            tmp.cleanup()

    def test_a_bold_frame_marks_nothing(self):
        doc = fitz.open()
        page = new_page(doc)
        x, y = 25 * MM, 40 * MM
        page.draw_rect(fitz.Rect(x - 10, y - 20, 160 * MM, y + 40), color=(0.2, 0.4, 0.7), fill=(0.9, 0.95, 1), width=1)
        put(page, x, y, "Todo el recuadro va en negrita.", size=11, font="hebo")
        put(page, x, y + 26, "También este párrafo.", size=11, font="hebo")
        tmp, md, lib, _ = extract(doc)
        try:
            self.assertIn("Todo el recuadro va en negrita.", md)
            self.assertNotIn("**", md)
        finally:
            tmp.cleanup()


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class LeadTitle(unittest.TestCase):
    def test_bold_first_paragraph_of_a_box_and_coloured_one_of_a_text_frame(self):
        doc = fitz.open()
        page = new_page(doc)
        x, y = 25 * MM, 40 * MM
        page.draw_rect(fitz.Rect(x - 10, y - 20, 175 * MM, y + 50), color=(0.2, 0.4, 0.7), fill=(0.93, 0.96, 1),
                       width=1)
        put(page, x, y, "Las raíces", size=11, font="hebo")
        put(page, x, y + 16, PARA[0], size=11)
        put(page, x, y + 30, PARA[1], size=11)
        y2 = 150 * MM
        put(page, x, y2, "El tallo", size=11, color=(0.8, 0.3, 0.1))
        for k in range(4):
            put(page, x, y2 + 16 + k * 14, BODY, size=11)
        tmp, md, _, _ = extract(doc)
        try:
            self.assertRegex(md, r':::frame\{slot="box[^"]*"\}\n## Las raíces\n\nLos ríos nacen')
            self.assertIn("## El tallo\n\nTexto corrido", md)
            self.assertNotIn("**Las raíces**", md)
        finally:
            tmp.cleanup()

    def test_a_single_bold_letter_is_no_title(self):
        doc = fitz.open()
        page = new_page(doc)
        x, y = 25 * MM, 40 * MM
        page.draw_rect(fitz.Rect(x - 10, y - 20, 175 * MM, y + 50), color=(0.2, 0.4, 0.7), fill=(0.93, 0.96, 1),
                       width=1)
        put(page, x, y, "V", size=11, font="hebo")
        put(page, x, y + 16, PARA[0], size=11)
        put(page, x, y + 30, PARA[1], size=11)
        tmp, md, _, _ = extract(doc)
        try:
            self.assertNotIn("## V", md)
            self.assertIn("**V**", md)
        finally:
            tmp.cleanup()

    def test_a_bold_sentence_is_no_title(self):
        doc = fitz.open()
        page = new_page(doc)
        x, y = 25 * MM, 40 * MM
        page.draw_rect(fitz.Rect(x - 10, y - 20, 175 * MM, y + 50), color=(0.2, 0.4, 0.7), fill=(0.93, 0.96, 1),
                       width=1)
        put(page, x, y, "Las raíces sujetan la planta al suelo y toman de él el agua y las sales", size=11,
            font="hebo")
        put(page, x, y + 14, "minerales que necesita para crecer sana y fuerte cada día del año.", size=11,
            font="hebo")
        put(page, x, y + 30, PARA[0], size=11)
        tmp, md, _, _ = extract(doc)
        try:
            self.assertNotIn("## Las raíces", md)
            self.assertIn("**Las raíces sujetan", md)
        finally:
            tmp.cleanup()


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class Furniture(unittest.TestCase):
    def test_a_heading_at_the_foot_stays_in_the_text(self):
        doc = fitz.open()
        page = new_page(doc)
        put(page, 150 * MM, 9 * MM, "CIENCIAS NATURALES", size=8)
        put(page, 190 * MM, 290 * MM, "12", size=8)
        for k in range(8):
            put(page, 25 * MM, 40 * MM + k * 14, BODY, size=11)
        # a section heading set in the bottom margin band
        put(page, 25 * MM, 284 * MM, "Las plantas", size=20, font="hebo")
        tmp, md, lib, report = extract(doc)
        try:
            self.assertIn("# Las plantas", md)
            self.assertIn('head="CIENCIAS NATURALES"', md)
            self.assertNotIn("Las plantas", " ".join(report.get("furniture", [])))
        finally:
            tmp.cleanup()

    def test_a_short_line_without_folio_or_repeat_is_text(self):
        doc = fitz.open()
        page = new_page(doc)
        for k in range(8):
            put(page, 25 * MM, 40 * MM + k * 14, BODY, size=11)
        put(page, 25 * MM, 287 * MM, "Fuente: elaboración propia", size=8)
        tmp, md, _, _ = extract(doc)
        try:
            self.assertNotIn("foot=", md)
            self.assertIn("Fuente: elaboración propia", md)
        finally:
            tmp.cleanup()

    def test_a_running_head_repeated_on_two_pages(self):
        doc = fitz.open()
        for _ in range(2):
            page = new_page(doc)
            put(page, 150 * MM, 9 * MM, "CIENCIAS NATURALES", size=8)
            for k in range(8):
                put(page, 25 * MM, 40 * MM + k * 14, BODY, size=11)
        tmp, md, _, _ = extract(doc)
        try:
            self.assertEqual(md.count('head="CIENCIAS NATURALES"'), 2)
        finally:
            tmp.cleanup()

    def test_a_large_running_head_repeated_on_two_pages(self):
        doc = fitz.open()
        for n in range(2):
            page = new_page(doc)
            put(page, 120 * MM, 12 * MM, "Unidad 3" if n else "Unidad 2", size=20, font="hebo")
            for k in range(8):
                put(page, 25 * MM, 40 * MM + k * 14, BODY, size=11)
        tmp, md, _, _ = extract(doc)
        try:
            self.assertIn('head="Unidad 2"', md)
            self.assertIn('head="Unidad 3"', md)
            self.assertNotIn("# Unidad", md)
        finally:
            tmp.cleanup()


PARA = ["Los ríos nacen en las montañas, donde la lluvia y la nieve",
        "se juntan en pequeños arroyos que bajan por las laderas",
        "hasta formar un cauce más ancho que llega al mar."]


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class OneParagraph(unittest.TestCase):
    def test_a_white_mask_under_the_last_line_of_a_box(self):
        doc = fitz.open()
        page = new_page(doc)
        x, y = 25 * MM, 50 * MM
        page.draw_rect(fitz.Rect(x - 10, y - 20, 175 * MM, y + 60), color=(0.2, 0.4, 0.7), fill=(1, 1, 1), width=1)
        # a grey map strip under the last line, and the white mask that blanks it out under the words
        page.insert_image(fitz.Rect(x - 5, y + 22, 170 * MM, y + 55), stream=map_png())
        page.draw_rect(fitz.Rect(x - 2, y + 19, x + 290, y + 33), color=None, fill=(1, 1, 1))
        for k, t in enumerate(PARA):
            put(page, x, y + k * 14, t, size=11)
        tmp, md, lib, _ = extract(doc)
        try:
            self.assertIn(" ".join(PARA), md)
            self.assertEqual(md.count(":::frame"), 1, md)
            self.assertFalse(any("white" in s["id"] for s in lib["calloutStyles"]))
        finally:
            tmp.cleanup()

    def test_a_highlight_ending_mid_paragraph(self):
        doc = fitz.open()
        page = new_page(doc)
        x, y = 25 * MM, 50 * MM
        head = "se juntan en "
        word = "pequeños arroyos"
        wx = x + fitz.get_text_length(head, fontname="helv", fontsize=11)
        ww = fitz.get_text_length(word, fontname="helv", fontsize=11)
        # a band with room round its words (it does not hug them), its words in another colour
        page.draw_rect(fitz.Rect(wx - 3 * MM, y + 14 - 10, wx + ww + 3 * MM, y + 14 + 4), color=None, fill=(1, 0.9, 0.3))
        put(page, x, y, PARA[0], size=11)
        put(page, x, y + 14, head, size=11)
        put(page, wx, y + 14, word, size=11, color=(0.7, 0.1, 0.1))
        put(page, wx + ww, y + 14, " que bajan por las laderas", size=11)
        put(page, x, y + 28, PARA[2], size=11)
        for k in range(4):
            put(page, x, y + 60 + k * 14, BODY, size=11)
        tmp, md, lib, _ = extract(doc)
        try:
            self.assertRegex(md, "donde la lluvia y la nieve se juntan en :mark\\[pequeños arroyos\\]\\{style=\"[^\"]+\"\\} "
                             "que bajan por las laderas hasta formar")
        finally:
            tmp.cleanup()


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class SingleCaption(unittest.TestCase):
    @staticmethod
    def box_page(caption, size, font, gap_mm, centred):
        """A box: two lines of text, a picture, one caption line under it."""
        doc = fitz.open()
        page = new_page(doc)
        x, y = 25 * MM, 40 * MM
        page.draw_rect(fitz.Rect(x - 10, y - 20, 175 * MM, 150 * MM), color=(0.2, 0.4, 0.7), fill=(0.93, 0.96, 1),
                       width=1)
        put(page, x, y, PARA[0], size=11)
        put(page, x, y + 14, PARA[1], size=11)
        pic = fitz.Rect(x, y + 30, x + 75 * MM, y + 30 + 25 * MM)    # the picture's own 3:1 shape
        page.insert_image(pic, stream=map_png())
        w = fitz.get_text_length(caption, fontname=font, fontsize=size)
        cx = (pic.x0 + pic.x1) / 2 - w / 2 if centred else pic.x0
        put(page, cx, pic.y1 + gap_mm * MM + size * 0.75, caption, size=size, font=font)
        return doc

    def test_small_and_attached_is_the_resource_caption(self):
        tmp, md, lib, _ = extract(self.box_page("El río Tajo cerca de Toledo.", 8, "helv", 1.0, False))
        try:
            res = __import__("json").loads((Path(tmp.name) / "out" / "resources.json").read_text(encoding="utf-8"))
            pic = next(r for r in res if r.get("typeId") != "ground")
            self.assertEqual(pic["caption"], "El río Tajo cerca de Toledo.")
            self.assertNotIn("Toledo", md)
        finally:
            tmp.cleanup()

    @staticmethod
    def beside_page(side, align, size=8):
        """A box: two lines of text, a narrow picture, a two-line caption
        2 mm beside it, level with the picture's top or its foot."""
        doc = fitz.open()
        page = new_page(doc)
        x, y = 25 * MM, 40 * MM
        page.draw_rect(fitz.Rect(x - 10, y - 20, 175 * MM, 150 * MM), color=(0.2, 0.4, 0.7), fill=(0.93, 0.96, 1),
                       width=1)
        put(page, x, y, PARA[0], size=11)
        put(page, x, y + 14, PARA[1], size=11)
        px = x if side == "right" else x + 60 * MM
        pic = fitz.Rect(px, y + 30, px + 60 * MM, y + 30 + 20 * MM)
        page.insert_image(pic, stream=map_png())
        lines = ["El río Tajo cerca de", "Toledo, en invierno."]
        lead = size * 1.25
        top = pic.y0 + size * 0.75 if align == "top" else pic.y1 - lead * (len(lines) - 1) - size * 0.25
        for k, s in enumerate(lines):
            w = fitz.get_text_length(s, fontname="helv", fontsize=size)
            cx = pic.x1 + 2 * MM if side == "right" else pic.x0 - 2 * MM - w
            put(page, cx, top + k * lead, s, size=size)
        return doc

    def beside(self, side, align):
        tmp, md, lib, _ = extract(self.beside_page(side, align))
        try:
            res = __import__("json").loads((Path(tmp.name) / "out" / "resources.json").read_text(encoding="utf-8"))
            return next(r for r in res if r.get("typeId") != "ground"), md, lib
        finally:
            tmp.cleanup()

    def test_a_small_caption_beside_its_picture_is_the_resource_caption_inside(self):
        for side, align in (("right", "top"), ("left", "top"), ("right", "bottom")):
            with self.subTest(side=side, align=align):
                pic, md, lib = self.beside(side, align)
                self.assertEqual(pic["caption"], "El río Tajo cerca de Toledo, en invierno.")
                self.assertNotIn("Toledo", md)
                pl = pic["placement"]
                self.assertEqual(pl["captionSide"], "inside")
                self.assertEqual(pl["align"], "left" if side == "right" else "right")
                # under the box's words, the picture is set in its text (#1186): its share is of the
                # box's measure (60 mm of some 150), not of a frame round it
                self.assertTrue(0.35 < pl["width"] < 0.5, pl)
                self.assertFalse(any(f["name"].startswith("picture") for f in lib["pageTemplates"][0]["frames"]))
                # (the room above it as the source leaves it, in the box's lines)
                self.assertRegex(md, r':::frame\{slot="box"\}\n[^\n]+\n\n:::space\{lines=[\d.]+\}\n\n'
                                     r'::resource\{id="p01-picture-1"\}\n:::')

    def test_a_caption_as_large_as_the_box_text_beside_a_picture_stays_text(self):
        tmp, md, lib, _ = extract(self.beside_page("right", "top", size=11))
        try:
            self.assertIn("Toledo", md)
        finally:
            tmp.cleanup()

    def test_an_italic_caption_further_down_flows_after_its_picture_in_the_box(self):
        tmp, md, lib, _ = extract(self.box_page("El río Tajo cerca de Toledo.", 11, "heit", 5.0, False))
        try:
            # the box lays out its picture and the caption under it (#1186), in a paragraph style of the
            # caption's own look
            self.assertRegex(md, r'bajan por las laderas\n\n:::space\{lines=[\d.]+\}\n\n::resource\{id="p01-picture-1"\}\n\n'
                                 r'(?::::space\{lines=[\d.]+\}\n\n)?:::paragraphs\{style="(caption-1)"\}\nEl río Tajo cerca de Toledo\.\n:::\n:::')
            style = next(s for s in lib["paragraphStyles"] if s["id"] == "caption-1")
            self.assertTrue(style.get("italic"))     # set in italic: its style says so, no `*`
            self.assertEqual(style["textAlign"], "left")
            self.assertEqual([f["name"] for f in lib["pageTemplates"][0]["frames"]], ["box"])
        finally:
            tmp.cleanup()

    def test_a_line_like_the_box_text_stays_in_the_box(self):
        tmp, md, lib, _ = extract(self.box_page("Y el agua sigue su camino hacia el mar.", 11, "helv", 5.0, False))
        try:
            self.assertRegex(md, r':::frame\{slot="box[^"]*"\}\n[^:]*\n\n:::space\{lines=[\d.]+\}\n\n::resource\{id="[^"]+"\}\n\n'
                                 r'Y el agua sigue su camino hacia el mar\.\n:::')
        finally:
            tmp.cleanup()


if __name__ == "__main__":
    unittest.main()
