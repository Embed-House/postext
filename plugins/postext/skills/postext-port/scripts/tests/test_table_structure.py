"""Tests of the table structure `extract_tables.py` reads (#1145): merged
cells kept as spans, a title row taken as caption and label, group bands,
header rows counted from the look, two rows PyMuPDF read as one split again,
and `pdf_extract.py markdown` setting ruled tables as table resources.

    python3 -m pytest plugins/postext/skills/postext-port/scripts/tests -q
"""
from __future__ import annotations

import contextlib
import io
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
    HAVE_FITZ = hasattr(fitz.Page, "find_tables")
except Exception:  # pragma: no cover
    HAVE_FITZ = False

import extract_tables as et  # noqa: E402

X = [40, 160, 260, 380]


def draw(page, top: float, title: str | None, band_fill=(1.0, 0.9, 0.7)) -> float:
    """A ruled table at `top`: an optional title row over every column, a
    bold header on a blue fill, a body row, a centred group band, a row
    holding two source rows (no rule between them) and a last row. Returns
    its foot."""
    heights = ([20] if title else []) + [20, 20, 20, 36, 20]
    Y = [top]
    for h in heights:
        Y.append(Y[-1] + h)
    first = 1 if title else 0
    header, band = first, first + 2
    page.draw_rect(fitz.Rect(X[0], Y[header], X[3], Y[header + 1]), color=None, fill=(0.85, 0.9, 1.0))
    page.draw_rect(fitz.Rect(X[0], Y[band], X[3], Y[band + 1]), color=None, fill=band_fill)
    for y in Y:
        page.draw_line((X[0], y), (X[3], y), width=0.6)
    spanning = {band} | ({0} if title else set())
    for x in X:
        for r, (a, b) in enumerate(zip(Y, Y[1:])):
            if r in spanning and x not in (X[0], X[3]):
                continue
            page.draw_line((x, a), (x, b), width=0.6)

    def put(text, c0, c1, row, align="left", font="helv", lines=None):
        for k, t in enumerate(lines or [text]):
            w = fitz.get_text_length(t, fontname=font, fontsize=9)
            x = {"left": X[c0] + 4, "center": (X[c0] + X[c1] - w) / 2, "right": X[c1] - 4 - w}[align]
            page.insert_text((x, Y[row] + 13 + k * 14), t, fontname=font, fontsize=9)

    if title:
        put(title, 0, 3, 0, "center", "hebo")
    for c, t in enumerate(["Prueba", "Valor", "Unidad"]):
        put(t, c, c + 1, header, "center", "hebo")
    put("glucosa", 0, 1, header + 1)
    put("90", 1, 2, header + 1, "right")
    put("mg/dl", 2, 3, header + 1)
    put("Iones", 0, 3, band, "center", "hebo")
    put("", 0, 1, band + 1, lines=["sodio", "potasio"])
    put("", 1, 2, band + 1, "right", lines=["140", "4"])
    put("", 2, 3, band + 1, lines=["mmol/l", "mmol/l"])
    put("calcio", 0, 1, band + 2)
    put("9", 1, 2, band + 2, "right")
    put("mg/dl", 2, 3, band + 2)
    return Y[-1]


def tables_of(pdf: Path) -> list[dict]:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        et.main([str(pdf), "--full"])
    return json.loads(buf.getvalue())


