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

    def test_words_across_the_rules_are_no_table(self):
        doc = fitz.open()
        page = doc.new_page(width=210 * MM, height=297 * MM)
        for r in range(4):
            y = (TOP + r * ROW) * MM
            page.draw_line(fitz.Point(COLS[0] * MM, y), fitz.Point(COLS[-1] * MM, y), color=(0, 0, 0), width=0.6)
        for x in COLS:
            page.draw_line(fitz.Point(x * MM, TOP * MM), fitz.Point(x * MM, (TOP + 3 * ROW) * MM), color=(0, 0, 0), width=0.6)
        for r in range(3):
            page.insert_text(((COLS[0] + 2) * MM, (TOP + r * ROW + 6.5) * MM),
                             "a sentence that runs right across the grid's rules", fontsize=10, fontname="helv")
        pdf = Path(self.tmp.name) / "across.pdf"
        doc.save(str(pdf))
        out = Path(self.tmp.name) / "across"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            pr.main(["extract", str(pdf), "--out", str(out), "--lang", "en", "--name-frames", "never"])
        res = json.loads((out / "resources.json").read_text(encoding="utf-8"))
        self.assertFalse([r for r in res if r["kind"] == "table"])

    def test_a_table_in_a_box_goes_in_its_text(self):
        doc = fitz.open()
        page = doc.new_page(width=210 * MM, height=297 * MM)
        page.draw_rect(fitz.Rect(20 * MM, 40 * MM, 190 * MM, 140 * MM), color=(0.2, 0.4, 0.7), fill=(0.95, 0.97, 1), width=1)
        page.insert_text((25 * MM, 50 * MM), "The Romans wrote their numbers with seven letters:", fontsize=10, fontname="helv")
        top = 60
        # the header's fill is a rounded shape (curves), not a rectangle
        page.draw_rect(fitz.Rect(COLS[0] * MM, top * MM, COLS[-1] * MM, (top + 8) * MM), color=None, fill=HEAD, radius=0.2)
        for r, row in enumerate([("I", "V", "X"), ("1", "5", "10")]):
            for c, word in enumerate(row):
                page.insert_text(((COLS[c] + 2) * MM, (top + r * 8 + 5.5) * MM), word, fontsize=10,
                                 fontname="hebo" if r == 0 else "helv")
        for r in range(3):
            y = (top + r * 8) * MM
            page.draw_line(fitz.Point(COLS[0] * MM, y), fitz.Point(COLS[-1] * MM, y), color=(0, 0, 0), width=0.6)
        for x in COLS:
            page.draw_line(fitz.Point(x * MM, top * MM), fitz.Point(x * MM, (top + 16) * MM), color=(0, 0, 0), width=0.6)
        page.insert_text((25 * MM, 90 * MM), "Read them from left to right and add up their values.", fontsize=10, fontname="helv")
        pdf = Path(self.tmp.name) / "inbox.pdf"
        doc.save(str(pdf))
        out = Path(self.tmp.name) / "inbox"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            pr.main(["extract", str(pdf), "--out", str(out), "--lang", "en", "--name-frames", "never"])
        res = json.loads((out / "resources.json").read_text(encoding="utf-8"))
        lib = json.loads((out / "library.json").read_text(encoding="utf-8"))
        md = (out / "chapters" / "en" / "01-pages.md").read_text(encoding="utf-8")
        t = next(r for r in res if r["kind"] == "table")
        regions = json.loads((out / "regions.json").read_text(encoding="utf-8"))
        self.assertFalse([f for f in regions[0]["frames"] if f["name"].startswith("table")])
        a, b, c = (md.index("seven letters"), md.index(f'::resource{{id="{t["id"]}"}}'), md.index("add up"))
        self.assertTrue(a < b < c, md)
        st = next(s for s in lib["tableStyles"] if s["id"] == t["table"]["styleId"])
        self.assertIs(st["headerBackgroundEnabled"], True)

    def test_no_tables_keeps_the_old_reading(self):
        out = Path(self.tmp.name) / "plain"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            pr.main(["extract", str(self.pdf), "--out", str(out), "--lang", "en", "--name-frames", "never", "--no-tables"])
        res = json.loads((out / "resources.json").read_text(encoding="utf-8"))
        self.assertFalse([r for r in res if r["kind"] == "table"])


if __name__ == "__main__":
    unittest.main()
