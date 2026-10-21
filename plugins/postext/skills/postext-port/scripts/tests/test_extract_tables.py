"""Tests of `extract_tables.py` on tables drawn in the test with PyMuPDF.

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
    HAVE_FITZ = hasattr(fitz.Page, "find_tables")
except Exception:  # pragma: no cover
    HAVE_FITZ = False

import extract_tables as et  # noqa: E402

MM = 72 / 25.4
COLS = (20, 80, 120, 170)       # mm: column edges
ROW_H = 9                       # mm
TOP = 30                        # mm
FILL = (0.99, 0.91, 0.77)       # the filled body row


def cell_rect(r: int, c: int) -> fitz.Rect:
    return fitz.Rect(COLS[c] * MM, (TOP + r * ROW_H) * MM, COLS[c + 1] * MM, (TOP + (r + 1) * ROW_H) * MM)


def draw_table(page, rules: str = "grid", tall_last: bool = False) -> None:
    """A table of 5 rows by 3 columns: a bold header, a centred middle
    column, a right-aligned last column, a filled third body row and a
    bold total. `rules`: which rules to draw."""
    rows = [("Item", "Unit", "Price"), ("Paper", "box", "4.20"), ("Ink", "bottle", "12.00"),
            ("Pens", "pack", "3.10"), ("Total", "", "19.30")]
    n = len(rows)
    page.draw_rect(fitz.Rect(cell_rect(3, 0).x0, cell_rect(3, 0).y0, cell_rect(3, 2).x1, cell_rect(3, 2).y1),
                   color=None, fill=FILL)
    for r, row in enumerate(rows):
        for c, word in enumerate(row):
            if not word:
                continue
            box = cell_rect(r, c)
            bold = r == 0 or r == n - 1
            font = "hebo" if bold else "helv"
            w = fitz.get_text_length(word, fontname=font, fontsize=10)
            if c == 0:
                x = box.x0 + 2 * MM
            elif c == 1:
                x = (box.x0 + box.x1 - w) / 2
            else:
                x = box.x1 - 2 * MM - w
            page.insert_text((x, box.y1 - 2.6 * MM), word, fontsize=10, fontname=font)
    x0, x1 = COLS[0] * MM, COLS[-1] * MM
    ys = [(TOP + r * ROW_H) * MM for r in range(n + 1)]
    if rules == "grid":
        for y in ys:
            page.draw_line(fitz.Point(x0, y), fitz.Point(x1, y), color=(0, 0, 0), width=0.5)
        for c in COLS:
            page.draw_line(fitz.Point(c * MM, ys[0]), fitz.Point(c * MM, ys[-1]), color=(0, 0, 0), width=0.5)
    elif rules == "bars":
        # every rule a filled bar 0.3 mm thick, as some layout programs write them
        w = 0.3 * MM
        for y in ys:
            page.draw_rect(fitz.Rect(x0, y - w / 2, x1, y + w / 2), color=None, fill=(0.2, 0.2, 0.2))
        for c in COLS:
            page.draw_rect(fitz.Rect(c * MM - w / 2, ys[0], c * MM + w / 2, ys[-1]), color=None, fill=(0.2, 0.2, 0.2))


def run(pdf: Path, *more: str) -> list[dict]:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        et.main([str(pdf), "--full", *more])
    return json.loads(buf.getvalue())


@unittest.skipUnless(HAVE_FITZ, "needs PyMuPDF with find_tables")
class CellLookTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        doc = fitz.open()
        draw_table(doc.new_page(width=210 * MM, height=297 * MM), "grid")
        cls.pdf = Path(cls.tmp.name) / "grid.pdf"
        doc.save(str(cls.pdf))
        cls.found = run(cls.pdf)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_one_table_of_five_rows(self):
        self.assertEqual(len(self.found), 1)
        rows = self.found[0]["model"]["rows"]
        self.assertEqual(len(rows), 5)
        self.assertEqual([c["content"] for c in rows[1]], ["Paper", "box", "4.20"])

    def test_align_per_cell(self):
        rows = self.found[0]["model"]["rows"]
        for row in rows[1:4]:
            self.assertNotIn("align", row[0])
            self.assertEqual(row[1].get("align"), "center", row)
            self.assertEqual(row[2].get("align"), "right", row)

    def test_bold_body_cells_and_header_bold_in_the_style(self):
        rows = self.found[0]["model"]["rows"]
        self.assertEqual(rows[4][0]["content"], "**Total**")
        self.assertEqual(rows[4][2]["content"], "**19.30**")
        self.assertEqual(rows[1][0]["content"], "Paper")
        self.assertEqual(rows[0][0]["content"], "Item")       # the header's weight is the style's
        self.assertTrue(rows[0][0]["isHeader"])
        self.assertIs(self.found[0]["style"]["headerBold"], True)

    def test_the_filled_row_has_cell_backgrounds(self):
        rows = self.found[0]["model"]["rows"]
        want = et.hexc(FILL)
        self.assertEqual([c.get("background", {}).get("hex") for c in rows[3]], [want] * 3)
        for r in (0, 1, 2, 4):
            self.assertTrue(all("background" not in c for c in rows[r]), rows[r])

    def test_grid_rules(self):
        st = self.found[0]["style"]
        self.assertEqual(st["rules"], "grid")
        self.assertIs(st["borders"], True)
        self.assertEqual(st["borderColor"]["hex"], "#000000")
        self.assertEqual(st["borderWidth"], {"value": 0.5, "unit": "pt"})
        self.assertEqual(self.found[0]["notes"], [])

    def test_no_cell_carries_a_border(self):
        for row in self.found[0]["model"]["rows"]:
            for c in row:
                self.assertFalse({"border", "borders", "borderColor"} & set(c), c)

    def test_plain_keeps_the_text_only(self):
        found = run(self.pdf, "--plain")
        rows = found[0]["model"]["rows"]
        self.assertEqual(rows[4][0]["content"], "Total")
        self.assertTrue(all(set(c) <= {"content", "isHeader"} for row in rows for c in row))
        self.assertEqual(found[0]["style"], {})

    def test_json_only_prints_the_models(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            et.main([str(self.pdf), "--json-only"])
        models = json.loads(buf.getvalue())
        self.assertEqual(set(models[0]), {"rows", "headerRowCount"})


@unittest.skipUnless(HAVE_FITZ, "needs PyMuPDF with find_tables")
class BarRulesTest(unittest.TestCase):
    def test_bars_under_1_mm_are_rules_not_fills(self):
        with tempfile.TemporaryDirectory() as tmp:
            doc = fitz.open()
            draw_table(doc.new_page(width=210 * MM, height=297 * MM), "bars")
            pdf = Path(tmp) / "bars.pdf"
            doc.save(str(pdf))
            found = run(pdf)
        self.assertEqual(len(found), 1)
        st = found[0]["style"]
        self.assertEqual(st["rules"], "grid", found[0])
        self.assertEqual(st["borderColor"]["hex"], "#333333")
        self.assertAlmostEqual(st["borderWidth"]["value"], 0.85, delta=0.05)
        rows = found[0]["model"]["rows"]
        self.assertTrue(all("background" not in c for r in (0, 1, 2, 4) for c in rows[r]))


class HelpersTest(unittest.TestCase):
    def test_align(self):
        box = (0, 0, 100, 20)
        self.assertEqual(et.cell_align([(40, 60)], box), "center")
        self.assertEqual(et.cell_align([(70, 97)], box), "right")
        self.assertIsNone(et.cell_align([(3, 40)], box))
        self.assertIsNone(et.cell_align([(2, 97)], box))                # fills the cell
        self.assertEqual(et.cell_align([(2, 97), (40, 60)], box), "center")   # a full line, a centred last one
        self.assertIsNone(et.cell_align([(40, 60), (3, 40)], box))       # lines disagree

    def test_valign(self):
        box = (0, 0, 100, 40)
        self.assertEqual(et.cell_valign(15, 25, box, 10), "middle")
        self.assertEqual(et.cell_valign(28, 38, box, 10), "bottom")
        self.assertIsNone(et.cell_valign(2, 12, box, 10))
        self.assertIsNone(et.cell_valign(2, 37, box, 10))               # no room to tell

    def test_nearest_preset(self):
        ys, xs = [0, 10, 20, 30], [0, 50, 100]

        def h(y, w=0.5):
            return ("h", y, 0, 100, w, "#000000")

        def v(x):
            return ("v", x, 0, 30, 0.5, "#000000")

        self.assertEqual(et.nearest_rules([h(y) for y in ys], ys, xs, 1)["rules"], "horizontal")
        self.assertEqual(et.nearest_rules([h(0), h(30), v(0), v(100)], ys, xs, 1)["rules"], "outer")
        self.assertEqual(et.nearest_rules([], ys, xs, 1)["rules"], "none")
        self.assertEqual(et.nearest_rules([h(0, 1.2), h(10), h(30, 1.2)], ys, xs, 1)["rules"], "booktabs")
        near = et.nearest_rules([h(y) for y in ys] + [v(x) for x in xs[:2]], ys, xs, 1)
        self.assertEqual((near["rules"], near["distance"]), ("grid", 1))


if __name__ == "__main__":
    unittest.main()
