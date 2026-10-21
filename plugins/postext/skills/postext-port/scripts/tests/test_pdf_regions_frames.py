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


if __name__ == "__main__":
    unittest.main()
