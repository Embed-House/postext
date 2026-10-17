"""Tests of the label extraction for postext 1.42: the same text printed twice at one point is one
anchor, names the source prints touching are allowed to overlap, a map's dots are `avoid` zones.

    python3 -m unittest discover -s plugins/postext/skills/postext-port/scripts/tests
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

import anchors as anc  # noqa: E402

try:
    import fitz  # noqa: F401
    HAVE_FITZ = True
except Exception:  # pragma: no cover
    HAVE_FITZ = False


def line(text: str, x0: float, base: float, size: float = 8, width: float | None = None, **extra) -> dict:
    w = width if width is not None else 1.6 * len(text) * size * anc.PT_MM / 3
    h = size * anc.PT_MM
    return {"text": text, "plain": text, "x0": x0, "x1": x0 + w, "y0": base - 0.75 * h, "y1": base + 0.25 * h,
            "base": base, "size": size, "family": "Sans", "weight": 400, "italic": False,
            "color": "#000000", "rotate": 0, **extra}


class Duplicates(unittest.TestCase):
    def test_two_grids_one_over_the_other_are_one_label(self):
        notes: list[str] = []
        lines = [line("30°", 50.0, 80.0, size=6, width=4.0), line("30°", 50.2, 80.3, size=8, width=4.0),
                 line("60°", 70.0, 80.0, size=8, width=4.0)]
        groups = anc.merge_lines(lines, notes=notes)
        self.assertEqual(sorted(g[0]["plain"] for g in groups), ["30°", "60°"])
        kept = next(g[0] for g in groups if g[0]["plain"] == "30°")
        self.assertEqual(kept["size"], 8)
        self.assertEqual(len(notes), 1)
        self.assertTrue(notes[0].startswith("# merged '30°'"))
        self.assertIn("6 pt", notes[0])

    def test_the_same_word_elsewhere_is_another_label(self):
        notes: list[str] = []
        groups = anc.merge_lines([line("Santa Fe", 20, 40), line("Santa Fe", 90, 40)], notes=notes)
        self.assertEqual(len(groups), 2)
        self.assertEqual(notes, [])

    def test_two_words_at_one_point_stay_two(self):
        groups = anc.merge_lines([line("Lima", 20, 40), line("Quito", 20.1, 40.1)])
        self.assertEqual(len(groups), 2)


class Touching(unittest.TestCase):
    def test_names_that_touch_are_allowed_to(self):
        lines = [line("Belgique", 40, 50, width=14), line("Luxembourg", 50, 50.5, width=16),
                 line("Mer du Nord", 120, 20, width=18)]
        groups = anc.merge_lines(lines, merge=False)
        styles, ids = anc.label_styles(groups)
        anchors, _ = anc.anchors_for(groups, (0, 0, 200, 100), ids)
        by = {a["id"]: a for a in anchors}
        self.assertEqual(by["belgique"]["overlap"], "allow")
        self.assertEqual(by["luxembourg"]["overlap"], "allow")
        self.assertNotIn("overlap", by["mer-nord"])

    def test_check_overlap_leaves_the_check_on(self):
        groups = anc.merge_lines([line("A", 40, 50, width=14), line("B", 45, 50, width=14)], merge=False)
        _, ids = anc.label_styles(groups)
        anchors, _ = anc.anchors_for(groups, (0, 0, 200, 100), ids, allow_touching=False)
        self.assertTrue(all("overlap" not in a for a in anchors))

    def test_a_label_clear_of_the_others_by_a_hair_is_not_touching(self):
        groups = anc.merge_lines([line("A", 40, 50, width=14), line("B", 40, 53.2, width=14)], merge=False)
        self.assertEqual(anc.touching_groups(groups), set())

    def test_a_dense_map_says_it_once_on_the_styles(self):
        lines = [line(f"País {i}", 10 + (i % 10) * 12, 20 + (i // 10) * 6, width=14) for i in range(40)]
        groups = anc.merge_lines(lines, merge=False)
        styles, ids = anc.label_styles(groups)
        anchors, _ = anc.anchors_for(groups, (0, 0, 200, 100), ids)
        self.assertGreater(sum(1 for a in anchors if a.get("overlap") == "allow"), 8)
        self.assertTrue(anc.hoist_overlap(anchors, styles))
        self.assertTrue(all("overlap" not in a for a in anchors))
        self.assertTrue(all(st.get("overlap") == "allow" for st in styles))

    def test_a_few_touching_names_stay_on_their_anchors(self):
        groups = anc.merge_lines([line("A", 40, 50, width=14), line("B", 45, 50, width=14),
                                  line("C", 120, 20, width=10)], merge=False)
        styles, ids = anc.label_styles(groups)
        anchors, _ = anc.anchors_for(groups, (0, 0, 200, 100), ids)
        self.assertFalse(anc.hoist_overlap(anchors, styles))
        self.assertEqual(sum(1 for a in anchors if a.get("overlap")), 2)
        self.assertTrue(all("overlap" not in st for st in styles))


@unittest.skipUnless(HAVE_FITZ, "needs PyMuPDF")
class Symbols(unittest.TestCase):
    def test_dots_become_avoid_zones_in_fractions_of_the_box(self):
        import pdf_figures as pf
        box = (10.0, 20.0, 110.0, 120.0)
        rects = [(30.0, 40.0, 31.0, 41.0),           # a dot
                 (30.0, 40.0, 31.0, 41.0),           # its outline, the same rectangle
                 (60.0, 80.0, 63.0, 83.0),           # an icon
                 (10.0, 20.0, 110.0, 120.0),         # the sea
                 (50.0, 50.0, 90.0, 51.0),           # a road
                 (200.0, 40.0, 201.0, 41.0)]         # outside the box
        zones = pf.symbol_zones(rects, box, lo=0.6, hi=4.0, pad=0.3)
        self.assertEqual(len(zones), 2)
        self.assertAlmostEqual(zones[0]["x"], 0.197, places=3)
        self.assertAlmostEqual(zones[0]["y"], 0.197, places=3)
        self.assertAlmostEqual(zones[0]["width"], 0.016, places=3)
        self.assertAlmostEqual(zones[1]["width"], 0.036, places=3)

    def test_a_mark_inside_a_bigger_ones_zone_is_dropped(self):
        import pdf_figures as pf
        zones = pf.symbol_zones([(30.0, 40.0, 33.0, 43.0), (31.0, 41.0, 32.0, 42.0)], (0, 0, 100, 100))
        self.assertEqual(len(zones), 1)


if __name__ == "__main__":
    unittest.main()
