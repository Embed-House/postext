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


def bullet(page, x, y, char, size, words, text_size=11, gap=2.0, bfont="helv"):
    """A list item: `char` at x (points) in `size`, its words `gap` points
    after the bullet's advance."""
    font = fitz.Font(bfont)
    w = font.text_length(char, fontsize=size)
    tw = fitz.TextWriter(page.rect)     # insert_text would set U+2022 as a middle dot
    tw.append((x, y), char, font=font, fontsize=size)
    tw.write_text(page, color=(0.1, 0.1, 0.1))
    put(page, x + w + gap, y, words, size=text_size)


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class NestedLists(unittest.TestCase):
    @staticmethod
    def list_page(in_box):
        doc = fitz.open()
        page = doc.new_page(width=210 * MM, height=297 * MM)
        x = 25 * MM
        y = 40 * MM
        if in_box:
            page.draw_rect(fitz.Rect(x - 12, y - 20, 150 * MM, y + 100), color=(0.2, 0.4, 0.7), fill=(0.9, 0.95, 1),
                           width=1)
        # level 1: a large bold bullet; level 2: a small white bullet, 6 mm further in
        bullet(page, x, y, "•", 14, "Las raíces sujetan la planta al suelo.", bfont="hebo")
        bullet(page, x + 6 * MM, y + 15, "◦", 8, "Raíz principal y raíces secundarias.")
        bullet(page, x + 6 * MM, y + 30, "◦", 8, "Pelos absorbentes.")
        bullet(page, x, y + 45, "•", 14, "El tallo lleva el agua a las hojas.", bfont="hebo")
        bullet(page, x, y + 60, "•", 14, "Las hojas fabrican el alimento.", bfont="hebo")
        for k in range(5):
            put(page, x - 8, y + 130 + k * 14, "Texto corrido de la página para medir el cuerpo del texto.", size=11)
        return doc

    def check(self, md, lib, style_kind):
        self.assertIn("- Las raíces sujetan la planta al suelo.\n"
                      "  - Raíz principal y raíces secundarias.\n"
                      "  - Pelos absorbentes.\n"
                      "- El tallo lleva el agua a las hojas.\n"
                      "- Las hojas fabrican el alimento.", md)
        st = next(s for s in lib["calloutStyles"] if s.get("lists"))
        self.assertTrue(st["id"].startswith(style_kind), st["id"])
        lists = st["lists"]
        self.assertEqual(lists["bulletChar"], "•")
        self.assertAlmostEqual(lists["bulletFontSize"]["value"], 14 / 11, delta=0.06)
        self.assertEqual(lists["bulletFontWeight"], 700)
        # the gap runs from the bullet's advance to the words
        self.assertAlmostEqual(lists["gap"]["value"], 2.0 / MM, delta=0.3)
        ul = lib["suggested"]["unorderedLists"]
        self.assertEqual(ul["bulletChar"], "•")
        self.assertEqual([lv["bulletChar"] for lv in ul["levels"]], ["•", "◦"])
        self.assertAlmostEqual(ul["levels"][1]["fontSize"]["value"], 8 / 11, delta=0.06)
        self.assertEqual(ul["levels"][1]["fontWeight"], 400)

    def test_nested_list_in_a_box(self):
        tmp, md, lib, _ = extract(self.list_page(True))
        try:
            self.check(md, lib, "box")
        finally:
            tmp.cleanup()

    def test_nested_list_in_running_text(self):
        tmp, md, lib, _ = extract(self.list_page(False))
        try:
            self.check(md, lib, "text")
        finally:
            tmp.cleanup()

    def test_bullet_colour_and_item_spacing(self):
        doc = fitz.open()
        page = doc.new_page(width=210 * MM, height=297 * MM)
        x, y = 25 * MM, 40 * MM
        # two-line items: 13 pt between their lines, 20 pt from one item to the next
        for k in range(3):
            yy = y + k * 33
            bullet(page, x, yy, "•", 11, "Una frase larga que ocupa la primera línea del punto")
            put(page, x + 4 * MM, yy + 13, "y sigue en una segunda línea.", size=11)
        for k in range(4):
            put(page, x, y + 130 + k * 13, "Texto corrido de la página para medir el cuerpo del texto.", size=11)
        tmp, md, lib, _ = extract(doc)
        try:
            st = next(s for s in lib["calloutStyles"] if s.get("lists"))
            self.assertEqual(st["lists"]["color"]["hex"], "#1a1a1a")
            self.assertAlmostEqual(st["lists"]["itemSpacing"]["value"], 7 / MM, delta=0.3)
            self.assertEqual(lib["suggested"]["unorderedLists"]["color"]["hex"], "#1a1a1a")
            self.assertEqual(md.count("- Una frase larga"), 3)
        finally:
            tmp.cleanup()

    def test_levels(self):
        lv = [pr.Char("•", 10, 0, 12, 3, 3, "f", 400, False, 11, "#000000"),
              pr.Char("•", 16.2, 0, 18, 3, 3, "f", 400, False, 11, "#000000"),
              pr.Char("•", 10.8, 0, 12, 3, 3, "f", 400, False, 11, "#000000")]
        lines = [pr.Line([c, pr.Char("a", c.x1 + 1, 0, c.x1 + 3, 3, 3, "f", 400, False, 11, "#000000")]) for c in lv]
        levels = pr.list_levels(lines)
        self.assertEqual(levels, [10, 16.2])
        self.assertEqual([pr.level_of_bullet(c, levels) for c in lv], [0, 1, 0])


