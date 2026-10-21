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


if __name__ == "__main__":
    unittest.main()
