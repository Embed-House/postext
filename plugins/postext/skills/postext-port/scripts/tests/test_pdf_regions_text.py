"""Text rules of `pdf_regions.py` on small PDFs drawn in the test: measured
spaces (thin, en, em), chip gaps, nested lists and bullet sizes, synthetic
italic."""
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
    import postext_md as pmd

MM = 72 / 25.4
EN, EM, NNBSP = " ", " ", " "


def put(page, x, y, s, size=12, font="helv", color=(0.1, 0.1, 0.1)):
    """Writes `s` at (x, y) points and returns the x where it ends."""
    page.insert_text((x, y), s, fontsize=size, fontname=font, color=color)
    return x + fitz.get_text_length(s, fontname=font, fontsize=size)


def page_lines(doc):
    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    tmp.close()
    doc.save(tmp.name)
    src = fitz.open(tmp.name)
    page = src[0]
    origin = pr.trim_origin(page)
    lines, _ = pr.read_lines(tmp.name, page, pr.Fonts(), origin)
    return lines


def line_with(lines, word):
    return next(l for l in lines if word in l.plain)


def extract(doc, *more):
    tmp = tempfile.TemporaryDirectory()
    root = Path(tmp.name)
    pdf = root / "src.pdf"
    doc.save(str(pdf))
    out = root / "out"
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        pr.main(["extract", str(pdf), "--out", str(out), "--lang", "es", *more])
    md = (out / "chapters" / "es" / "01-pages.md").read_text(encoding="utf-8")
    lib = json.loads((out / "library.json").read_text(encoding="utf-8"))
    report = json.loads((out / "report.json").read_text(encoding="utf-8"))
    return tmp, md, lib, report


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class MeasuredSpaces(unittest.TestCase):
    def test_thin_en_em_gaps(self):
        doc = fitz.open()
        page = doc.new_page(width=210 * MM, height=297 * MM)
        em = 12
        # thin gaps, no space character: 1 000 and 21 %
        x = put(page, 60, 50, "Hay 1")
        x = put(page, x + 0.15 * em, 50, "000")
        x = put(page, x + 0.28 * em, 50, "casos,")
        x = put(page, x + 0.28 * em, 50, "un 21")
        put(page, x + 0.15 * em, 50, "%")
        # en and em gaps in a heading
        x = put(page, 60, 90, "2", size=20, font="hebo")
        x = put(page, x + 0.6 * 20, 90, "Los seres", size=20, font="hebo")
        put(page, x + 0.9 * 20, 90, "vivos", size=20, font="hebo")
        # en and em space characters the source sets itself
        tw = fitz.TextWriter(page.rect)
        tw.append((60, 130), f"Tema 3{EN}Las{EM}plantas", font=fitz.Font("cjk"), fontsize=12)
        tw.write_text(page)
        lines = page_lines(doc)
        body = line_with(lines, "casos")
        text = pmd.clean_text(body.plain)
        self.assertIn(f"1{NNBSP}000 casos", text)
        self.assertIn(f"21{NNBSP}%", text)
        head = line_with(lines, "seres")
        self.assertEqual(pmd.heading(1, pr.spaced_text(head)), f"# 2{EN}Los seres{EM}vivos")
        own = line_with(lines, "Tema")
        self.assertEqual(pmd.clean_text(pr.spaced_text(own)), f"Tema 3{EN}Las{EM}plantas")

    def test_word_spaces_stay_plain(self):
        doc = fitz.open()
        page = doc.new_page(width=210 * MM, height=297 * MM)
        put(page, 60, 50, "Una frase corriente con 12 palabras y 3 mesas", size=20, font="hebo")
        line = page_lines(doc)[0]
        self.assertEqual(pr.spaced_text(line), "Una frase corriente con 12 palabras y 3 mesas")

    @staticmethod
    def chip_page(gap_em):
        """A title after a number chip and a paragraph opened by a letter chip,
        `gap_em` of room between each band and the words after it."""
        doc = fitz.open()
        page = doc.new_page(width=210 * MM, height=297 * MM)
        x0 = 20 * MM
        w = fitz.get_text_length("3", fontname="hebo", fontsize=20)
        page.draw_rect(fitz.Rect(x0 - 3, 30 * MM - 17, x0 + w + 3, 30 * MM + 5), color=None, fill=(0.9, 0.3, 0.1))
        put(page, x0, 30 * MM, "3", size=20, font="hebo", color=(1, 1, 1))
        put(page, x0 + w + 3 + gap_em * 20, 30 * MM, "Las plantas", size=20, font="hebo")
        w2 = fitz.get_text_length("A", fontname="hebo", fontsize=11)
        y = 60 * MM
        page.draw_rect(fitz.Rect(x0 - 2, y - 10, x0 + w2 + 2, y + 3), color=None, fill=(0.9, 0.3, 0.1))
        put(page, x0, y, "A", size=11, font="hebo", color=(1, 1, 1))
        put(page, x0 + w2 + 2 + gap_em * 11, y, "Observa las hojas de la planta y dibuja su forma.", size=11)
        for k in range(6):   # body text: the page's body size
            put(page, x0, y + (k + 1) * 14, "Texto de la página que da el tamaño del cuerpo a las líneas.", size=11)
        return doc

    def test_title_and_mark_after_a_number_chip(self):
        tmp, md, _, _ = extract(self.chip_page(0.35))
        try:
            self.assertIn(f"# 3{EN}Las plantas", md)
            self.assertIn(f":mark[**A**]{{style=\"mark-orange\"}}{EN}Observa", md)
            self.assertIn("forma. Texto de", md)
        finally:
            tmp.cleanup()

    def test_chip_style_gap(self):
        tmp, md, lib, _ = extract(self.chip_page(0.7), "--highlights", "chip")
        try:
            chip = lib["chipStyles"][0]
            self.assertEqual(chip["gap"]["unit"], "em")
            self.assertAlmostEqual(chip["gap"]["value"], 0.7, delta=0.08)
            self.assertIn(":chip[**A**]", md)
            self.assertNotIn(f"]{EN}", md)
        finally:
            tmp.cleanup()
        tmp, md, lib, _ = extract(self.chip_page(0.2), "--highlights", "chip")
        try:
            self.assertNotIn("gap", lib["chipStyles"][0])
        finally:
            tmp.cleanup()


if __name__ == "__main__":
    unittest.main()
