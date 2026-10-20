"""Tests of `line_art.py`: the geometry that reads a page's thin lines as
connectors between frames (invented boxes, no PDF).

    python3 -m unittest discover -s plugins/postext/skills/postext-port/scripts/tests
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import line_art as la  # noqa: E402

LOOK = ("#e0a030", 1.0, ())


def segs(*paths):
    out = []
    for i, p in enumerate(paths):
        got = la.line_segments(p, LOOK, i)
        assert got, p
        out += got
    return la.merge_collinear(out)


def read(frames, *paths):
    conns, left = [], []
    for net in la.nets(segs(*paths)):
        c, rest = la.read_net(net, frames)
        conns += c
        left += rest
    return conns, left


class SegmentsTest(unittest.TestCase):
    def test_slanted_pieces_are_no_lines_and_corner_bits_are_dropped(self):
        self.assertIsNone(la.line_segments([((0, 0), (10, 8))], LOOK, 1))
        got = la.line_segments([((0, 0), (0, 10)), ((0, 10), (0.2, 10.1)), ((0.2, 10.1), (20, 10.1))], LOOK, 1)
        self.assertEqual([g.axis for g in got], ["v", "h"])

    def test_a_closed_rectangle_is_a_border_not_a_line(self):
        sq = [((0, 0), (20, 0)), ((20, 0), (20, 10)), ((20, 10), (0, 10)), ((0, 10), (0, 0))]
        self.assertIsNone(la.line_segments(sq, LOOK, 1))
        bracket = sq[:3]
        self.assertEqual(len(la.line_segments(bracket, LOOK, 1)), 3)

    def test_pieces_on_one_line_merge(self):
        got = segs([((0, 5), (10, 5))], [((10.3, 5), (30, 5))])
        self.assertEqual(len(got), 1)
        self.assertAlmostEqual(got[0].hi, 30)


class TreeTest(unittest.TestCase):
    frames = [la.Frame("root", (60, 10, 140, 20)),
              la.Frame("a", (10, 40, 50, 60)), la.Frame("b", (80, 40, 120, 60)), la.Frame("c", (150, 40, 190, 60))]

    def test_bar_trunk_and_drops_are_one_tree(self):
        conns, left = read(self.frames,
                           [((100, 20), (100, 30))],
                           [((30, 40), (30, 30)), ((30, 30), (170, 30)), ((170, 30), (170, 40))],
                           [((100, 30), (100, 40))])
        self.assertEqual(len(conns), 1)
        t = conns[0]
        self.assertEqual(t.routing, "tree")
        self.assertEqual(t.start.frame, "root")
        self.assertEqual(t.start.side, "bottom")
        self.assertEqual(sorted(e.frame for e in t.ends), ["a", "b", "c"])
        self.assertTrue(all(e.side == "top" for e in t.ends))
        self.assertIsNone(t.trunk)            # the bar half way: the default
        self.assertEqual(left, [])

    def test_bar_near_the_children_sets_trunk(self):
        conns, _ = read(self.frames,
                        [((100, 20), (100, 36))],
                        [((30, 40), (30, 36)), ((30, 36), (170, 36)), ((170, 36), (170, 40))])
        self.assertAlmostEqual(conns[0].trunk, 0.8, places=2)

    def test_two_bars_on_one_trunk_are_two_trees_of_one_parent(self):
        frames = [f for f in self.frames if f.name != "b"] + [la.Frame("d", (10, 90, 50, 100)), la.Frame("e", (150, 90, 190, 100))]
        conns, _ = read(frames,
                        [((100, 20), (100, 85))],
                        [((30, 40), (30, 30)), ((30, 30), (170, 30)), ((170, 30), (170, 40))],
                        [((30, 90), (30, 85)), ((30, 85), (170, 85)), ((170, 85), (170, 90))])
        trees = sorted((sorted(e.frame for e in c.ends), c.start.frame) for c in conns if c.routing == "tree")
        self.assertEqual(trees, [(["a", "c"], "root"), (["d", "e"], "root")])

    def test_a_drop_that_reaches_no_frame_is_left_for_a_path(self):
        conns, left = read(self.frames[:3],
                           [((100, 20), (100, 40))],
                           [((30, 40), (30, 30)), ((30, 30), (170, 30)), ((170, 30), (170, 40))])
        self.assertEqual(sorted(e.frame for e in conns[0].ends), ["a", "b"])
        self.assertEqual(sorted((g.axis, g.lo, g.hi) for g in left), [("h", 100, 170), ("v", 30, 40)])


class ChainTest(unittest.TestCase):
    def test_an_l_from_a_note_into_a_picture_points_at_it(self):
        frames = [la.Frame("note", (120, 50, 160, 70)), la.Frame("map", (10, 10, 100, 80), "figure")]
        conns, left = read(frames, [((80, 30), (80, 60))], [((80, 60), (120, 60))])
        self.assertEqual(len(conns), 1)
        c = conns[0]
        self.assertEqual(c.routing, "elbow")
        self.assertEqual((c.start.frame, c.start.side), ("note", "left"))
        self.assertEqual(c.ends[0].frame, "map")
        self.assertEqual(c.ends[0].point, (80, 30))
        self.assertEqual(c.ends[0].side, "bottom")       # the last run arrives from below

    def test_a_line_under_a_photo_ends_at_its_side(self):
        under = lambda p, d, ids, box: False  # noqa: E731
        frames = [la.Frame("pill", (40, 10, 60, 18)), la.Frame("photo", (30, 30, 70, 60), "picture", under)]
        conns, _ = read(frames, [((50, 18), (50, 45))])
        self.assertEqual(len(conns), 1)
        self.assertIsNone(conns[0].ends[0].point)
        self.assertEqual(conns[0].ends[0].side, "top")

    def test_a_line_drawn_over_a_picture_between_two_frames_paints_over(self):
        shown = lambda p, d, ids, box: True  # noqa: E731
        frames = [la.Frame("a", (10, 10, 30, 20)), la.Frame("map", (40, 5, 90, 25), "figure", shown),
                  la.Frame("b", (100, 10, 120, 20))]
        conns, _ = read(frames, [((30, 15), (100, 15))])
        self.assertEqual([(c.start.frame, c.ends[0].frame, c.over) for c in conns], [("a", "b", True)])

    def test_a_line_through_three_pills_joins_each_pair(self):
        frames = [la.Frame("p1", (10, 10, 30, 20)), la.Frame("p2", (60, 10, 80, 20)), la.Frame("p3", (110, 10, 130, 20))]
        conns, left = read(frames, [((20, 15), (120, 15))])
        pairs = [(c.start.frame, c.start.side, c.ends[0].frame, c.ends[0].side) for c in conns]
        self.assertEqual(pairs, [("p1", "right", "p2", "left"), ("p2", "right", "p3", "left")])
        self.assertEqual(left, [])

    def test_an_end_short_of_its_frame_keeps_the_gap(self):
        frames = [la.Frame("a", (10, 10, 30, 20)), la.Frame("b", (60, 10, 80, 20))]
        conns, _ = read(frames, [((31, 12), (59, 12))])
        c = conns[0]
        self.assertAlmostEqual(c.start.gap, 1.0, places=2)
        self.assertAlmostEqual(c.ends[0].gap, 1.0, places=2)
        self.assertAlmostEqual(c.start.at, 0.2, places=2)

    def test_a_rule_that_touches_nothing_is_left(self):
        frames = [la.Frame("a", (10, 10, 30, 20))]
        conns, left = read(frames, [((10, 100), (190, 100))])
        self.assertEqual(conns, [])
        self.assertEqual(len(left), 1)


class PathDataTest(unittest.TestCase):
    def test_segments_path(self):
        g = segs([((10, 10), (10, 20)), ((10, 20), (30, 20))])
        self.assertEqual(la.segs_path(g, (10, 10)), "M0 0 L0 10 L20 10")

    def test_card_with_a_tab_flush_left_is_one_outline(self):
        d = la.card_tab_path((18, 20, 217, 270), 3, (18, 14.3, 89.4, 25.7), 1)
        self.assertTrue(d.startswith("M0 1 A1 1 0 0 1 1 0"))
        self.assertIn("L71.4 5.7", d)        # down the tab's right side to the card's edge
        self.assertTrue(d.endswith("Z"))
        self.assertIsNone(la.card_tab_path((18, 20, 217, 270), 3, (18, 40, 60, 50), 1))

    def test_items_path(self):
        d = la.items_path([("re", 0, 0, 10, 5)], (0, 0), close=True)
        self.assertEqual(d, "M0 0 L10 0 L10 5 L0 5 Z")


if __name__ == "__main__":
    unittest.main()