@unittest.skipUnless(HAVE_FITZ, "needs PyMuPDF >= 1.23")
class Structure(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.pdf = Path(cls.tmp.name) / "t.pdf"
        doc = fitz.open()
        draw(doc.new_page(width=420, height=500), 60, "Tabla 2. Valores normales")
        doc.save(str(cls.pdf))
        cls.found = tables_of(cls.pdf)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_title_row_is_caption_and_label(self):
        t = self.found[0]
        self.assertEqual((t["label"], t["caption"]), ("Tabla 2.", "Valores normales"))
        self.assertEqual(t["model"]["rows"][0][0]["content"], "Prueba")

    def test_header_rows_from_bold_and_fill(self):
        self.assertEqual(self.found[0]["model"]["headerRowCount"], 1)
        self.assertTrue(all(c["isHeader"] for c in self.found[0]["model"]["rows"][0]))

    def test_group_band_keeps_its_span_fill_and_centre(self):
        band = self.found[0]["model"]["rows"][2]
        self.assertEqual(band[0]["colSpan"], 3)
        self.assertEqual(band[0]["align"], "center")
        self.assertEqual(band[0]["background"], {"hex": "#ffe5b2", "model": "hex"})
        self.assertEqual(band[1:], [{"content": "", "hiddenBy": {"row": 2, "col": 0}}] * 2)

    def test_two_rows_read_as_one_are_split(self):
        rows = self.found[0]["model"]["rows"]
        self.assertEqual([r[0]["content"] for r in rows[3:]], ["sodio", "potasio", "calcio"])
        self.assertEqual([r[1]["content"] for r in rows[3:5]], ["140", "4"])
        self.assertEqual(rows[4][1]["align"], "right")

    def test_without_a_caption_label_the_first_spanning_row_stays(self):
        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "t.pdf"
            doc = fitz.open()
            draw(doc.new_page(width=420, height=500), 60, "Resultados del laboratorio")
            doc.save(str(pdf))
            t = tables_of(pdf)[0]
            self.assertNotIn("caption", t)
            self.assertEqual(t["model"]["rows"][0][0]["colSpan"], 3)

    def test_merges_from_none_cells(self):
        grid = [["a", None, "b"], ["c", "d", "e"]]
        boxes = [[(0, 0, 20, 10), None, (20, 0, 30, 10)], [(0, 10, 10, 20), (10, 10, 20, 20), (20, 10, 30, 20)]]
        spans, hidden = et.merged_cells(grid, boxes)
        self.assertEqual(spans, {(0, 0): (1, 2)})
        self.assertEqual(hidden, {(0, 1): (0, 0)})


@unittest.skipUnless(HAVE_FITZ, "needs PyMuPDF >= 1.23")
class PdfExtract(unittest.TestCase):
    def test_tables_become_table_resources_and_leave_the_paragraphs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            doc = fitz.open()
            page = doc.new_page(width=420, height=700)
            page.insert_text((40, 40), "Body text before the tables.", fontsize=10)
            foot = draw(page, 60, "Tabla 2. Valores normales")
            page.insert_text((40, foot + 30), "Tabla 3. Electrolitos", fontsize=8, fontname="hebo")
            foot2 = draw(page, foot + 40, None)
            page.insert_text((40, foot2 + 24), "Body text after the tables.", fontsize=10)
            doc.save(str(root / "s.pdf"))
            roles = {"rules": [{"size": 8, "role": "caption"}, {"size": 10, "role": "body"}, {"role": "body"}]}
            (root / "roles.json").write_text(json.dumps(roles))
            r = subprocess.run([sys.executable, str(SCRIPTS / "pdf_extract.py"), "markdown", str(root / "s.pdf"),
                                "--roles", str(root / "roles.json"), "--out", str(root / "out"), "--lang", "es",
                                "--split-role", "none", "--no-auto-furniture"],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            res = json.loads((root / "out" / "resources.json").read_text(encoding="utf-8"))
            tables = [x for x in res if x.get("kind") == "table"]
            self.assertEqual([x["caption"] for x in tables], ["Valores normales", "Electrolitos"])
            self.assertTrue(all("model" in x.get("table", {}) for x in tables), res)
            self.assertEqual(tables[0]["source"]["label"], "Tabla 2.")
            md = next((root / "out" / "chapters" / "es").glob("*.md")).read_text(encoding="utf-8")
            self.assertNotIn("glucosa", md)
            self.assertNotIn("sodio", md)
            self.assertEqual(md.count("::resource"), 2)
            self.assertLess(md.index("before"), md.index("::resource"))
            self.assertLess(md.rindex("::resource"), md.index("after"))


if __name__ == "__main__":
    unittest.main()
