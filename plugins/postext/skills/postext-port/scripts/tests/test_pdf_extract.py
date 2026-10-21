"""Tests of `pdf_extract.py` (the flowing draft) on small PDFs drawn in the
test."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

try:
    import fitz
    HAVE_FITZ = True
except Exception:  # pragma: no cover
    HAVE_FITZ = False

if HAVE_FITZ:
    import pdf_extract as pex

MM = 72 / 25.4
BODY = "Texto corrido de la página que da el tamaño del cuerpo a las líneas."


def put(page, x, y, s, size=11, font="helv"):
    page.insert_text((x, y), s, fontsize=size, fontname=font)
    return x + fitz.get_text_length(s, fontname=font, fontsize=size)


def run_draft(doc, rules, *more):
    """pdf_extract.py markdown on `doc`: (chapters text, resources, report)."""
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        doc.save(str(root / "src.pdf"))
        (root / "roles.json").write_text(json.dumps({"rules": rules}), encoding="utf-8")
        subprocess.run([sys.executable, str(SCRIPTS / "pdf_extract.py"), "markdown", str(root / "src.pdf"),
                        "--roles", str(root / "roles.json"), "--out", str(root / "out"), *more],
                       check=True, capture_output=True)
        md = "".join(p.read_text(encoding="utf-8") for p in sorted((root / "out" / "chapters").rglob("*.md")))
        res = json.loads((root / "out" / "resources.json").read_text(encoding="utf-8"))
        rep = (root / "out" / "report.md").read_text(encoding="utf-8")
    return md, res, rep


@unittest.skipUnless(HAVE_FITZ, "needs PyMuPDF")
class CaptionLabel(unittest.TestCase):
    def test_strip_keeps_an_opening_mark(self):
        self.assertEqual(pex.strip_caption_label("Fig. 1. *tako-tsubo* es", "Fig. 1."), "*tako-tsubo* es")
        self.assertEqual(pex.strip_caption_label("**Figura 1.** El corazón", "Figura 1."), "El corazón")
        self.assertEqual(pex.strip_caption_label("**Figura 1. El corazón**", "Figura 1."), "**El corazón**")
        self.assertEqual(pex.strip_caption_label("*Fig. 2.* *Homo* y más", "Fig. 2."), "*Homo* y más")
        self.assertEqual(pex.strip_caption_label("Sin etiqueta", "Fig. 3."), "Sin etiqueta")

    def test_italic_word_in_a_caption_role(self):
        doc = fitz.open()
        page = doc.new_page(width=210 * MM, height=297 * MM)
        for k in range(8):
            put(page, 25 * MM, 40 * MM + k * 14, BODY)
        y = 40 * MM + 9 * 14
        # the caption's longest span is italic, but most of its letters are roman
        x = put(page, 25 * MM, y, "Fig. 1. Imagen: ", size=9)
        x = put(page, x, y, "tako-tsubo cardiomyopathy", size=9, font="heit")
        put(page, x, y, " es una enfermedad.", size=9)
        md, res, _ = run_draft(doc, [{"size": 9, "role": "caption"}])
        self.assertEqual(res[0]["caption"], "Imagen: *tako-tsubo cardiomyopathy* es una enfermedad.")


def refs_page():
    """Body text with coloured bold figure mentions, a numbered section
    heading, a caption, and chapter and section mentions."""
    doc = fitz.open()
    page = doc.new_page(width=210 * MM, height=297 * MM)
    x, y = 25 * MM, 40 * MM
    put(page, x, y, "2. Los ríos", size=16, font="hebo")
    orange = (0.9, 0.45, 0.1)
    for k, (before, after) in enumerate((("Como muestra la ", " el agua baja."), ("Vuelve a la ", " y compárala."))):
        yy = y + 20 + k * 14
        xx = put(page, x, yy, before)
        page.insert_text((xx, yy), "Figura 1", fontsize=11, fontname="hebo", color=orange)
        xx += fitz.get_text_length("Figura 1", fontname="hebo", fontsize=11)
        put(page, xx, yy, after)
    put(page, x, y + 48, "Lee otra vez el capítulo 2 y la sección 9 del libro. También la Figura 5.")
    for k in range(5):
        put(page, x, y + 62 + k * 14, BODY)
    put(page, x, y + 150, "Figura 1. El río baja de la montaña.", size=9)
    return doc


RULES = [{"size": 16, "role": "h2"}, {"size": 9, "role": "caption"}]


@unittest.skipUnless(HAVE_FITZ, "needs PyMuPDF")
class LinkRefs(unittest.TestCase):
    def test_mentions_link_by_default(self):
        md, res, rep = run_draft(refs_page(), RULES)
        fig = res[0]["id"]
        self.assertIn(f'Como muestra la :ref{{id="{fig}" style="full"}} el agua baja.', md)
        self.assertNotIn("**:ref", md)
        self.assertRegex(md, r"## (2\. )?Los ríos \{id=\"sec-[^\"]+\"\}")
        hid = __import__("re").search(r'\{id="(sec-[^"]+)"\}', md).group(1)
        self.assertIn(f':ref{{id="{hid}" text="capítulo 2"}}', md)
        self.assertIn("la sección 9 del", md)
        self.assertIn("## Mentions left as text", rep)
        self.assertIn("- sección 9: 1", rep)
        self.assertIn("- Figura 5: 1", rep)
        self.assertIn("`bodyText.referenceColor` to #e6731a", rep)

    def test_no_link_refs(self):
        md, _, _ = run_draft(refs_page(), RULES, "--no-link-refs")
        self.assertNotIn(":ref{", md)
        self.assertIn("**Figura 1**", md)

    def test_refs_from_resources(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "resources.json"
            path.write_text(json.dumps([{"id": "mapa", "caption": "Figura 5. Mapa del río."}]), encoding="utf-8")
            md, _, rep = run_draft(refs_page(), RULES, "--refs-from", str(path))
        self.assertIn(':ref{id="mapa" style="full"}', md)
        self.assertNotIn("- Figura 5:", rep)


if __name__ == "__main__":
    unittest.main()
