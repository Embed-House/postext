"""Faces of `pdf_regions.py`: bold and italic read from every form of PDF
font name, the fonts table and the bold flag, and the warning when every
face comes out at one weight."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from test_pdf_regions_text import HAVE_DEPS, MM, extract  # noqa: E402

if HAVE_DEPS:
    import fitz
    import pdf_regions as pr


def named_page(names: dict[str, str]):
    """A page whose base-14 fonts are renamed (`/BaseFont`) to the forms
    producers write."""
    doc = fitz.open()
    page = doc.new_page(width=210 * MM, height=297 * MM)
    x, y = 25 * MM, 40 * MM
    for k in range(6):
        page.insert_text((x, y + k * 14), "Texto corrido de la página para medir el cuerpo.", fontname="helv",
                         fontsize=11)
    xx = x
    for word, font in (("Una ", "helv"), ("palabra", "hebo"), (" y otra ", "helv"), ("inclinada", "heit"),
                       (" y otra ", "helv"), ("negrita.", "cobo")):
        page.insert_text((xx, y + 100), word, fontname=font, fontsize=11)
        xx += fitz.get_text_length(word, fontname=font, fontsize=11)
    for xref, _ext, _typ, _base, ref, _enc in page.get_fonts():
        if ref in names:
            doc.xref_set_key(xref, "BaseFont", "/" + names[ref].replace(" ", "#20"))
    out = fitz.open()
    out.insert_pdf(fitz.open("pdf", doc.tobytes()))
    return out


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class FaceNames(unittest.TestCase):
    def test_split_face_name(self):
        self.assertEqual(pr.split_face_name("ABCDEF+Arial,Bold"), ("Arial", "Bold"))
        self.assertEqual(pr.split_face_name("Arial-BoldItalicMT"), ("Arial", "BoldItalicMT"))
        self.assertEqual(pr.split_face_name("Helvetica Bold"), ("Helvetica", "Bold"))
        self.assertEqual(pr.split_face_name("Minion Pro Semibold Italic"), ("Minion Pro", "SemiboldItalic"))
        self.assertEqual(pr.split_face_name("ArialBold"), ("Arial", "Bold"))
        self.assertEqual(pr.split_face_name("Gill Sans"), ("Gill Sans", ""))

    def test_face_from_the_name_alone(self):
        f = pr.Fonts()
        self.assertEqual(f.face("Arial,Bold"), ("Arial", 700, False))
        self.assertEqual(f.face("ABCDEF+Arial,Italic"), ("Arial", 400, True))
        self.assertEqual(f.face("Helvetica Bold"), ("Helvetica", 700, False))

    def test_table_weight_never_lowers_the_name(self):
        f = pr.Fonts()
        f.table = {"Arial": ("Arial", 400, "normal", "arial.ttf"),
                   "Arial-Italic": ("Arial", 400, "italic", "ariali.ttf")}
        # a prefix candidate whose style disagrees (regular for a bold name) is not taken
        fam, w, it = f.face("Arial,Bold")
        self.assertEqual((fam, w, it), ("Arial", 700, False))
        # the bold flag counts too, over a table hit
        self.assertEqual(f.face("Arial", 16)[1], 700)
        self.assertEqual(f.face("Arial")[1], 400)
        self.assertEqual(f.face("Arial-Italic"), ("Arial", 400, True))

    def test_bold_at_150_over_the_base_and_500(self):
        def md(base, w):
            c = [pr.Char(ch, i, 0, i + 1, 3, 3, "F", cw, False, 11, "#000000")
                 for i, (ch, cw) in enumerate(zip("ab cd", (base, base, base, w, w)))]
            return pr.runs_markdown(c, base, False, {}, "mark")
        self.assertEqual(md(300, 500), "ab **cd**")      # Medium over Light
        self.assertEqual(md(350, 500), "ab **cd**")      # Medium over a Book of 350
        self.assertEqual(md(400, 500), "ab cd")          # +100 is not bold
        self.assertEqual(md(300, 400), "ab cd")          # under 500 is not bold

    def test_bold_at_100_over_the_base_in_another_font(self):
        def md(base, base_font, w, font):
            c = [pr.Char(ch, i, 0, i + 1, 3, 3, "F", cw, False, 11, "#000000", font=f)
                 for i, (ch, cw, f) in enumerate(zip("ab cd", (base,) * 3 + (w,) * 2, (base_font,) * 3 + (font,) * 2))]
            return pr.runs_markdown(c, base, False, {}, "mark")
        self.assertEqual(md(400, "Face-Book", 500, "Face-Medium"), "ab **cd**")        # Medium over Book
        self.assertEqual(md(500, "Face-Medium", 600, "Face-Semibold"), "ab **cd**")    # Semibold over Medium
        self.assertEqual(md(400, "Face-Roman", 400, "Face-Book"), "ab cd")             # Book over Roman
        self.assertEqual(md(400, "Face-Book", 500, "Face-Book"), "ab cd")              # one font: +150

    def test_draft_marks_bold_and_italic(self):
        doc = named_page({"helv": "Arial", "hebo": "Arial,Bold", "heit": "Arial,Italic", "cobo": "Helvetica Bold"})
        tmp, md, lib, report = extract(doc)
        try:
            self.assertIn("Una **palabra** y otra *inclinada* y otra **negrita.**", md)
            self.assertEqual(report["fonts"]["Arial,Bold"][:2], ["Arial", 700])
            self.assertEqual(report["warnings"], [])
        finally:
            tmp.cleanup()

    def test_one_weight_warning(self):
        f = pr.Fonts()
        f.seen = {"Arial": ("Arial", 400, False), "Arial-Bold": ("Arial", 400, False)}
        self.assertTrue(pr.font_warnings(f))
        f.seen = {"Arial": ("Arial", 400, False), "Arial-Bold": ("Arial", 700, False)}
        self.assertEqual(pr.font_warnings(f), [])


if __name__ == "__main__":
    unittest.main()
