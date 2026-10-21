"""Tests of ruled grids read as table resources by `pdf_regions.py extract`
(#1132), on a page drawn in the test.

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
    import PIL  # noqa: F401
    HAVE_DEPS = hasattr(fitz.Page, "find_tables")
except Exception:  # pragma: no cover
    HAVE_DEPS = False

if HAVE_DEPS:
    import pdf_regions as pr

MM = 72 / 25.4
HEAD = (0.2, 0.45, 0.7)
COLS = (30, 80, 130, 180)
TOP, ROW = 60, 10


def draw_page(doc) -> None:
    page = doc.new_page(width=210 * MM, height=297 * MM)
    page.insert_text((20 * MM, 30 * MM), "The table below lists the rivers and how long each one runs.",
                     fontsize=11, fontname="helv")
    rows = [("River", "Length", "Sea"), ("Ebro", "910 km", "Mediterranean"), ("Tajo", "1007 km", "Atlantic"),
            ("Duero", "897 km", "Atlantic"), ("Miño", "340 km", "Atlantic")]
    page.draw_rect(fitz.Rect(COLS[0] * MM, TOP * MM, COLS[-1] * MM, (TOP + ROW) * MM), color=None, fill=HEAD)
    for r, row in enumerate(rows):
        for c, word in enumerate(row):
            x = COLS[c] * MM + 2 * MM
            y = (TOP + r * ROW + 6.5) * MM
            page.insert_text((x, y), word, fontsize=10, fontname="hebo" if r == 0 else "helv",
                             color=(1, 1, 1) if r == 0 else (0.1, 0.1, 0.1))
    for r in range(len(rows) + 1):
        y = (TOP + r * ROW) * MM
        page.draw_line(fitz.Point(COLS[0] * MM, y), fitz.Point(COLS[-1] * MM, y), color=(0.2, 0.2, 0.2), width=0.6)
    for x in COLS:
        page.draw_line(fitz.Point(x * MM, TOP * MM), fitz.Point(x * MM, (TOP + len(rows) * ROW) * MM),
                       color=(0.2, 0.2, 0.2), width=0.6)
    page.insert_text((20 * MM, 140 * MM), "Words after the table go on in the running text of the page.",
                     fontsize=11, fontname="helv")


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF with find_tables, numpy and Pillow")
class GridTableTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        doc = fitz.open()
        draw_page(doc)
        cls.pdf = root / "grid.pdf"
        doc.save(str(cls.pdf))
        cls.out = root / "out"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            pr.main(["extract", str(cls.pdf), "--out", str(cls.out), "--lang", "en", "--name-frames", "never"])
        cls.lib = json.loads((cls.out / "library.json").read_text(encoding="utf-8"))
        cls.res = json.loads((cls.out / "resources.json").read_text(encoding="utf-8"))
        cls.md = (cls.out / "chapters" / "en" / "01-pages.md").read_text(encoding="utf-8")
        cls.regions = json.loads((cls.out / "regions.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def table(self) -> dict:
        tables = [r for r in self.res if r["kind"] == "table"]
        self.assertEqual(len(tables), 1, self.res)
        return tables[0]

    def test_the_grid_is_one_table_resource(self):
        t = self.table()
        rows = t["table"]["model"]["rows"]
        self.assertEqual(len(rows), 5)
        self.assertEqual([c["content"] for c in rows[2]], ["Tajo", "1007 km", "Atlantic"])
        self.assertEqual(t["table"]["model"]["headerRowCount"], 1)
        self.assertTrue(all(c.get("isHeader") for c in rows[0]))

    def test_its_style_has_the_header_fill_and_the_grid(self):
        t = self.table()
        st = next(s for s in self.lib["tableStyles"] if s["id"] == t["table"]["styleId"])
        self.assertEqual(st["rules"], "grid")
        self.assertIs(st["headerBackgroundEnabled"], True)
        self.assertTrue(st["headerBold"])
        self.assertEqual(st["bodyFontSize"]["unit"], "pt")

    def test_it_is_placed_where_it_stood_and_its_words_are_claimed(self):
        t = self.table()
        frame = next(f for f in self.regions[0]["frames"] if self.md.count(f'::resource{{id="{t["id"]}" slot="{f["name"]}"}}'))
        for got, want in zip(frame["box"], (COLS[0], TOP, COLS[-1], TOP + 5 * ROW)):
            self.assertAlmostEqual(got, want, delta=1.0)
        self.assertNotIn("Mediterranean", self.md)
        self.assertNotIn("Duero", self.md)
        self.assertIn("Words after the table", self.md)

    def test_its_rules_and_fill_are_no_decoration(self):
        els = self.lib["pageTemplates"][0]["decoration"]["elements"]
        self.assertFalse([e for e in els if e["kind"] in ("path", "connector")], els)
        self.assertFalse([e for e in els if (e.get("style") or {}).get("backgroundColor")], els)
        self.assertFalse([r for r in self.res if r["typeId"] == "ground"])

    def test_no_tables_keeps_the_old_reading(self):
        out = Path(self.tmp.name) / "plain"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            pr.main(["extract", str(self.pdf), "--out", str(out), "--lang", "en", "--name-frames", "never", "--no-tables"])
        res = json.loads((out / "resources.json").read_text(encoding="utf-8"))
        self.assertFalse([r for r in res if r["kind"] == "table"])


if __name__ == "__main__":
    unittest.main()