def slanted_page(shear=0.25):
    """Running text with two words set in the upright face sheared by the text
    matrix (`shear` leans right), a real italic word, and a back-slanted one
    that is not italic either way below 0.15."""
    doc = fitz.open()
    page = doc.new_page(width=210 * MM, height=297 * MM)
    x0, y = 25 * MM, 40 * MM
    x = put(page, x0, y, "El ser humano, ", size=11)
    o = fitz.Point(x, y)
    # the morph matrix acts in PDF space (y up): a positive c leans the letters right
    page.insert_text(o, "Homo sapiens", fontsize=11, fontname="helv", color=(0.1, 0.1, 0.1),
                     morph=(o, fitz.Matrix(1, 0, shear, 1, 0, 0)))
    x += fitz.get_text_length("Homo sapiens", fontname="helv", fontsize=11)
    x = put(page, x, y, ", vive en la ", size=11)
    x = put(page, x, y, "Tierra", size=11, font="heit")
    put(page, x, y, " desde hace mucho tiempo.", size=11)
    x = put(page, x0, y + 15, "Una línea con ", size=11)
    o = fitz.Point(x, y + 15)
    page.insert_text(o, "poca", fontsize=11, fontname="helv", color=(0.1, 0.1, 0.1),
                     morph=(o, fitz.Matrix(1, 0, 0.08, 1, 0, 0)))
    x += fitz.get_text_length("poca", fontname="helv", fontsize=11)
    put(page, x, y + 15, " inclinación y nada más que decir aquí.", size=11)
    for k in range(4):
        put(page, x0, y + 30 + k * 14, "Texto corrido de la página para medir el cuerpo del texto.", size=11)
    return doc


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class SyntheticItalic(unittest.TestCase):
    def test_char_shears(self):
        import pdf_extract as pex

        page = slanted_page()[0]
        runs, shear = [], {}
        for b in page.get_text("rawdict")["blocks"]:
            for l in b.get("lines", []):
                for s in l["spans"]:
                    chars = s["chars"]
                    text = "".join(c["c"] for c in chars)
                    # MuPDF puts the sheared words in the span of the upright text around them
                    runs += ["".join(c["c"] for c in chars[i:j]) for i, j, m in pex.slant_runs(chars, False) if m]
                    for word in ("Homo sapiens", "poca", "Tierra", "humano"):
                        k = text.find(word)
                        if k >= 0:
                            shear[word] = pex.span_shear(chars[k:k + len(word) + 1])
        self.assertEqual(runs, ["Homo sapiens"])
        self.assertAlmostEqual(shear["Homo sapiens"], 0.25, delta=0.02)
        self.assertAlmostEqual(shear["poca"], 0.08, delta=0.02)
        self.assertAlmostEqual(shear["Tierra"], 0.0, delta=0.02)
        self.assertAlmostEqual(shear["humano"], 0.0, delta=0.02)
        # an italic face is not read again
        chars = next(s["chars"] for b in page.get_text("rawdict")["blocks"] for l in b.get("lines", [])
                     for s in l["spans"] if "Homo" in "".join(c["c"] for c in s["chars"]))
        self.assertFalse(any(pex.slant_mask(chars, True)))

    def test_regions_draft_writes_emphasis(self):
        tmp, md, _, report = extract(slanted_page())
        try:
            self.assertIn("El ser humano, *Homo sapiens*, vive en la *Tierra* desde", md)
            self.assertIn("Una línea con poca inclinación", md)
            self.assertEqual(report["syntheticItalic"], {"Helvetica": 1})
        finally:
            tmp.cleanup()

    def test_flow_draft_writes_emphasis_and_counts(self):
        import subprocess

        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            slanted_page().save(str(root / "src.pdf"))
            (root / "roles.json").write_text(json.dumps({"rules": []}), encoding="utf-8")
            subprocess.run([sys.executable, str(SCRIPTS / "pdf_extract.py"), "markdown", str(root / "src.pdf"),
                            "--roles", str(root / "roles.json"), "--out", str(root / "out")],
                           check=True, capture_output=True)
            md = "".join(p.read_text(encoding="utf-8") for p in sorted((root / "out").rglob("*.md"))
                         if p.name != "report.md")
            rep = (root / "out" / "report.md").read_text(encoding="utf-8")
        self.assertIn("*Homo sapiens*", md)
        self.assertIn("*Tierra*", md)
        self.assertNotIn("*poca*", md)
        self.assertIn("spans in a slanted upright face read as italic (Helvetica): 1", rep)


if __name__ == "__main__":
    unittest.main()
