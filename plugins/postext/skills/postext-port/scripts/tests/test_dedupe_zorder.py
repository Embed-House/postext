"""Tests of the paint order of a child template's patch (#1131): a page's
extra decoration that meets an inherited folio or running head has that
element written again after it, so it stays on top.

    python3 -m unittest discover -s plugins/postext/skills/postext-port/scripts/tests
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import template_dedupe as td  # noqa: E402


def mm(v: float) -> dict:
    return {"value": v, "unit": "mm"}


def placed(x, y, w=None, h=None) -> dict:
    p = {"anchor": {"to": "page", "edge": "top-left"}, "offset": {"x": mm(x), "y": mm(y)}}
    if w is not None:
        p["size"] = {"width": mm(w), "height": mm(h)}
    return p


FOLIO = {"kind": "text", "id": "folio", "content": "{pageNumber}", "placement": {**placed(100, 285), "size": {"width": mm(10)}},
         "fontSize": {"value": 9, "unit": "pt"}}
HEAD = {"kind": "text", "id": "head", "content": "RIVERS", "placement": {**placed(20, 8), "size": {"width": mm(60)}},
        "fontSize": {"value": 9, "unit": "pt"}}
CARD = {"kind": "box", "id": "card", "placement": placed(10, 20, 190, 250), "style": {"backgroundColor": {"hex": "#ffffff"}}}


def template(tid: str, elements: list[dict]) -> dict:
    return {"id": tid, "frames": [{"name": "text", "placement": placed(20, 30), "width": mm(170), "flow": True}],
            "decoration": {"elements": elements}}


class ZOrderTest(unittest.TestCase):
    def test_a_band_over_the_folio_has_the_folio_written_after_it(self):
        band = {"kind": "box", "id": "band", "placement": placed(0, 280, 210, 17), "style": {"backgroundColor": {"hex": "#22aa88"}}}
        base = template("page", [CARD, HEAD, FOLIO])
        child = template("page-2", [CARD, HEAD, FOLIO, band])
        els = td.patch_of(child, base, 0.5)["decoration"]["elements"]
        self.assertEqual([e["id"] for e in els], ["band", "folio", "folio"])
        self.assertEqual(els[1], {"id": "folio", "remove": True})
        self.assertEqual(els[2], FOLIO)
        self.assertIsNot(els[2], FOLIO)

    def test_an_extra_clear_of_the_furniture_changes_nothing(self):
        dot = {"kind": "box", "id": "dot", "placement": placed(100, 150, 5, 5), "style": {}}
        els = td.patch_of(template("b", [CARD, HEAD, FOLIO, dot]), template("a", [CARD, HEAD, FOLIO]), 0.5)
        self.assertEqual([e["id"] for e in els["decoration"]["elements"]], ["dot"])

    def test_a_shape_under_the_head_is_not_a_box_or_a_card(self):
        # the card is not text or furniture: it stays where it is, under the extra shape
        shape = {"kind": "box", "id": "plate", "placement": placed(15, 5, 80, 8), "style": {}}
        els = td.patch_of(template("b", [CARD, HEAD, FOLIO, shape]), template("a", [CARD, HEAD, FOLIO]), 0.5)
        self.assertEqual([e["id"] for e in els["decoration"]["elements"]], ["plate", "head", "head"])

    def test_no_extra_no_decoration(self):
        self.assertNotIn("decoration", td.patch_of(template("b", [CARD, FOLIO]), template("a", [CARD, FOLIO]), 0.5))


if __name__ == "__main__":
    unittest.main()
